import { createId } from '../../../lib/ids'
import { createEmptyProject, normalizeProject } from '../../../lib/projectModel'
import {
  deleteProjectFromDb,
  listProjectsFromDb,
  loadLatestProjectFromDb,
  loadProjectFromDb,
  setLatestProject,
} from '../../../lib/storage/db'
import { validateProject } from '../../../lib/validation'

function resetStationEnglishRetranslateState(store) {
  store.isStationEnglishRetranslating = false
  store.stationEnglishRetranslateProgress = {
    done: 0,
    total: 0,
    percent: 0,
    message: '',
  }
}

/**
 * Run validation on the current project and report issues via statusText.
 * Does NOT auto-repair; only logs and surfaces a summary.
 * @param {object} store - the Pinia store instance (this)
 * @param {string} loadLabel - human-readable label for the load source (used in log prefix)
 */
function runPostLoadValidation(store, loadLabel) {
  if (!store.project) return
  const { issues, isValid } = validateProject(store.project)
  if (isValid && issues.length === 0) return

  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')

  // Log every issue to console for debugging
  for (const issue of issues) {
    const logFn = issue.severity === 'error' ? console.error : console.warn
    logFn(`[validation] ${issue.type}: ${issue.message}`)
  }

  // Build a concise status summary
  const parts = []
  if (errors.length > 0) parts.push(`${errors.length} 个错误`)
  if (warnings.length > 0) parts.push(`${warnings.length} 个警告`)
  store.statusText = `${loadLabel} (数据校验: ${parts.join(', ')})`
}

const lifecycleActions = {
  async initialize() {
    if (this.isInitialized) return
    const latest = await loadLatestProjectFromDb()
    this.project = latest || createEmptyProject('新建工程')
    this.regionBoundary = this.project.regionBoundary || null
    this.activeLineId = this.project.lines[0]?.id || null
    this.selectedStationId = null
    this.selectedStationIds = []
    this.selectedEdgeId = null
    this.selectedEdgeIds = []
    this.selectedEdgeAnchor = null
    this.pendingEdgeStartStationId = null
    resetStationEnglishRetranslateState(this)
    this.isInitialized = true
    const initLabel = latest ? `已加载最近工程: ${latest.name}` : '已创建新工程'
    this.statusText = initLabel
    this.resetHistoryBaseline()
    if (latest) {
      runPostLoadValidation(this, initLabel)
    } else {
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
    this.selectedEdgeIds = []
    this.selectedEdgeAnchor = null
    this.selectedStationId = null
    this.selectedStationIds = []
    this.pendingEdgeStartStationId = null
    resetStationEnglishRetranslateState(this)
    this.regionBoundary = null
    this.statusText = '已创建空工程'
    this.resetHistoryBaseline()
    await this.persistNow()
  },

  async renameCurrentProject(name) {
    if (!this.project) return
    const normalizedName = String(name || '').trim()
    if (!normalizedName) return
    this.project.name = normalizedName
    this.project.meta.updatedAt = new Date().toISOString()
    this.statusText = `已重命名工程: ${normalizedName}`
    await this.persistNow()
  },

  async duplicateCurrentProject(name) {
    if (!this.project) return null
    const normalizedName = String(name || '').trim()
    const now = new Date().toISOString()
    const duplicated = normalizeProject({
      ...JSON.parse(JSON.stringify(this.project)),
      id: createId('project'),
      name: normalizedName || `${this.project.name} 副本`,
      meta: {
        createdAt: now,
        updatedAt: now,
      },
    })

    this.project = duplicated
    this.regionBoundary = duplicated.regionBoundary || null
    this.activeLineId = duplicated.lines[0]?.id || null
    this.mode = 'select'
    this.selectedStationId = null
    this.selectedStationIds = []
    this.selectedEdgeId = null
    this.selectedEdgeIds = []
    this.selectedEdgeAnchor = null
    this.pendingEdgeStartStationId = null
    resetStationEnglishRetranslateState(this)
    this.recomputeStationLineMembership()
    this.statusText = `已复制工程: ${duplicated.name}`
    this.resetHistoryBaseline()
    await this.persistNow()
    return duplicated
  },

  async deleteProjectById(projectId) {
    if (!projectId) return false
    const targetId = String(projectId)
    const deletingCurrent = this.project?.id === targetId

    await deleteProjectFromDb(targetId)
    const projects = await listProjectsFromDb()

    if (!projects.length) {
      this.project = createEmptyProject('新建工程')
      this.regionBoundary = this.project.regionBoundary || null
      this.activeLineId = this.project.lines[0]?.id || null
      this.mode = 'select'
      this.selectedStationId = null
      this.selectedStationIds = []
      this.selectedEdgeId = null
      this.selectedEdgeIds = []
      this.selectedEdgeAnchor = null
      this.pendingEdgeStartStationId = null
      resetStationEnglishRetranslateState(this)
      this.statusText = '已删除工程，已创建新工程'
      this.resetHistoryBaseline()
      await this.persistNow()
      return true
    }

    if (deletingCurrent) {
      const fallback = projects[0]
      this.project = fallback
      this.regionBoundary = fallback.regionBoundary || null
      this.activeLineId = fallback.lines[0]?.id || null
      this.mode = 'select'
      this.selectedStationId = null
      this.selectedStationIds = []
      this.selectedEdgeId = null
      this.selectedEdgeIds = []
      this.selectedEdgeAnchor = null
      this.pendingEdgeStartStationId = null
      resetStationEnglishRetranslateState(this)
      this.recomputeStationLineMembership()
      const fallbackLabel = `已删除工程，已加载: ${fallback.name}`
      this.statusText = fallbackLabel
      this.resetHistoryBaseline()
      await setLatestProject(fallback.id)
      runPostLoadValidation(this, fallbackLabel)
      return true
    }

    await setLatestProject(this.project?.id || projects[0].id)
    this.statusText = '已删除工程'
    return true
  },

  async loadProjectById(projectId) {
    const project = await loadProjectFromDb(projectId)
    if (!project) return
    this.project = project
    this.regionBoundary = project.regionBoundary || null
    this.activeLineId = project.lines[0]?.id || null
    this.selectedStationId = null
    this.selectedStationIds = []
    this.selectedEdgeId = null
    this.selectedEdgeIds = []
    this.selectedEdgeAnchor = null
    this.pendingEdgeStartStationId = null
    resetStationEnglishRetranslateState(this)
    this.recomputeStationLineMembership()
    const loadLabel = `已加载工程: ${project.name}`
    this.statusText = loadLabel
    this.resetHistoryBaseline()
    await setLatestProject(project.id)
    runPostLoadValidation(this, loadLabel)
  },

  async listProjects() {
    return listProjectsFromDb()
  },

}

export { lifecycleActions }
