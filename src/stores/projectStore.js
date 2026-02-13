import { defineStore } from 'pinia'
import { downloadPng, downloadSvg } from '../lib/export/exportSchematic'
import { haversineDistanceMeters, projectLngLat } from '../lib/geo'
import { optimizeLayoutInWorker } from '../lib/layout/workerClient'
import { normalizeHexColor, pickLineColor } from '../lib/colors'
import { createId } from '../lib/ids'
import { importJinanMetroFromOsm } from '../lib/osm/importJinanMetro'
import { createEmptyProject, normalizeProject } from '../lib/projectModel'
import {
  listProjectsFromDb,
  loadLatestProjectFromDb,
  loadProjectFromDb,
  saveProjectToDb,
  setLatestProject,
} from '../lib/storage/db'
import { downloadProjectFile, parseProjectFile } from '../lib/storage/projectFile'

let persistTimer = null

function estimateDisplayPositionFromLngLat(stations, lngLat) {
  const stationsWithDisplay = (stations || []).filter(
    (station) =>
      Array.isArray(station.lngLat) &&
      station.lngLat.length === 2 &&
      Array.isArray(station.displayPos) &&
      station.displayPos.length === 2,
  )

  if (stationsWithDisplay.length < 2) {
    return projectLngLat(lngLat)
  }

  let minLng = Number.POSITIVE_INFINITY
  let maxLng = Number.NEGATIVE_INFINITY
  let minLat = Number.POSITIVE_INFINITY
  let maxLat = Number.NEGATIVE_INFINITY
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const station of stationsWithDisplay) {
    minLng = Math.min(minLng, station.lngLat[0])
    maxLng = Math.max(maxLng, station.lngLat[0])
    minLat = Math.min(minLat, station.lngLat[1])
    maxLat = Math.max(maxLat, station.lngLat[1])
    minX = Math.min(minX, station.displayPos[0])
    maxX = Math.max(maxX, station.displayPos[0])
    minY = Math.min(minY, station.displayPos[1])
    maxY = Math.max(maxY, station.displayPos[1])
  }

  const lngSpan = Math.max(maxLng - minLng, 1e-6)
  const latSpan = Math.max(maxLat - minLat, 1e-6)
  const xSpan = Math.max(maxX - minX, 1)
  const ySpan = Math.max(maxY - minY, 1)

  const lngRatio = (lngLat[0] - minLng) / lngSpan
  const latRatio = (lngLat[1] - minLat) / latSpan

  return [minX + xSpan * lngRatio, minY + ySpan * latRatio]
}

export const useProjectStore = defineStore('project', {
  state: () => ({
    project: null,
    regionBoundary: null,
    mode: 'select',
    selectedStationId: null,
    selectedEdgeId: null,
    pendingEdgeStartStationId: null,
    activeLineId: null,
    isImporting: false,
    isLayoutRunning: false,
    isInitialized: false,
    statusText: '',
    includeConstruction: false,
    includeProposed: false,
  }),
  getters: {
    lineById(state) {
      const map = new Map()
      for (const line of state.project?.lines || []) {
        map.set(line.id, line)
      }
      return map
    },
    stationById(state) {
      const map = new Map()
      for (const station of state.project?.stations || []) {
        map.set(station.id, station)
      }
      return map
    },
    edgeById(state) {
      const map = new Map()
      for (const edge of state.project?.edges || []) {
        map.set(edge.id, edge)
      }
      return map
    },
  },
  actions: {
    async initialize() {
      if (this.isInitialized) return
      const latest = await loadLatestProjectFromDb()
      this.project = latest || createEmptyProject('济南地铁图工程')
      this.regionBoundary = this.project.regionBoundary || null
      this.includeConstruction = Boolean(this.project.importConfig?.includeConstruction)
      this.includeProposed = Boolean(this.project.importConfig?.includeProposed)
      this.activeLineId = this.project.lines[0]?.id || null
      this.isInitialized = true
      this.statusText = latest ? `已加载最近工程: ${latest.name}` : '已创建新工程'
      if (!latest) {
        try {
          await this.persistNow()
        } catch (error) {
          this.statusText = `初始化持久化失败: ${error.message || 'unknown error'}`
        }
      }
    },

    async createNewProject(name = '新建工程') {
      this.project = createEmptyProject(name)
      this.activeLineId = this.project.lines[0]?.id || null
      this.mode = 'select'
      this.selectedEdgeId = null
      this.selectedStationId = null
      this.pendingEdgeStartStationId = null
      this.regionBoundary = null
      this.includeConstruction = false
      this.includeProposed = false
      this.statusText = '已创建空工程'
      await this.persistNow()
    },

    setMode(mode) {
      this.mode = mode
      if (mode !== 'add-edge') {
        this.pendingEdgeStartStationId = null
      }
    },

    setActiveLine(lineId) {
      this.activeLineId = lineId
    },

    addLine({ nameZh, nameEn, color }) {
      if (!this.project) return null
      const lineIndex = this.project.lines.length
      const line = {
        id: createId('line'),
        key: `manual_${Date.now()}_${lineIndex}`,
        nameZh: nameZh?.trim() || `手工线路 ${lineIndex + 1}`,
        nameEn: nameEn?.trim() || `Manual Line ${lineIndex + 1}`,
        color: normalizeHexColor(color, pickLineColor(lineIndex)),
        status: 'open',
        edgeIds: [],
      }
      this.project.lines.push(line)
      this.activeLineId = line.id
      this.touchProject(`新增线路: ${line.nameZh}`)
      return line
    },

    addStationAt(lngLat) {
      if (!this.project || !Array.isArray(lngLat) || lngLat.length !== 2) return null
      const nextIndex = this.project.stations.length + 1
      const station = {
        id: createId('station'),
        nameZh: `新站 ${nextIndex}`,
        nameEn: `Station ${nextIndex}`,
        lngLat: [...lngLat],
        displayPos: estimateDisplayPositionFromLngLat(this.project.stations, lngLat),
        isInterchange: false,
        underConstruction: false,
        proposed: false,
        lineIds: [],
      }
      this.project.stations.push(station)
      this.selectedStationId = station.id
      this.touchProject(`新增站点: ${station.nameZh}`)
      return station
    },

    updateStationPosition(stationId, lngLat) {
      if (!this.project) return
      const station = this.project.stations.find((item) => item.id === stationId)
      if (!station) return
      station.lngLat = [...lngLat]
      station.displayPos = estimateDisplayPositionFromLngLat(this.project.stations, lngLat)
      this.touchProject('')
    },

    updateStationName(stationId, { nameZh, nameEn }) {
      if (!this.project) return
      const station = this.project.stations.find((item) => item.id === stationId)
      if (!station) return
      station.nameZh = nameZh
      station.nameEn = nameEn
      this.touchProject(`更新站名: ${station.nameZh}`)
    },

    findOrCreateActiveLine() {
      if (!this.project) return null
      let line = this.project.lines.find((item) => item.id === this.activeLineId)
      if (!line) {
        line = this.addLine({})
      }
      return line
    },

    addEdgeBetweenStations(fromStationId, toStationId) {
      if (!this.project || fromStationId === toStationId) return null

      const fromStation = this.project.stations.find((station) => station.id === fromStationId)
      const toStation = this.project.stations.find((station) => station.id === toStationId)
      if (!fromStation || !toStation) return null

      const line = this.findOrCreateActiveLine()
      if (!line) return null

      const pairKey =
        fromStationId < toStationId
          ? `${fromStationId}__${toStationId}`
          : `${toStationId}__${fromStationId}`

      let edge = this.project.edges.find((item) => {
        const key =
          item.fromStationId < item.toStationId
            ? `${item.fromStationId}__${item.toStationId}`
            : `${item.toStationId}__${item.fromStationId}`
        return key === pairKey
      })

      if (!edge) {
        edge = {
          id: createId('edge'),
          fromStationId,
          toStationId,
          waypoints: [fromStation.lngLat, toStation.lngLat],
          sharedByLineIds: [line.id],
          lengthMeters: haversineDistanceMeters(fromStation.lngLat, toStation.lngLat),
        }
        this.project.edges.push(edge)
      } else if (!edge.sharedByLineIds.includes(line.id)) {
        edge.sharedByLineIds.push(line.id)
      }

      if (!line.edgeIds.includes(edge.id)) {
        line.edgeIds.push(edge.id)
      }

      this.recomputeStationLineMembership()
      this.selectedEdgeId = edge.id
      this.touchProject('新增线段')
      return edge
    },

    selectStation(stationId) {
      this.selectedStationId = stationId
      if (this.mode === 'add-edge') {
        if (!this.pendingEdgeStartStationId) {
          this.pendingEdgeStartStationId = stationId
          this.statusText = '已选择起点站，请选择终点站'
          return
        }
        if (this.pendingEdgeStartStationId === stationId) {
          this.pendingEdgeStartStationId = null
          this.statusText = '已取消边创建'
          return
        }
        this.addEdgeBetweenStations(this.pendingEdgeStartStationId, stationId)
        this.pendingEdgeStartStationId = null
      }
    },

    recomputeStationLineMembership() {
      if (!this.project) return
      const stationLineSet = new Map(this.project.stations.map((station) => [station.id, new Set()]))
      const lineById = new Map(this.project.lines.map((line) => [line.id, line]))
      const edgeById = new Map(this.project.edges.map((edge) => [edge.id, edge]))

      for (const line of this.project.lines) {
        for (const edgeId of line.edgeIds) {
          const edge = edgeById.get(edgeId)
          if (!edge) continue
          stationLineSet.get(edge.fromStationId)?.add(line.id)
          stationLineSet.get(edge.toStationId)?.add(line.id)
        }
      }

      for (const station of this.project.stations) {
        const lineIds = [...(stationLineSet.get(station.id) || [])]
        station.lineIds = lineIds
        station.isInterchange = lineIds.length > 1
        station.underConstruction = lineIds.some((lineId) => lineById.get(lineId)?.status === 'construction')
        station.proposed = lineIds.some((lineId) => lineById.get(lineId)?.status === 'proposed')
      }
    },

    async importJinanNetwork() {
      if (!this.project || this.isImporting) return
      this.isImporting = true
      this.statusText = '正在导入 OSM 济南地铁线网...'
      try {
        const imported = await importJinanMetroFromOsm({
          includeConstruction: this.includeConstruction,
          includeProposed: this.includeProposed,
        })

        this.project = normalizeProject({
          ...this.project,
          name: `${this.project.name || '工程'} (OSM导入)`,
          region: imported.region,
          regionBoundary: imported.boundary,
          importConfig: {
            includeConstruction: this.includeConstruction,
            includeProposed: this.includeProposed,
          },
          stations: imported.stations,
          edges: imported.edges,
          lines: imported.lines,
          meta: {
            ...this.project.meta,
            updatedAt: new Date().toISOString(),
          },
        })
        this.regionBoundary = imported.boundary
        this.activeLineId = this.project.lines[0]?.id || null
        this.recomputeStationLineMembership()
        this.statusText = `导入完成: ${this.project.lines.length} 条线 / ${this.project.stations.length} 站`
        await this.persistNow()
      } catch (error) {
        this.statusText = `导入失败: ${error.message || 'unknown error'}`
      } finally {
        this.isImporting = false
      }
    },

    async runAutoLayout() {
      if (!this.project || this.isLayoutRunning || this.project.stations.length < 2) return
      this.isLayoutRunning = true
      this.statusText = '正在执行自动排版...'
      try {
        const result = await optimizeLayoutInWorker({
          stations: this.project.stations,
          edges: this.project.edges,
          lines: this.project.lines,
        })
        this.project.stations = result.stations
        this.project.layoutMeta = {
          stationLabels: result.layoutMeta?.stationLabels || {},
          edgeDirections: result.layoutMeta?.edgeDirections || {},
        }
        const safeScore = Number.isFinite(result.score) ? result.score : 0
        this.project.snapshots.push({
          createdAt: new Date().toISOString(),
          score: safeScore,
          breakdown: result.breakdown,
        })
        this.statusText = `自动排版完成，评分 ${safeScore.toFixed(2)}`
        this.touchProject('')
      } catch (error) {
        this.statusText = `自动排版失败: ${error.message || 'unknown error'}`
      } finally {
        this.isLayoutRunning = false
      }
    },

    async exportProjectFile() {
      if (!this.project) return
      downloadProjectFile(this.project)
      this.statusText = '工程文件已导出'
    },

    async importProjectFile(file) {
      if (!file) return
      const parsed = await parseProjectFile(file)
      this.project = parsed
      this.regionBoundary = parsed.regionBoundary || null
      this.includeConstruction = Boolean(parsed.importConfig?.includeConstruction)
      this.includeProposed = Boolean(parsed.importConfig?.includeProposed)
      this.activeLineId = this.project.lines[0]?.id || null
      this.recomputeStationLineMembership()
      this.statusText = `已加载工程文件: ${parsed.name}`
      await this.persistNow()
    },

    async exportSvg() {
      if (!this.project) return
      downloadSvg(this.project)
      this.statusText = 'SVG 已导出'
    },

    async exportPng() {
      if (!this.project) return
      await downloadPng(this.project)
      this.statusText = 'PNG 已导出'
    },

    async persistNow() {
      if (!this.project) return
      this.project.meta.updatedAt = new Date().toISOString()
      try {
        const saved = await saveProjectToDb(this.project)
        await setLatestProject(saved.id)
      } catch (error) {
        this.statusText = `本地保存失败: ${error.message || 'unknown error'}`
        throw error
      }
    },

    schedulePersist() {
      if (persistTimer) clearTimeout(persistTimer)
      persistTimer = setTimeout(() => {
        this.persistNow().catch(() => {})
      }, 800)
    },

    touchProject(statusText) {
      if (!this.project) return
      this.project.meta.updatedAt = new Date().toISOString()
      if (statusText) {
        this.statusText = statusText
      }
      this.schedulePersist()
    },

    async loadProjectById(projectId) {
      const project = await loadProjectFromDb(projectId)
      if (!project) return
      this.project = project
      this.regionBoundary = project.regionBoundary || null
      this.includeConstruction = Boolean(project.importConfig?.includeConstruction)
      this.includeProposed = Boolean(project.importConfig?.includeProposed)
      this.activeLineId = project.lines[0]?.id || null
      this.recomputeStationLineMembership()
      this.statusText = `已加载工程: ${project.name}`
      await setLatestProject(project.id)
    },

    async listProjects() {
      return listProjectsFromDb()
    },
  },
})
