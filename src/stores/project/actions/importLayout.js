import { optimizeLayoutInWorker } from '../../../lib/layout/workerClient'
import { importJinanMetroFromOsm } from '../../../lib/osm/importJinanMetro'
import { normalizeProject } from '../../../lib/projectModel'

const importLayoutActions = {
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
      this.selectedStationId = null
      this.selectedStationIds = []
      this.selectedEdgeId = null
      this.selectedEdgeAnchor = null
      this.pendingEdgeStartStationId = null
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
      const geoSeedScale = Number(this.project.layoutConfig?.geoSeedScale)
      const result = await optimizeLayoutInWorker({
        stations: this.project.stations,
        edges: this.project.edges,
        lines: this.project.lines,
        config: {
          geoSeedScale: Number.isFinite(geoSeedScale) ? geoSeedScale : 6,
        },
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

}

export { importLayoutActions }
