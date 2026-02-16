import { getDisplayLineName } from '../lineNaming'
import { ensureNode, findLargestConnectedComponent, traceCycle, findFarthestPair, buildShortestPath } from './hudGraphAlgorithms'
import {
  pointsToRoundedPath, pointsToClosedRoundedPath, buildChevronMarks,
  resolveHudStationGap, estimateHudLineHeaderWidth, resolveTransferBadgeWidth,
  estimateRowCalloutDownExtent, estimateRowCalloutUpExtent, clamp,
} from './hudGeometry'

const DEFAULT_MESSAGE = '请选择线路'
const HUD_MIN_WIDTH = 1600
const HUD_MAX_WIDTH = 9600
const HUD_SINGLE_ROW_HEIGHT = 960
const HUD_DOUBLE_ROW_HEIGHT = 1750
const HUD_FOLD_THRESHOLD = 30
const HUD_STATION_LABEL_LIFT_PX = 6

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
      isSimpleLoop: false,
      isPartialLoop: false,
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
      isSimpleLoop: false,
      isPartialLoop: false,
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
      isSimpleLoop: false,
      isPartialLoop: false,
      isClosed: false,
      directionOptions: [],
    }
  }

  const componentSet = new Set(componentIds)
  const componentAdjacency = new Map()
  for (const stationId of componentIds) {
    const neighbors = (adjacency.get(stationId) || []).filter((entry) => componentSet.has(entry.to))
    componentAdjacency.set(stationId, neighbors)
  }
  const componentEdgeCount = lineEdges.reduce((count, edge) => {
    if (!componentSet.has(edge.fromStationId) || !componentSet.has(edge.toStationId)) return count
    return count + 1
  }, 0)
  const terminals = componentIds.filter((stationId) => (componentAdjacency.get(stationId) || []).length <= 1)
  const isClosed = terminals.length === 0 && componentIds.length >= 3
  const isLoopLikeLine = isLoopLineLike(line, isClosed)
  const hasCycle = componentEdgeCount >= componentIds.length

  const isCycleCandidate =
    isClosed &&
    componentIds.length >= 3 &&
    componentIds.every((stationId) => (componentAdjacency.get(stationId) || []).length === 2)
  const isPartialLoop = isClosed && hasCycle && !isCycleCandidate

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
        isSimpleLoop: true,
        isPartialLoop: false,
        isClosed,
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
      isSimpleLoop: false,
      isPartialLoop: false,
      isClosed,
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
      isSimpleLoop: false,
      isPartialLoop: false,
      isClosed,
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
    isSimpleLoop: false,
    isPartialLoop,
    isClosed,
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
  const isLoopLine =
    stationIds.length >= 3 &&
    (Boolean(route.isSimpleLoop) || Boolean(route.isPartialLoop) || Boolean(route.isClosed))
  if (isLoopLine) {
    return buildLoopHudRenderModel({
      route,
      direction,
      stationIds,
      stationById,
      lineById,
      lineId,
      isClosed: route.isClosed,
    })
  }

  const hasBend = stationIds.length > HUD_FOLD_THRESHOLD
  const row1Count = hasBend ? Math.ceil(stationIds.length / 2) : stationIds.length
  const row2Count = stationIds.length - row1Count
  const maxRowCount = Math.max(row1Count, row2Count || 0)
  const sidePadding = hasBend ? 230 : 220
  const topPadding = 120
  const bendOffset = hasBend ? 72 : 0
  const targetGap = hasBend ? 210 : resolveHudStationGap(stationIds.length)
  const rawWidth = sidePadding * 2 + bendOffset + Math.max(1, maxRowCount - 1) * targetGap
  const widthScale = hasBend ? 1.68 : stationIds.length <= 10 ? 1.32 : 1.5
  const width = clamp(rawWidth * widthScale, HUD_MIN_WIDTH, HUD_MAX_WIDTH)
  const row1Y = topPadding + 352
  const topStationIds = stationIds.slice(0, row1Count)
  const bottomStationIds = stationIds.slice(row1Count)
  const topCalloutDownExtent = hasBend ? estimateRowCalloutDownExtent(topStationIds, stationById, lineId) : 0
  const bottomCalloutUpExtent = hasBend ? estimateRowCalloutUpExtent(bottomStationIds, stationById, lineId) : 0
  const foldGap = hasBend ? Math.max(600, topCalloutDownExtent + bottomCalloutUpExtent + 200) : 0
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
  const headerMeta = buildHudHeaderMeta(route.line, route.isClosed, direction, stationById, stationIds)

  return {
    ready: true,
    reason: '',
    width,
    height,
    trackPath,
    lineColor: route.line?.color || '#2563EB',
    lineNameZh: lineDisplayName,
    lineNameEn: route.line?.nameEn || '',
    lineHeaderWidth: estimateHudLineHeaderWidth(lineDisplayName),
    lineBadgeZh: headerMeta.lineBadgeZh,
    lineBadgeEn: headerMeta.lineBadgeEn,
    nextStationZh: headerMeta.nextStationZh,
    nextStationEn: headerMeta.nextStationEn,
    routeSpanZh: headerMeta.routeSpanZh,
    routeSpanEn: headerMeta.routeSpanEn,
    destinationZh: headerMeta.destinationZh,
    destinationEn: headerMeta.destinationEn,
    directionLabelZh: direction.labelZh || '',
    directionLabelEn: direction.labelEn || '',
    terminalNameZh,
    terminalNameEn,
    stationCount: positionedStations.length,
    hasBend,
    isLoop: false,
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
    lineHeaderWidth: 220,
    lineBadgeZh: '',
    lineBadgeEn: '',
    nextStationZh: '',
    nextStationEn: '',
    routeSpanZh: '',
    routeSpanEn: '',
    destinationZh: '',
    destinationEn: '',
    directionLabelZh: '',
    directionLabelEn: '',
    terminalNameZh: '',
    terminalNameEn: '',
    stationCount: 0,
    hasBend: false,
    isLoop: false,
    chevrons: [],
    stations: [],
  }
}

function buildLoopHudRenderModel({ route, direction, stationIds, stationById, lineById, lineId, isClosed }) {
  const stationCount = stationIds.length
  const topCount = Math.ceil(stationCount / 2)
  const bottomCount = stationCount - topCount
  const sidePadding = 220
  const topPadding = 120
  const topY = topPadding + 352
  const bottomY = topY + 264
  const connectorOffset = 96
  const maxRowCount = Math.max(topCount, bottomCount || 0)
  const targetGap = resolveHudStationGap(stationCount)
  const rawWidth = sidePadding * 2 + Math.max(1, maxRowCount - 1) * targetGap + connectorOffset * 2
  const width = clamp(rawWidth * 1.56, HUD_MIN_WIDTH, HUD_MAX_WIDTH)
  const height = 1120
  const trackStartX = sidePadding
  const trackEndX = width - sidePadding
  const topGap = topCount > 1 ? (trackEndX - trackStartX) / (topCount - 1) : 0
  const bottomGap = bottomCount > 1 ? (trackEndX - trackStartX) / (bottomCount - 1) : 0

  const positionedStations = []
  for (let i = 0; i < topCount; i += 1) {
    const stationId = stationIds[i]
    const station = stationById.get(stationId)
    if (!station) continue
    positionedStations.push(
      buildStationRender(station, false, false, lineId, lineById, {
        x: trackStartX + topGap * i,
        y: topY,
        rowIndex: 0,
        isLoop: true,
      }),
    )
  }
  for (let i = 0; i < bottomCount; i += 1) {
    const stationId = stationIds[topCount + i]
    const station = stationById.get(stationId)
    if (!station) continue
    positionedStations.push(
      buildStationRender(station, false, false, lineId, lineById, {
        x: trackEndX - bottomGap * i,
        y: bottomY,
        rowIndex: 1,
        isLoop: true,
      }),
    )
  }

  const topRowPoints = positionedStations.filter((station) => station.rowIndex === 0).map((station) => [station.x, station.y])
  const bottomRowPoints = positionedStations.filter((station) => station.rowIndex === 1).map((station) => [station.x, station.y])
  const points = [...topRowPoints]
  if (bottomRowPoints.length) {
    points.push([trackEndX + connectorOffset, topY])
    points.push([trackEndX + connectorOffset, bottomY])
    points.push([trackEndX, bottomY])
    for (let i = 1; i < bottomRowPoints.length; i += 1) {
      points.push(bottomRowPoints[i])
    }
    points.push([trackStartX - connectorOffset, bottomY])
    points.push([trackStartX - connectorOffset, topY])
    points.push([trackStartX, topY])
  }
  const trackPath = pointsToClosedRoundedPath(points, 18)
  const chevrons = buildChevronMarks(positionedStations, { isLoop: true })
  const lineDisplayName = getDisplayLineName(route.line, 'zh') || route.line?.nameZh || ''
  const headerMeta = buildHudHeaderMeta(route.line, isClosed, direction, stationById, stationIds)

  return {
    ready: true,
    reason: '',
    width,
    height,
    trackPath,
    lineColor: route.line?.color || '#2563EB',
    lineNameZh: lineDisplayName,
    lineNameEn: route.line?.nameEn || '',
    lineHeaderWidth: estimateHudLineHeaderWidth(lineDisplayName),
    lineBadgeZh: headerMeta.lineBadgeZh,
    lineBadgeEn: headerMeta.lineBadgeEn,
    nextStationZh: headerMeta.nextStationZh,
    nextStationEn: headerMeta.nextStationEn,
    routeSpanZh: headerMeta.routeSpanZh,
    routeSpanEn: headerMeta.routeSpanEn,
    destinationZh: headerMeta.destinationZh,
    destinationEn: headerMeta.destinationEn,
    directionLabelZh: direction.labelZh || '',
    directionLabelEn: direction.labelEn || '',
    terminalNameZh: '',
    terminalNameEn: '',
    stationCount: positionedStations.length,
    hasBend: false,
    isLoop: true,
    chevrons,
    stations: positionedStations,
  }
}

function buildStationRender(station, isStart, isEnd, lineId, lineById, position) {
  const { nameZh, nameEn } = resolveHudStationNames(station)
  const currentLineKey = toIdKey(lineId)
  const effectiveLineIds = Array.isArray(station.transferLineIds) && station.transferLineIds.length
    ? station.transferLineIds
    : station.lineIds || []
  const transferLineKeys = [...new Set(effectiveLineIds.map((id) => toIdKey(id)).filter(Boolean))]
    .filter((key) => key !== currentLineKey)
  const transferBadges = transferLineKeys
    .map((key) => lineById.get(key))
    .filter(Boolean)
    .slice(0, 6)
    .map((line, index) => {
      const badgeWidth = resolveTransferBadgeWidth(resolveLineBadgeText(line))
      return {
        lineId: line.id,
        label: resolveLineBadgeLabel(line),
        text: resolveLineBadgeText(line),
        color: line.color || '#2563EB',
        badgeWidth,
        gridIndex: index,
      }
    })
  const labelAngle = resolveHudLabelAngle(nameZh, nameEn)
  const labelOffset = resolveHudLabelOffset(nameZh, nameEn)
  let rowIndex = position.rowIndex
  let labelAnchor = 'start'
  let labelX = position.x
  let labelBelow = false
  let labelY = position.y - (40 + labelOffset)
  let labelEnY = labelY + 20
  let calloutDirection = 1
  let connectorDotY = position.y + calloutDirection * 30

  if (position.layout === 'loop-radial') {
    rowIndex = 0
    const radialX = Math.cos(position.angle)
    const radialY = Math.sin(position.angle)
    const labelDirection = position.labelOutside ? 1 : -1
    const labelDistance = 74 + labelOffset + (position.labelOutside ? 8 : 0)
    labelX = position.x + radialX * labelDistance * labelDirection
    labelY = position.y + radialY * labelDistance * labelDirection
    labelEnY = labelY + 27
    labelBelow = labelDirection > 0 ? radialY >= 0 : radialY < 0
    if (radialX * labelDirection > 0.25) labelAnchor = 'start'
    else if (radialX * labelDirection < -0.25) labelAnchor = 'end'
    else labelAnchor = 'middle'
    calloutDirection = position.y <= position.centerY ? 1 : -1
    connectorDotY = position.y + calloutDirection * 28
  }
  labelY -= HUD_STATION_LABEL_LIFT_PX
  labelEnY -= HUD_STATION_LABEL_LIFT_PX

  const transferLabelZhY = calloutDirection > 0 ? position.y + 80 : position.y - 80
  const transferLabelEnY = calloutDirection > 0 ? position.y + 100 : position.y - 100
  const transferBadgeY = calloutDirection > 0 ? position.y + 120 : position.y - 152

  return {
    id: station.id,
    x: position.x,
    y: position.y,
    rowIndex,
    nameZh,
    nameEn,
    isTerminal: Boolean(position.isLoop) ? false : Boolean(isStart || isEnd),
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
  return { nameZh: zh, nameEn: en }
}

function resolveHudLabelAngle() {
  return -45
}

function resolveHudLabelOffset(nameZh, nameEn) {
  const zhScore = String(nameZh || '').length * 1.9
  const enScore = String(nameEn || '').length
  const score = Math.max(zhScore, enScore)
  if (score >= 30) return 12
  if (score >= 22) return 6
  return 0
}

function buildHudHeaderMeta(line, isClosed, direction, stationById, stationIds) {
  const lineBadge = resolveHudLineBadge(line, isClosed)
  const nextStation = stationById.get(stationIds?.[1])
  const origin = stationById.get(stationIds?.[0])
  const destination = stationById.get(direction?.toStationId)
  const originZh = String(origin?.nameZh || '').trim()
  const originEn = String(origin?.nameEn || '').trim()
  const destinationZh = String(destination?.nameZh || '').trim()
  const destinationEn = String(destination?.nameEn || '').trim()
  const routeSpanZh = !isLoopLineLike(line, isClosed)
    ? `${originZh || stationIds?.[0] || ''} >>> ${destinationZh || direction?.toStationId || ''}`.trim()
    : ''
  const routeSpanEn = !isLoopLineLike(line, isClosed)
    ? `${originEn || originZh || stationIds?.[0] || ''} >>> ${destinationEn || destinationZh || direction?.toStationId || ''}`.trim()
    : ''
  return {
    lineBadgeZh: lineBadge.zh,
    lineBadgeEn: lineBadge.en,
    nextStationZh: String(nextStation?.nameZh || '').trim(),
    nextStationEn: String(nextStation?.nameEn || '').trim(),
    routeSpanZh,
    routeSpanEn,
    destinationZh,
    destinationEn,
  }
}

function resolveHudLineBadge(line, isClosed) {
  const zhName = String(getDisplayLineName(line, 'zh') || line?.nameZh || '').trim()
  const enName = String(line?.nameEn || '').trim()
  const isLoop = isLoopLineLike(line, isClosed)
  if (isLoop) {
    return {
      zh: '环线',
      en: 'Loop Line',
    }
  }
  const lineNumber = extractLineNumber([zhName, enName, line?.key])
  if (lineNumber) {
    return {
      zh: `${lineNumber}号线`,
      en: `Line ${lineNumber}`,
    }
  }
  return {
    zh: zhName || '线路',
    en: enName || 'Line',
  }
}

function isLoopLineLike(line, isClosed) {
  const zhName = String(getDisplayLineName(line, 'zh') || line?.nameZh || '').trim()
  const enName = String(line?.nameEn || '').trim()
  return Boolean(isClosed) || /环/u.test(zhName) || /\b(?:loop|circle)\b/i.test(enName)
}

function extractLineNumber(candidates = []) {
  for (const candidate of candidates) {
    const value = String(candidate || '').trim()
    if (!value) continue
    const zhMatch = value.match(/(\d+)\s*号?\s*线/u)
    if (zhMatch?.[1]) return zhMatch[1]
    const enMatch = value.match(/\bline\s*([0-9]+)/i)
    if (enMatch?.[1]) return enMatch[1]
    const genericMatch = value.match(/([0-9]+)/)
    if (genericMatch?.[1]) return genericMatch[1]
  }
  return ''
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

function toIdKey(id) {
  if (id === null || id === undefined) return ''
  return String(id)
}