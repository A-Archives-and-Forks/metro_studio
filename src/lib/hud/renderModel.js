import { getDisplayLineName } from '../lineNaming'

const DEFAULT_MESSAGE = '请选择线路'
const HUD_FIXED_WIDTH = 4400
const HUD_SINGLE_ROW_HEIGHT = 430
const HUD_DOUBLE_ROW_HEIGHT = 800
const HUD_FOLD_THRESHOLD = 30

class MinHeap {
  constructor() {
    this.items = []
  }

  push(node) {
    this.items.push(node)
    this.bubbleUp(this.items.length - 1)
  }

  pop() {
    if (!this.items.length) return null
    if (this.items.length === 1) return this.items.pop()
    const top = this.items[0]
    this.items[0] = this.items.pop()
    this.bubbleDown(0)
    return top
  }

  bubbleUp(index) {
    let current = index
    while (current > 0) {
      const parent = Math.floor((current - 1) / 2)
      if (this.items[parent].dist <= this.items[current].dist) break
      const temp = this.items[parent]
      this.items[parent] = this.items[current]
      this.items[current] = temp
      current = parent
    }
  }

  bubbleDown(index) {
    let current = index
    const length = this.items.length
    while (true) {
      const left = current * 2 + 1
      const right = left + 1
      let smallest = current
      if (left < length && this.items[left].dist < this.items[smallest].dist) {
        smallest = left
      }
      if (right < length && this.items[right].dist < this.items[smallest].dist) {
        smallest = right
      }
      if (smallest === current) break
      const temp = this.items[current]
      this.items[current] = this.items[smallest]
      this.items[smallest] = temp
      current = smallest
    }
  }
}

export function buildHudLineRoute(project, lineId) {
  const lines = project?.lines || []
  const edges = project?.edges || []
  const stations = project?.stations || []
  const line = lines.find((item) => item.id === lineId)
  if (!line) {
    return {
      ready: false,
      reason: DEFAULT_MESSAGE,
      line: null,
      stationIds: [],
      directionOptions: [],
    }
  }

  const stationById = new Map(stations.map((station) => [station.id, station]))
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]))
  const adjacency = new Map()

  const lineEdges = []
  for (const edgeId of line.edgeIds || []) {
    const edge = edgeById.get(edgeId)
    if (!edge) continue
    if (!Array.isArray(edge.sharedByLineIds) || !edge.sharedByLineIds.includes(line.id)) continue
    if (!stationById.has(edge.fromStationId) || !stationById.has(edge.toStationId)) continue
    lineEdges.push(edge)
    ensureNode(adjacency, edge.fromStationId)
    ensureNode(adjacency, edge.toStationId)
    const weight = Number.isFinite(edge.lengthMeters) && edge.lengthMeters > 0 ? edge.lengthMeters : 1
    adjacency.get(edge.fromStationId).push({ to: edge.toStationId, weight, edgeId: edge.id })
    adjacency.get(edge.toStationId).push({ to: edge.fromStationId, weight, edgeId: edge.id })
  }

  if (!lineEdges.length || !adjacency.size) {
    return {
      ready: false,
      reason: '所选线路暂无有效线段',
      line,
      stationIds: [],
      directionOptions: [],
    }
  }

  const componentIds = findLargestConnectedComponent(adjacency)
  if (componentIds.length < 2) {
    return {
      ready: false,
      reason: '所选线路可用站点不足',
      line,
      stationIds: componentIds,
      directionOptions: [],
    }
  }

  const componentSet = new Set(componentIds)
  const componentAdjacency = new Map()
  for (const stationId of componentIds) {
    const neighbors = (adjacency.get(stationId) || []).filter((entry) => componentSet.has(entry.to))
    componentAdjacency.set(stationId, neighbors)
  }

  const isCycleCandidate =
    Boolean(line.isLoop) &&
    componentIds.length >= 3 &&
    componentIds.every((stationId) => (componentAdjacency.get(stationId) || []).length === 2)

  if (isCycleCandidate) {
    const cycle = traceCycle(componentAdjacency, stationById)
    if (cycle.length === componentIds.length) {
      const forward = cycle
      const reverse = [cycle[0], ...cycle.slice(1).reverse()]
      return {
        ready: true,
        reason: '',
        line,
        stationIds: forward,
        directionOptions: [
          {
            key: `${cycle[0]}::forward`,
            labelZh: '正向',
            labelEn: 'Forward',
            stationIds: forward,
            toStationId: forward[forward.length - 1],
          },
          {
            key: `${cycle[0]}::reverse`,
            labelZh: '反向',
            labelEn: 'Reverse',
            stationIds: reverse,
            toStationId: reverse[reverse.length - 1],
          },
        ],
      }
    }
  }

  const terminalIds = componentIds.filter((stationId) => (componentAdjacency.get(stationId) || []).length <= 1)
  const candidateIds = terminalIds.length >= 2 ? terminalIds : componentIds
  const farthest = findFarthestPair(componentAdjacency, candidateIds)
  if (!farthest) {
    return {
      ready: false,
      reason: '无法计算线路方向',
      line,
      stationIds: componentIds,
      directionOptions: [],
    }
  }

  const mainPath = buildShortestPath(componentAdjacency, farthest.from, farthest.to)
  if (mainPath.length < 2) {
    return {
      ready: false,
      reason: '线路路径长度不足',
      line,
      stationIds: mainPath,
      directionOptions: [],
    }
  }

  const forwardTo = stationById.get(mainPath[mainPath.length - 1])
  const backwardTo = stationById.get(mainPath[0])
  const forward = mainPath
  const backward = [...mainPath].reverse()

  return {
    ready: true,
    reason: '',
    line,
    stationIds: forward,
    directionOptions: [
      {
        key: `${forward[0]}->${forward[forward.length - 1]}`,
        labelZh: `开往 ${forwardTo?.nameZh || forward[forward.length - 1]}`,
        labelEn: `To ${forwardTo?.nameEn || forwardTo?.nameZh || forward[forward.length - 1]}`,
        stationIds: forward,
        toStationId: forward[forward.length - 1],
      },
      {
        key: `${backward[0]}->${backward[backward.length - 1]}`,
        labelZh: `开往 ${backwardTo?.nameZh || backward[backward.length - 1]}`,
        labelEn: `To ${backwardTo?.nameEn || backwardTo?.nameZh || backward[backward.length - 1]}`,
        stationIds: backward,
        toStationId: backward[backward.length - 1],
      },
    ],
  }
}

export function getHudDirectionOptions(project, lineId) {
  return buildHudLineRoute(project, lineId).directionOptions
}

export function buildVehicleHudRenderModel(project, options = {}) {
  const lineId = options.lineId || ''
  const route = options.route || buildHudLineRoute(project, lineId)
  const lines = project?.lines || []
  const stations = project?.stations || []
  const stationById = new Map(stations.map((station) => [station.id, station]))
  const lineById = new Map(lines.map((line) => [toIdKey(line.id), line]))

  if (!route.ready) {
    return createEmptyModel(route.reason || DEFAULT_MESSAGE)
  }

  const directionOptions = route.directionOptions || []
  if (!directionOptions.length) {
    return createEmptyModel('缺少可用方向')
  }

  const direction =
    directionOptions.find((item) => item.key === options.directionKey) ||
    directionOptions[0]
  const stationIds = direction.stationIds || []
  if (stationIds.length < 2) {
    return createEmptyModel('缺少可用站点')
  }

  const hasBend = stationIds.length > HUD_FOLD_THRESHOLD
  const row1Count = hasBend ? Math.ceil(stationIds.length / 2) : stationIds.length
  const row2Count = stationIds.length - row1Count
  const maxRowCount = Math.max(row1Count, row2Count || 0)
  const sidePadding = 120
  const topPadding = 66
  const bendOffset = hasBend ? 66 : 0
  const minGap = 74
  const minWidth = sidePadding * 2 + bendOffset + Math.max(1, maxRowCount - 1) * minGap
  const width = hasBend ? Math.max(HUD_FIXED_WIDTH, minWidth) : HUD_FIXED_WIDTH
  const row1Y = topPadding + 154
  const topStationIds = stationIds.slice(0, row1Count)
  const bottomStationIds = stationIds.slice(row1Count)
  const topCalloutDownExtent = hasBend ? estimateRowCalloutDownExtent(topStationIds, stationById, lineId) : 0
  const bottomCalloutUpExtent = hasBend ? estimateRowCalloutUpExtent(bottomStationIds, stationById, lineId) : 0
  const foldGap = hasBend ? Math.max(206, topCalloutDownExtent + bottomCalloutUpExtent + 56) : 0
  const row2Y = hasBend ? row1Y + foldGap : row1Y
  const height = hasBend ? HUD_DOUBLE_ROW_HEIGHT : HUD_SINGLE_ROW_HEIGHT

  const trackStartX = sidePadding
  const trackEndX = width - sidePadding - bendOffset
  const row1Gap = row1Count > 1 ? (trackEndX - trackStartX) / (row1Count - 1) : 0
  const row2Gap = row2Count > 1 ? (trackEndX - trackStartX) / (row2Count - 1) : 0

  const positionedStations = []
  for (let i = 0; i < row1Count; i += 1) {
    const stationId = stationIds[i]
    const station = stationById.get(stationId)
    if (!station) continue
    positionedStations.push(buildStationRender(station, i === 0, i === stationIds.length - 1, lineId, lineById, {
      x: trackStartX + row1Gap * i,
      y: row1Y,
      rowIndex: 0,
    }))
  }
  for (let i = 0; i < row2Count; i += 1) {
    const stationId = stationIds[row1Count + i]
    const station = stationById.get(stationId)
    if (!station) continue
    const overallIndex = row1Count + i
    positionedStations.push(
      buildStationRender(station, overallIndex === 0, overallIndex === stationIds.length - 1, lineId, lineById, {
        x: trackEndX - row2Gap * i,
        y: row2Y,
        rowIndex: 1,
      }),
    )
  }

  const points = []
  const row1Points = positionedStations.filter((station) => station.rowIndex === 0).map((station) => [station.x, station.y])
  const row2Points = positionedStations.filter((station) => station.rowIndex === 1).map((station) => [station.x, station.y])
  for (const point of row1Points) {
    points.push(point)
  }
  if (hasBend && row2Points.length) {
    const lastTop = row1Points[row1Points.length - 1]
    const firstBottom = row2Points[0]
    points.push([lastTop[0] + bendOffset, lastTop[1]])
    points.push([lastTop[0] + bendOffset, firstBottom[1]])
    points.push([firstBottom[0], firstBottom[1]])
    for (let i = 1; i < row2Points.length; i += 1) {
      points.push(row2Points[i])
    }
  }
  const trackPath = pointsToRoundedPath(points, 22)
  const chevrons = buildChevronMarks(positionedStations)

  const terminalNameZh = stationById.get(direction.toStationId)?.nameZh || ''
  const terminalNameEn = stationById.get(direction.toStationId)?.nameEn || ''
  const lineDisplayName = getDisplayLineName(route.line, 'zh') || route.line?.nameZh || ''

  return {
    ready: true,
    reason: '',
    width,
    height,
    trackPath,
    lineColor: route.line?.color || '#2563EB',
    lineNameZh: lineDisplayName,
    lineNameEn: route.line?.nameEn || '',
    directionLabelZh: direction.labelZh || '',
    directionLabelEn: direction.labelEn || '',
    terminalNameZh,
    terminalNameEn,
    stationCount: positionedStations.length,
    hasBend,
    chevrons,
    stations: positionedStations,
  }
}

function createEmptyModel(reason) {
  return {
    ready: false,
    reason,
    width: 1220,
    height: 360,
    trackPath: '',
    lineColor: '#2563EB',
    lineNameZh: '',
    lineNameEn: '',
    directionLabelZh: '',
    directionLabelEn: '',
    terminalNameZh: '',
    terminalNameEn: '',
    stationCount: 0,
    hasBend: false,
    chevrons: [],
    stations: [],
  }
}

function buildStationRender(station, isStart, isEnd, lineId, lineById, position) {
  const { nameZh, nameEn } = resolveHudStationNames(station)
  const currentLineKey = toIdKey(lineId)
  const transferLineKeys = [...new Set((station.lineIds || []).map((id) => toIdKey(id)).filter(Boolean))]
    .filter((key) => key !== currentLineKey)
  const transferBadges = transferLineKeys
    .map((key) => lineById.get(key))
    .filter(Boolean)
    .slice(0, 6)
    .map((line) => ({
      lineId: line.id,
      label: resolveLineBadgeLabel(line),
      text: resolveLineBadgeText(line),
      color: line.color || '#2563EB',
      badgeWidth: resolveTransferBadgeWidth(resolveLineBadgeText(line)),
    }))
  const labelAnchor = 'middle'
  const labelX = position.x
  const labelBelow = position.rowIndex === 1
  const labelAngle = resolveHudLabelAngle(nameZh, nameEn)
  const labelOffset = resolveHudLabelOffset(nameZh, nameEn)
  const labelY = labelBelow ? position.y + (76 + labelOffset) : position.y - (58 + labelOffset)
  const labelEnY = labelBelow ? labelY + 32 : labelY + 27
  const calloutDirection = labelY >= position.y ? -1 : 1
  const connectorDotY = position.y + calloutDirection * 28
  const transferLabelZhY = calloutDirection > 0 ? position.y + 64 : position.y - 64
  const transferLabelEnY = calloutDirection > 0 ? position.y + 84 : position.y - 84
  const transferBadgeY = calloutDirection > 0 ? position.y + 96 : position.y - 128

  return {
    id: station.id,
    x: position.x,
    y: position.y,
    rowIndex: position.rowIndex,
    nameZh,
    nameEn,
    isTerminal: Boolean(isStart || isEnd),
    isInterchange: transferBadges.length > 0,
    transferBadges,
    labelX,
    labelY,
    labelEnY,
    labelAnchor,
    labelAngle,
    labelBelow,
    connectorDotY,
    transferCalloutDirection: calloutDirection,
    transferLabelZhY,
    transferLabelEnY,
    transferBadgeY,
  }
}

function resolveHudStationNames(station) {
  const zh = String(station?.nameZh || '').trim()
  const en = String(station?.nameEn || '').trim()
  if (zh === '山东职业学院') {
    return {
      nameZh: '山东职业学院',
      nameEn: 'Shandong Vocational College',
    }
  }
  return {
    nameZh: zh,
    nameEn: en,
  }
}

function resolveHudLabelAngle(nameZh, nameEn) {
  return 0
}

function resolveHudLabelOffset(nameZh, nameEn) {
  const zhScore = String(nameZh || '').length * 1.9
  const enScore = String(nameEn || '').length
  const score = Math.max(zhScore, enScore)
  if (score >= 30) return 12
  if (score >= 22) return 6
  return 0
}

function resolveLineBadgeLabel(line) {
  const candidates = [line?.nameZh, line?.nameEn, line?.key]
  for (const value of candidates) {
    const normalized = String(value || '').trim()
    if (!normalized) continue
    const zhMatch = normalized.match(/(\d+)\s*号?\s*线/u)
    if (zhMatch?.[1]) return zhMatch[1]
    const enMatch = normalized.match(/\bline\s*([0-9]+)/i)
    if (enMatch?.[1]) return enMatch[1]
    const directNumber = normalized.match(/([0-9]+)/)
    if (directNumber?.[1]) return directNumber[1]
  }
  const fallback = getDisplayLineName(line, 'zh') || line?.nameZh || line?.nameEn || ''
  return String(fallback).trim().slice(0, 2) || '?'
}

function resolveLineBadgeText(line) {
  const nameZh = String(line?.nameZh || '').trim()
  if (nameZh) return nameZh

  const displayZh = String(getDisplayLineName(line, 'zh') || '').trim()
  if (displayZh) return displayZh

  const nameEn = String(line?.nameEn || '').trim()
  if (nameEn) return nameEn.slice(0, 12)

  return `${resolveLineBadgeLabel(line)}号线`
}

function resolveTransferBadgeWidth(text) {
  const value = String(text || '')
  let units = 0
  for (const ch of value) {
    if (/[\u4e00-\u9fff]/u.test(ch)) units += 1.65
    else units += 1
  }
  return Math.max(64, Math.min(136, Math.round(26 + units * 10)))
}

function toIdKey(id) {
  if (id == null) return ''
  return String(id)
}

function estimateRowCalloutDownExtent(stationIds, stationById, lineId) {
  const maxBadgeCount = estimateMaxTransferBadgeCount(stationIds, stationById, lineId)
  if (maxBadgeCount <= 0) return 0
  return 122 + (maxBadgeCount - 1) * 30
}

function estimateRowCalloutUpExtent(stationIds, stationById, lineId) {
  const maxBadgeCount = estimateMaxTransferBadgeCount(stationIds, stationById, lineId)
  if (maxBadgeCount <= 0) return 0
  return 128 + (maxBadgeCount - 1) * 30
}

function estimateMaxTransferBadgeCount(stationIds, stationById, lineId) {
  const currentLineKey = toIdKey(lineId)
  let maxCount = 0
  for (const stationId of stationIds) {
    const station = stationById.get(stationId)
    if (!station) continue
    const transferCount = [...new Set((station.lineIds || []).map((id) => toIdKey(id)).filter(Boolean))]
      .filter((key) => key !== currentLineKey)
      .length
    if (transferCount > maxCount) maxCount = transferCount
  }
  return Math.min(6, maxCount)
}

function buildChevronMarks(stations) {
  const marks = []
  for (let i = 0; i < stations.length - 1; i += 1) {
    const current = stations[i]
    const next = stations[i + 1]
    if (current.rowIndex !== next.rowIndex) continue
    const dx = next.x - current.x
    const dy = next.y - current.y
    const segmentLength = Math.hypot(dx, dy)
    if (segmentLength < 70) continue
    const ux = dx / segmentLength
    const uy = dy / segmentLength
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI
    const centerX = (current.x + next.x) / 2
    const centerY = (current.y + next.y) / 2
    const spacing = 16
    marks.push({
      id: `${current.id}_${next.id}_a`,
      x: centerX - ux * spacing * 0.7,
      y: centerY - uy * spacing * 0.7,
      angle,
    })
    marks.push({
      id: `${current.id}_${next.id}_b`,
      x: centerX + ux * spacing * 0.7,
      y: centerY + uy * spacing * 0.7,
      angle,
    })
  }
  return marks
}

function ensureNode(adjacency, stationId) {
  if (!adjacency.has(stationId)) adjacency.set(stationId, [])
}

function findLargestConnectedComponent(adjacency) {
  const visited = new Set()
  let best = []
  for (const stationId of adjacency.keys()) {
    if (visited.has(stationId)) continue
    const queue = [stationId]
    let head = 0
    visited.add(stationId)
    const component = []
    while (head < queue.length) {
      const current = queue[head]
      head += 1
      component.push(current)
      for (const neighbor of adjacency.get(current) || []) {
        if (visited.has(neighbor.to)) continue
        visited.add(neighbor.to)
        queue.push(neighbor.to)
      }
    }
    if (component.length > best.length) {
      best = component
    }
  }
  return best
}

function traceCycle(adjacency, stationById) {
  const nodes = [...adjacency.keys()]
  if (!nodes.length) return []
  const sorted = [...nodes].sort((a, b) => {
    const nameA = stationById.get(a)?.nameZh || a
    const nameB = stationById.get(b)?.nameZh || b
    return nameA.localeCompare(nameB, 'zh-Hans-CN')
  })
  const start = sorted[0]
  const neighbors = adjacency.get(start) || []
  if (neighbors.length !== 2) return []
  const order = [start]
  const visited = new Set([start])
  let previous = start
  let current = neighbors[0].to

  while (current !== start) {
    if (visited.has(current)) return []
    visited.add(current)
    order.push(current)
    const options = adjacency.get(current) || []
    const next = options.find((entry) => entry.to !== previous)
    if (!next) return []
    previous = current
    current = next.to
  }

  return order
}

function findFarthestPair(adjacency, candidates) {
  let best = null
  let maxDistance = Number.NEGATIVE_INFINITY

  for (const start of candidates) {
    const { dist } = dijkstra(adjacency, start)
    for (const end of candidates) {
      if (end === start) continue
      const distance = dist.get(end)
      if (!Number.isFinite(distance)) continue
      if (distance > maxDistance) {
        maxDistance = distance
        best = { from: start, to: end, distance }
      }
    }
  }

  return best
}

function buildShortestPath(adjacency, from, to) {
  const { prev } = dijkstra(adjacency, from)
  const path = []
  let cursor = to
  const seen = new Set()
  while (cursor) {
    if (seen.has(cursor)) break
    seen.add(cursor)
    path.push(cursor)
    if (cursor === from) break
    cursor = prev.get(cursor)
  }
  path.reverse()
  if (!path.length || path[0] !== from) return []
  return path
}

function dijkstra(adjacency, start) {
  const dist = new Map()
  const prev = new Map()
  const heap = new MinHeap()

  for (const stationId of adjacency.keys()) {
    dist.set(stationId, Number.POSITIVE_INFINITY)
  }
  dist.set(start, 0)
  heap.push({ stationId: start, dist: 0 })

  while (true) {
    const current = heap.pop()
    if (!current) break
    const known = dist.get(current.stationId)
    if (current.dist > known) continue
    for (const edge of adjacency.get(current.stationId) || []) {
      const nextDist = current.dist + edge.weight
      if (nextDist >= (dist.get(edge.to) ?? Number.POSITIVE_INFINITY)) continue
      dist.set(edge.to, nextDist)
      prev.set(edge.to, current.stationId)
      heap.push({ stationId: edge.to, dist: nextDist })
    }
  }

  return { dist, prev }
}

function pointsToRoundedPath(points, radius) {
  if (!points.length) return ''
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`
  if (points.length === 2) {
    return `M ${points[0][0]} ${points[0][1]} L ${points[1][0]} ${points[1][1]}`
  }

  const safeRadius = Math.max(0, radius)
  let d = `M ${points[0][0]} ${points[0][1]}`

  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1]
    const curr = points[i]
    const next = points[i + 1]

    const inVec = [curr[0] - prev[0], curr[1] - prev[1]]
    const outVec = [next[0] - curr[0], next[1] - curr[1]]
    const inLen = Math.hypot(inVec[0], inVec[1])
    const outLen = Math.hypot(outVec[0], outVec[1])

    if (inLen < 1e-6 || outLen < 1e-6 || safeRadius < 0.5) {
      d += ` L ${curr[0]} ${curr[1]}`
      continue
    }

    const trim = Math.min(safeRadius, inLen * 0.48, outLen * 0.48)
    const inUnit = [inVec[0] / inLen, inVec[1] / inLen]
    const outUnit = [outVec[0] / outLen, outVec[1] / outLen]
    const p1 = [curr[0] - inUnit[0] * trim, curr[1] - inUnit[1] * trim]
    const p2 = [curr[0] + outUnit[0] * trim, curr[1] + outUnit[1] * trim]

    d += ` L ${p1[0]} ${p1[1]} Q ${curr[0]} ${curr[1]} ${p2[0]} ${p2[1]}`
  }

  const last = points[points.length - 1]
  d += ` L ${last[0]} ${last[1]}`
  return d
}
