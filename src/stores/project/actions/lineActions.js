import { normalizeHexColor, pickDistinctLineColor, pickLineColor } from '../../../lib/colors'
import { createId } from '../../../lib/ids'
import { normalizeLineStyle } from '../../../lib/lineStyles'

function getNextLineNumber(lines) {
  let maxNum = 0
  for (const line of lines || []) {
    const match = line.nameZh?.match(/(\d+)号线/)
    if (match) {
      const num = parseInt(match[1], 10)
      if (!isNaN(num) && num > maxNum) {
        maxNum = num
      }
    }
  }
  return maxNum + 1
}

export const lineActions = {
  addLine({ nameZh, nameEn, color, status = 'open', style = 'solid' }) {
    if (!this.project) return null
    const nextLineNum = getNextLineNumber(this.project.lines)
    const existingLineColors = (this.project.lines || []).map((line) => line?.color).filter(Boolean)
    const autoColor = pickDistinctLineColor(existingLineColors, nextLineNum - 1)
    const normalizedStatus = ['open', 'construction', 'proposed'].includes(status) ? status : 'open'
    const normalizedStyle = normalizeLineStyle(style)
    const line = {
      id: createId('line'),
      key: `manual_${Date.now()}_${nextLineNum - 1}`,
      nameZh: nameZh?.trim() || `${nextLineNum}号线`,
      nameEn: nameEn?.trim() || `Line ${nextLineNum}`,
      color: normalizeHexColor(color, autoColor || pickLineColor(nextLineNum - 1)),
      status: normalizedStatus,
      style: normalizedStyle,
      edgeIds: [],
    }
    this.project.lines.push(line)
    this.activeLineId = line.id
    this.touchProject(`新增线路: ${line.nameZh}`)
    return line
  },

  updateLine(lineId, patch = {}) {
    if (!this.project) return
    const line = this.project.lines.find((item) => item.id === lineId)
    if (!line) return

    const next = { ...line }
    if (patch.nameZh != null) next.nameZh = String(patch.nameZh).trim() || next.nameZh
    if (patch.nameEn != null) next.nameEn = String(patch.nameEn).trim()
    if (patch.color != null) {
      const colorIndex = this.project.lines.findIndex((item) => item.id === lineId)
      next.color = normalizeHexColor(patch.color, pickLineColor(Math.max(0, colorIndex)))
    }
    if (patch.status != null && ['open', 'construction', 'proposed'].includes(patch.status)) {
      next.status = patch.status
    }
    if (patch.style != null) {
      next.style = normalizeLineStyle(patch.style)
    }
    Object.assign(line, next)
    this.recomputeStationLineMembership()
    this.touchProject(`更新线路: ${line.nameZh}`)
  },

  deleteLine(lineId) {
    if (!this.project) return
    const line = this.project.lines.find((item) => item.id === lineId)
    if (!line) return

    const lineSet = new Set([lineId])
    const affectedStationIdSet = new Set()
    for (const edge of this.project.edges) {
      if (!(edge.sharedByLineIds || []).some((id) => lineSet.has(id))) continue
      affectedStationIdSet.add(edge.fromStationId)
      affectedStationIdSet.add(edge.toStationId)
    }
    this.project.lines = this.project.lines.filter((item) => item.id !== lineId)

    const nextEdges = []
    for (const edge of this.project.edges) {
      const shared = (edge.sharedByLineIds || []).filter((id) => !lineSet.has(id))
      if (!shared.length) continue
      nextEdges.push({ ...edge, sharedByLineIds: shared })
    }
    this.project.edges = nextEdges
    const edgeIdSet = new Set(nextEdges.map((edge) => edge.id))
    for (const item of this.project.lines) {
      item.edgeIds = (item.edgeIds || []).filter((edgeId) => edgeIdSet.has(edgeId))
    }
    if (!this.project.lines.some((item) => item.id === this.activeLineId)) {
      this.activeLineId = this.project.lines[0]?.id || null
    }
    const existingEdgeIdSet = new Set(this.project.edges.map((edge) => edge.id))
    if (Array.isArray(this.selectedEdgeIds) && this.selectedEdgeIds.length) {
      this.selectedEdgeIds = this.selectedEdgeIds.filter((edgeId) => existingEdgeIdSet.has(edgeId))
    }
    if (this.selectedEdgeId && !existingEdgeIdSet.has(this.selectedEdgeId)) {
      this.selectedEdgeId = this.selectedEdgeIds.length ? this.selectedEdgeIds[this.selectedEdgeIds.length - 1] : null
      if (!this.selectedEdgeId) {
        this.selectedEdgeAnchor = null
      }
    }
    if (this.selectedEdgeAnchor) {
      const anchorEdgeExists = this.project.edges.some((edge) => edge.id === this.selectedEdgeAnchor.edgeId)
      if (!anchorEdgeExists) {
        this.selectedEdgeAnchor = null
      }
    }
    this.recomputeStationLineMembership()
    const removableStationIdSet = new Set()
    for (const station of this.project.stations) {
      if (!affectedStationIdSet.has(station.id)) continue
      if ((station.lineIds || []).length === 0) {
        removableStationIdSet.add(station.id)
      }
    }
    if (removableStationIdSet.size) {
      this.project.stations = this.project.stations.filter((station) => !removableStationIdSet.has(station.id))
      this.project.manualTransfers = (this.project.manualTransfers || []).filter(
        (transfer) =>
          !removableStationIdSet.has(transfer?.stationAId) && !removableStationIdSet.has(transfer?.stationBId),
      )
      if (this.selectedStationId && removableStationIdSet.has(this.selectedStationId)) {
        this.selectedStationId = null
      }
      if (this.selectedStationIds.length) {
        this.selectedStationIds = this.selectedStationIds.filter((id) => !removableStationIdSet.has(id))
      }
      if (this.pendingEdgeStartStationId && removableStationIdSet.has(this.pendingEdgeStartStationId)) {
        this.pendingEdgeStartStationId = null
      }
      this.recomputeStationLineMembership()
    }
    this.touchProject(`删除线路: ${line.nameZh}`)
  },

  moveLineUp(lineId) {
    if (!this.project) return false
    const index = this.project.lines.findIndex((l) => l.id === lineId)
    if (index <= 0) return false
    const lines = this.project.lines
    ;[lines[index - 1], lines[index]] = [lines[index], lines[index - 1]]
    this.touchProject('移动线路顺序')
    return true
  },

  moveLineDown(lineId) {
    if (!this.project) return false
    const index = this.project.lines.findIndex((l) => l.id === lineId)
    if (index === -1 || index >= this.project.lines.length - 1) return false
    const lines = this.project.lines
    ;[lines[index], lines[index + 1]] = [lines[index + 1], lines[index]]
    this.touchProject('移动线路顺序')
    return true
  },

  findOrCreateActiveLine() {
    if (!this.project) return null
    let line = this.project.lines.find((item) => item.id === this.activeLineId)
    if (!line) {
      line = this.addLine({})
    }
    return line
  },
}
