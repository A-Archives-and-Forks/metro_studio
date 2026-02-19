import { dedupeStationIds } from '../helpers'

function dedupeEdgeIds(ids, edgeIdSet) {
  const result = []
  const seen = new Set()
  for (const id of ids || []) {
    if (!edgeIdSet.has(id) || seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  return result
}

const selectionActions = {
  setMode(mode) {
    this.mode = mode
    if (mode !== 'add-edge' && mode !== 'route-draw') {
      this.pendingEdgeStartStationId = null
    }
    // 快速改站名模式
    if (mode === 'quick-rename' && !this.quickRename.active) {
      this.activateQuickRename()
    } else if (mode !== 'quick-rename' && this.quickRename.active) {
      this.exitQuickRename()
    }
    // 样式刷模式特殊处理
    if (mode === 'style-brush' && !this.styleBrush.active) {
      // 如果有选中的对象，自动拾取样式
      if (this.selectedStationIds.length === 1) {
        this.activateStyleBrush(this.selectedStationIds[0], 'station')
      } else if (this.selectedEdgeIds.length === 1) {
        this.activateStyleBrush(this.selectedEdgeIds[0], 'edge')
      } else if (this.activeLineId) {
        this.activateStyleBrush(this.activeLineId, 'line')
      } else {
        this.statusText = '样式刷模式：请先选中一个对象作为样式源'
      }
    } else if (mode !== 'style-brush' && this.styleBrush.active) {
      // 退出样式刷模式时清空样式
      this.deactivateStyleBrush()
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
      if (!options.keepEdges) {
        this.selectedEdgeId = null
        this.selectedEdgeIds = []
        this.selectedEdgeAnchor = null
      }
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
    this.selectedEdgeIds = []
    this.selectedEdgeAnchor = null
    this.selectedAnnotationId = null
  },

  selectStations(stationIds, options = {}) {
    const replace = options.replace !== false
    if (replace) {
      this.setSelectedStations(stationIds, { keepEdges: Boolean(options.keepEdges) })
      return
    }
    const merged = [...this.selectedStationIds, ...(stationIds || [])]
    this.setSelectedStations(merged, { keepPrimary: true, keepEdges: Boolean(options.keepEdges) })
  },

  setSelectedEdges(edgeIds, options = {}) {
    if (!this.project) return
    const edgeIdSet = new Set(this.project.edges.map((edge) => edge.id))
    const sanitized = dedupeEdgeIds(edgeIds, edgeIdSet)
    this.selectedEdgeIds = sanitized
    this.selectedEdgeId = sanitized.length ? sanitized[sanitized.length - 1] : null
    if (sanitized.length) {
      if (!options.keepStations) {
        this.selectedStationId = null
        this.selectedStationIds = []
      }
      if (
        this.selectedEdgeAnchor &&
        (this.selectedEdgeAnchor.edgeId !== this.selectedEdgeId || !sanitized.includes(this.selectedEdgeAnchor.edgeId))
      ) {
        this.selectedEdgeAnchor = null
      }
    } else {
      this.selectedEdgeAnchor = null
    }
  },

  selectEdges(edgeIds, options = {}) {
    const replace = options.replace !== false
    if (replace) {
      this.setSelectedEdges(edgeIds, { keepStations: Boolean(options.keepStations) })
      return
    }
    const merged = [...(this.selectedEdgeIds || []), ...(edgeIds || [])]
    this.setSelectedEdges(merged, { keepStations: Boolean(options.keepStations) })
  },

  clearEdgeSelection() {
    this.selectedEdgeId = null
    this.selectedEdgeIds = []
    this.selectedEdgeAnchor = null
  },

  selectAllStations() {
    if (!this.project) return
    this.setSelectedStations(this.project.stations.map((station) => station.id))
    this.statusText = `已全选 ${this.selectedStationIds.length} 个站点`
  },

  selectLineStationsOnly(lineId) {
    if (!this.project) return
    const line = this.project.lines.find((l) => l.id === lineId)
    if (!line) return
    const edgeIdSet = new Set(line.edgeIds || [])
    const stationIdSet = new Set()
    for (const edge of this.project.edges || []) {
      if (!edgeIdSet.has(edge.id)) continue
      if (edge.fromStationId) stationIdSet.add(edge.fromStationId)
      if (edge.toStationId) stationIdSet.add(edge.toStationId)
    }
    this.setSelectedStations([...stationIdSet], { keepEdges: false })
    this.statusText = `已选中 ${line.nameZh} 所有站点: ${stationIdSet.size} 个`
  },

  selectLine(lineId) {
    if (!this.project) return
    const line = this.project.lines.find((l) => l.id === lineId)
    if (!line) return
    if (!Array.isArray(line.edgeIds) || !line.edgeIds.length) {
      this.statusText = `线路 ${line.nameZh} 无线段`
      return
    }
    const edgeIdSet = new Set(line.edgeIds)
    const stationIdSet = new Set()
    for (const edge of this.project.edges || []) {
      if (!edgeIdSet.has(edge.id)) continue
      if (edge.fromStationId) stationIdSet.add(edge.fromStationId)
      if (edge.toStationId) stationIdSet.add(edge.toStationId)
    }
    this.setSelectedEdges([...line.edgeIds], { keepStations: false })
    this.setSelectedStations([...stationIdSet], { keepEdges: true, keepPrimary: true })
    this.statusText = `已选中 ${line.nameZh}: ${line.edgeIds.length} 条线段, ${stationIdSet.size} 个站点`
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
    this.selectedEdgeIds = []
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

  activateQuickRename() {
    if (!this.project) {
      this.statusText = '快速改站名模式：没有项目'
      this.mode = 'select'
      return
    }

    let targetLineId = null
    let targetLine = null

    if (this.selectedEdgeIds?.length > 0) {
      const edge = this.project.edges.find(e => e.id === this.selectedEdgeIds[0])
      if (edge?.sharedByLineIds?.length > 0) {
        targetLineId = edge.sharedByLineIds[0]
      }
    } else if (this.activeLineId) {
      targetLineId = this.activeLineId
    }

    if (!targetLineId) {
      this.statusText = '快速改站名模式：请先选中一条线路或线段'
      this.mode = 'select'
      return
    }

    this.activeLineId = targetLineId
    targetLine = this.project.lines.find(l => l.id === targetLineId)

    if (!targetLine || !targetLine.edgeIds || !targetLine.edgeIds.length) {
      this.statusText = '快速改站名模式：选中线路没有线段'
      this.mode = 'select'
      return
    }

    const edgeIdSet = new Set(targetLine.edgeIds)
    const edges = this.project.edges.filter(e => edgeIdSet.has(e.id))
    if (!edges.length) {
      this.statusText = '快速改站名模式：没有可用线段'
      this.mode = 'select'
      return
    }

    const stationOrder = this.getStationOrderFromEdges(edges)
    if (stationOrder.length === 0) {
      this.statusText = '快速改站名模式：无法确定站点顺序'
      this.mode = 'select'
      return
    }

    this.quickRename.active = true
    this.quickRename.stationOrder = stationOrder
    this.quickRename.currentIndex = 0
    this.setSelectedStations([stationOrder[0]])
    this.statusText = `快速改站名模式：第 1 / ${stationOrder.length} 站（${targetLine.nameZh}）`
  },

  getStationOrderFromEdges(edges) {
    const adjacency = new Map()
    const degree = new Map()
    const stationIds = new Set()

    for (const edge of edges) {
      stationIds.add(edge.fromStationId)
      stationIds.add(edge.toStationId)

      if (!adjacency.has(edge.fromStationId)) {
        adjacency.set(edge.fromStationId, [])
      }
      if (!adjacency.has(edge.toStationId)) {
        adjacency.set(edge.toStationId, [])
      }

      adjacency.get(edge.fromStationId).push(edge.toStationId)
      adjacency.get(edge.toStationId).push(edge.fromStationId)

      degree.set(edge.fromStationId, (degree.get(edge.fromStationId) || 0) + 1)
      degree.set(edge.toStationId, (degree.get(edge.toStationId) || 0) + 1)
    }

    const order = []
    const visited = new Set()
    const stationIdArray = Array.from(stationIds)

    let startId = null
    for (const id of stationIdArray) {
      const deg = degree.get(id) || 0
      if (deg === 1) {
        startId = id
        break
      }
    }

    if (!startId && stationIdArray.length > 0) {
      startId = stationIdArray[0]
    }

    if (startId) {
      visited.add(startId)
      order.push(startId)

      let currentId = startId
      while (true) {
        const neighbors = adjacency.get(currentId) || []
        const nextId = neighbors.find(nid => !visited.has(nid))

        if (!nextId) break

        visited.add(nextId)
        order.push(nextId)
        currentId = nextId
      }
    }

    for (const id of stationIdArray) {
      if (!visited.has(id)) {
        visited.add(id)
        order.push(id)
      }
    }

    return order
  },

  quickRenameNext() {
    if (!this.quickRename.active) return
    if (this.quickRename.currentIndex < this.quickRename.stationOrder.length - 1) {
      this.quickRename.currentIndex++
      const stationId = this.quickRename.stationOrder[this.quickRename.currentIndex]
      this.setSelectedStations([stationId])
      this.statusText = `快速改站名模式：第 ${this.quickRename.currentIndex + 1} / ${this.quickRename.stationOrder.length} 站`
    }
  },

  quickRenamePrev() {
    if (!this.quickRename.active) return
    if (this.quickRename.currentIndex > 0) {
      this.quickRename.currentIndex--
      const stationId = this.quickRename.stationOrder[this.quickRename.currentIndex]
      this.setSelectedStations([stationId])
      this.statusText = `快速改站名模式：第 ${this.quickRename.currentIndex + 1} / ${this.quickRename.stationOrder.length} 站`
    }
  },

  exitQuickRename() {
    this.quickRename.active = false
    this.quickRename.currentIndex = 0
    this.quickRename.stationOrder = []
    this.clearSelection()
    this.statusText = '快速改站名模式已退出'
  },

}

export { selectionActions }
