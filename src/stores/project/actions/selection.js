import { dedupeStationIds } from '../helpers'

const selectionActions = {
  setMode(mode) {
    this.mode = mode
    if (mode !== 'add-edge' && mode !== 'route-draw') {
      this.pendingEdgeStartStationId = null
    }
  },

  setLayoutGeoSeedScale(value) {
    if (!this.project) return
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return
    const normalized = Math.max(0.1, Math.min(16, parsed))
    if (!this.project.layoutConfig || typeof this.project.layoutConfig !== 'object') {
      this.project.layoutConfig = { geoSeedScale: normalized }
    } else {
      this.project.layoutConfig.geoSeedScale = normalized
    }
    this.touchProject('')
  },

  cancelPendingEdgeStart() {
    if (!this.pendingEdgeStartStationId) return
    this.pendingEdgeStartStationId = null
    if (this.mode === 'add-edge' || this.mode === 'route-draw') {
      this.statusText = '已取消待连接起点'
    }
  },

  setActiveLine(lineId) {
    this.activeLineId = lineId
  },

  setSelectedStations(stationIds, options = {}) {
    if (!this.project) return
    const stationIdSet = new Set(this.project.stations.map((station) => station.id))
    const sanitized = dedupeStationIds(stationIds, stationIdSet)
    this.selectedStationIds = sanitized
    if (sanitized.length) {
      this.selectedEdgeId = null
      this.selectedEdgeAnchor = null
    }
    if (options.keepPrimary && this.selectedStationId && sanitized.includes(this.selectedStationId)) {
      return
    }
    this.selectedStationId = sanitized.length ? sanitized[sanitized.length - 1] : null
  },

  clearSelection() {
    this.selectedStationId = null
    this.selectedStationIds = []
    this.selectedEdgeId = null
    this.selectedEdgeAnchor = null
  },

  selectStations(stationIds, options = {}) {
    const replace = options.replace !== false
    if (replace) {
      this.setSelectedStations(stationIds)
      return
    }
    const merged = [...this.selectedStationIds, ...(stationIds || [])]
    this.setSelectedStations(merged, { keepPrimary: true })
  },

  selectAllStations() {
    if (!this.project) return
    this.setSelectedStations(this.project.stations.map((station) => station.id))
    this.statusText = `已全选 ${this.selectedStationIds.length} 个站点`
  },

  selectStation(stationId, options = {}) {
    const multi = Boolean(options.multi || options.toggle)
    const toggle = Boolean(options.toggle)
    if (multi) {
      const selected = new Set(this.selectedStationIds || [])
      if (toggle && selected.has(stationId)) {
        selected.delete(stationId)
      } else {
        selected.add(stationId)
      }
      this.setSelectedStations([...selected], { keepPrimary: !toggle })
    } else {
      this.setSelectedStations([stationId])
    }
    this.selectedEdgeId = null
    this.selectedEdgeAnchor = null
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
      return
    }
    if (this.mode === 'route-draw') {
      if (!this.pendingEdgeStartStationId) {
        this.pendingEdgeStartStationId = stationId
        this.statusText = '连续布线已开始：请继续点击下一个点'
        return
      }
      if (this.pendingEdgeStartStationId === stationId) {
        this.statusText = '已停留当前点，请点击其他点继续布线'
        return
      }
      this.addEdgeBetweenStations(this.pendingEdgeStartStationId, stationId)
      this.pendingEdgeStartStationId = stationId
      this.statusText = '已连接并继续布线：请点击下一个点'
    }
  },

}

export { selectionActions }
