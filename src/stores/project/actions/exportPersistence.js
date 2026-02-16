import {
  downloadAllLineHudZip,
  downloadOfficialSchematicPng,
} from '../../../lib/export/exportSchematic'
import { saveProjectToDb, setLatestProject } from '../../../lib/storage/db'
import { downloadProjectFile, parseProjectFile } from '../../../lib/storage/projectFile'
import { validateProject } from '../../../lib/validation'
import { exportTimelineVideo, getResolutionPresets } from '../../../lib/timeline/timelineExporter'

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
    this.activeLineId = this.project.lines[0]?.id || null
    this.selectedStationId = null
    this.selectedStationIds = []
    this.selectedEdgeId = null
    this.selectedEdgeIds = []
    this.selectedEdgeAnchor = null
    this.pendingEdgeStartStationId = null
    this.isStationEnglishRetranslating = false
    this.stationEnglishRetranslateProgress = {
      done: 0,
      total: 0,
      percent: 0,
      message: '',
    }
    this.recomputeStationLineMembership()
    const importLabel = `已加载工程文件: ${parsed.name}`
    this.statusText = importLabel
    this.resetHistoryBaseline()
    await this.persistNow()

    // Validate imported project and report issues
    const { issues, isValid } = validateProject(this.project)
    if (!isValid || issues.length > 0) {
      const errors = issues.filter((i) => i.severity === 'error')
      const warnings = issues.filter((i) => i.severity === 'warning')
      for (const issue of issues) {
        const logFn = issue.severity === 'error' ? console.error : console.warn
        logFn(`[validation] ${issue.type}: ${issue.message}`)
      }
      const parts = []
      if (errors.length > 0) parts.push(`${errors.length} 个错误`)
      if (warnings.length > 0) parts.push(`${warnings.length} 个警告`)
      this.statusText = `${importLabel} (数据校验: ${parts.join(', ')})`
    }
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
    this._persistDirty = true
    persistTimer = setTimeout(() => {
      this.persistNow().then(() => {
        this._persistDirty = false
      }).catch(() => {})
    }, 800)
  },

  flushPersist() {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    if (this._persistDirty && this.project) {
      this._persistDirty = false
      this.persistNow().catch(() => {})
    }
  },

  touchProject(statusText) {
    if (!this.project) return
    this.project.meta.updatedAt = new Date().toISOString()
    this.recordHistory(statusText)
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

  async exportTimelineVideo(options = {}) {
    if (!this.project) return
    if (!this.timelineHasData) {
      this.statusText = '没有标记年份的线段，无法导出时间轴动画'
      return
    }
    this.statusText = '正在导出时间轴动画...'
    try {
      const blob = await exportTimelineVideo(this.project, {
        resolution: options.resolution || '1080p',
        title: this.project.name,
        author: options.author || '',
        showIntro: options.showIntro !== false,
        showOutro: options.showOutro !== false,
        onProgress: (p) => {
          this.statusText = `导出时间轴动画: ${Math.round(p * 100)}%`
        },
        signal: options.signal,
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${this.project.name || 'metro-studio'}_timeline.webm`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      this.statusText = '时间轴动画已导出'
    } catch (error) {
      if (error.message === '导出已取消') {
        this.statusText = '时间轴动画导出已取消'
        return
      }
      this.statusText = `时间轴动画导出失败: ${error.message || '未知错误'}`
      throw error
    }
  },

}

export { exportPersistenceActions }
