import { createId } from '../../../lib/ids'
import { createEmptyProject, normalizeProject } from '../../../lib/projectModel'
import {
  deleteProjectFromDb,
  listProjectsFromDb,
  loadLatestProjectFromDb,
  loadProjectFromDb,
  setLatestProject,
} from '../../../lib/storage/db'

const lifecycleActions = {
  async initialize() {
    if (this.isInitialized) return
    const latest = await loadLatestProjectFromDb()
    this.project = latest || createEmptyProject('济南地铁图工程')
    this.regionBoundary = this.project.regionBoundary || null
    this.includeConstruction = Boolean(this.project.importConfig?.includeConstruction)
    this.includeProposed = Boolean(this.project.importConfig?.includeProposed)
    this.activeLineId = this.project.lines[0]?.id || null
    this.selectedStationId = null
    this.selectedStationIds = []
    this.selectedEdgeId = null
    this.selectedEdgeAnchor = null
    this.pendingEdgeStartStationId = null
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
    this.selectedEdgeAnchor = null
    this.selectedStationId = null
    this.selectedStationIds = []
    this.pendingEdgeStartStationId = null
    this.regionBoundary = null
    this.includeConstruction = false
    this.includeProposed = false
    this.statusText = '已创建空工程'
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
    this.includeConstruction = Boolean(duplicated.importConfig?.includeConstruction)
    this.includeProposed = Boolean(duplicated.importConfig?.includeProposed)
    this.activeLineId = duplicated.lines[0]?.id || null
    this.mode = 'select'
    this.selectedStationId = null
    this.selectedStationIds = []
    this.selectedEdgeId = null
    this.selectedEdgeAnchor = null
    this.pendingEdgeStartStationId = null
    this.recomputeStationLineMembership()
    this.statusText = `已复制工程: ${duplicated.name}`
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
      this.project = createEmptyProject('济南地铁图工程')
      this.regionBoundary = this.project.regionBoundary || null
      this.includeConstruction = false
      this.includeProposed = false
      this.activeLineId = this.project.lines[0]?.id || null
      this.mode = 'select'
      this.selectedStationId = null
      this.selectedStationIds = []
      this.selectedEdgeId = null
      this.selectedEdgeAnchor = null
      this.pendingEdgeStartStationId = null
      this.statusText = '已删除工程，已创建新工程'
      await this.persistNow()
      return true
    }

    if (deletingCurrent) {
      const fallback = projects[0]
      this.project = fallback
      this.regionBoundary = fallback.regionBoundary || null
      this.includeConstruction = Boolean(fallback.importConfig?.includeConstruction)
      this.includeProposed = Boolean(fallback.importConfig?.includeProposed)
      this.activeLineId = fallback.lines[0]?.id || null
      this.mode = 'select'
      this.selectedStationId = null
      this.selectedStationIds = []
      this.selectedEdgeId = null
      this.selectedEdgeAnchor = null
      this.pendingEdgeStartStationId = null
      this.recomputeStationLineMembership()
      this.statusText = `已删除工程，已加载: ${fallback.name}`
      await setLatestProject(fallback.id)
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
    this.includeConstruction = Boolean(project.importConfig?.includeConstruction)
    this.includeProposed = Boolean(project.importConfig?.includeProposed)
    this.activeLineId = project.lines[0]?.id || null
    this.selectedStationId = null
    this.selectedStationIds = []
    this.selectedEdgeId = null
    this.selectedEdgeAnchor = null
    this.pendingEdgeStartStationId = null
    this.recomputeStationLineMembership()
    this.statusText = `已加载工程: ${project.name}`
    await setLatestProject(project.id)
  },

  async listProjects() {
    return listProjectsFromDb()
  },

}

export { lifecycleActions }
