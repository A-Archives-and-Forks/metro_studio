import {
  downloadAllLineHudZip,
  downloadOfficialSchematicPng,
} from '../../../lib/export/exportSchematic'
import { saveProjectToDb, setLatestProject } from '../../../lib/storage/db'
import { downloadProjectFile, parseProjectFile } from '../../../lib/storage/projectFile'

let persistTimer = null
let actualRoutePngExporter = null

const exportPersistenceActions = {
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
    this.selectedStationId = null
    this.selectedStationIds = []
    this.selectedEdgeId = null
    this.selectedEdgeAnchor = null
    this.pendingEdgeStartStationId = null
    this.recomputeStationLineMembership()
    this.statusText = `已加载工程文件: ${parsed.name}`
    await this.persistNow()
  },

  async exportActualRoutePng() {
    if (!this.project) return
    try {
      if (typeof actualRoutePngExporter !== 'function') {
        throw new Error('真实地图未就绪，无法导出实际走向图')
      }
      await actualRoutePngExporter({
        project: this.project,
        stationVisibilityMode: this.exportStationVisibilityMode,
      })
      this.statusText = '实际走向图 PNG 已导出'
    } catch (error) {
      this.statusText = `实际走向图导出失败: ${error.message || 'unknown error'}`
      throw error
    }
  },

  async exportOfficialSchematicPng() {
    if (!this.project) return
    await downloadOfficialSchematicPng(this.project)
    this.statusText = '官方风格图 PNG 已导出'
  },

  async exportAllLineHudZip() {
    if (!this.project) return
    const result = await downloadAllLineHudZip(this.project)
    this.statusText = `车辆 HUD 打包已导出（${result.exportedCount} 张）`
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

  registerActualRoutePngExporter(exporter) {
    actualRoutePngExporter = typeof exporter === 'function' ? exporter : null
  },

  unregisterActualRoutePngExporter(exporter) {
    if (typeof exporter === 'function') {
      if (actualRoutePngExporter === exporter) {
        actualRoutePngExporter = null
      }
      return
    }
    actualRoutePngExporter = null
  },

  setExportStationVisibilityMode(mode) {
    const normalized = String(mode || '').trim()
    if (!['all', 'interchange', 'none'].includes(normalized)) return
    this.exportStationVisibilityMode = normalized
  },

}

export { exportPersistenceActions }
