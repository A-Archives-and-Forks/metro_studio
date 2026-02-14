import { bboxFromXY, buildOctilinearPolyline } from '../geo'
import { getLineStyleSchematic } from '../lineStyles'
import { getDisplayLineName } from '../lineNaming'

const STATUS_STYLE = {
  open: { opacity: 0.98, width: 8.4 },
  construction: { opacity: 0.74, width: 7.3 },
  proposed: { opacity: 0.58, width: 6.8 },
}

export function buildSchematicRenderModel(project, options = {}) {
  const stations = project?.stations || []
  const edges = project?.edges || []
  const lines = project?.lines || []
  const layoutMeta = project?.layoutMeta || {}
  const lineById = new Map(lines.map((line, index) => [line.id, { ...line, order: index }]))
  const stationById = new Map(stations.map((station) => [station.id, station]))
  const edgeDirectionById = layoutMeta.edgeDirections || {}

  const points = stations.map((station) => station.displayPos || [0, 0])
  const { minX, minY, maxX, maxY } = bboxFromXY(points)
  const leftPadding = options.leftPadding ?? 250
  const rightPadding = options.rightPadding ?? 220
  const topPadding = options.topPadding ?? 96
  const bottomPadding = options.bottomPadding ?? 104
  const width = Math.max(maxX - minX + leftPadding + rightPadding, 1460)
  const height = Math.max(maxY - minY + topPadding + bottomPadding, 860)
  const xOffset = leftPadding - minX
  const yOffset = topPadding - minY
  const mirrorVertical = Boolean(options.mirrorVertical)

  const toCanvas = (point) => {
    const x = point[0] + xOffset
    const y = point[1] + yOffset
    return [x, mirrorVertical ? height - y : y]
  }
  const laneGap = options.laneGap ?? 5.2
  const cornerRadius = options.cornerRadius ?? 10

  const edgePaths = []
  for (const edge of edges) {
    const from = stationById.get(edge.fromStationId)?.displayPos
    const to = stationById.get(edge.toStationId)?.displayPos
    if (!Array.isArray(from) || !Array.isArray(to)) continue
    const fromCanvas = toCanvas(from)
    const toCanvasPoint = toCanvas(to)
    const basePolyline = buildOctilinearPolyline(from, to).map(toCanvas)
    const sharedLineIds = [...new Set(edge.sharedByLineIds || [])].filter((lineId) => lineById.has(lineId))
    if (!sharedLineIds.length) continue

    const directionIndex = edgeDirectionById[edge.id]
    const fallbackAngle = Math.atan2(toCanvasPoint[1] - fromCanvas[1], toCanvasPoint[0] - fromCanvas[0])
    const edgeAngle = Number.isInteger(directionIndex)
      ? directionIndexToAngle(directionIndex, mirrorVertical)
      : fallbackAngle
    const nx = -Math.sin(edgeAngle)
    const ny = Math.cos(edgeAngle)

    sharedLineIds.forEach((lineId, index) => {
      const line = lineById.get(lineId)
      const statusStyle = STATUS_STYLE[line.status] || STATUS_STYLE.open
      const lineStyle = getLineStyleSchematic(edge.lineStyleOverride || line.style)
      const offset = (index - (sharedLineIds.length - 1) / 2) * laneGap
      const trackOffsets = Array.isArray(lineStyle.trackOffsets) && lineStyle.trackOffsets.length
        ? lineStyle.trackOffsets
        : [0]
      const trackWidthScale = Number.isFinite(lineStyle.trackWidthScale) ? lineStyle.trackWidthScale : 1
      const trackWidth = Math.max(1.8, statusStyle.width * trackWidthScale)

      trackOffsets.forEach((trackOffset, trackIndex) => {
        const shifted = basePolyline.map(([x, y]) => [x + nx * (offset + trackOffset), y + ny * (offset + trackOffset)])
        edgePaths.push({
          id: `${edge.id}_${lineId}_${index}_${trackIndex}`,
          lineId,
          order: line.order,
          color: line.color || '#2563EB',
          width: trackWidth,
          opacity: statusStyle.opacity,
          dasharray: lineStyle.dasharray,
          lineCap: lineStyle.lineCap,
          pathD: polylineToRoundedPath(shifted, cornerRadius),
          status: line.status || 'open',
        })
      })
    })
  }

  edgePaths.sort((a, b) => statusOrder(a.status) - statusOrder(b.status) || a.order - b.order)

  const stationsRender = stations.map((station) => {
    const [x, y] = toCanvas(station.displayPos || [0, 0])
    const labelPlacement = layoutMeta.stationLabels?.[station.id] || { dx: 12, dy: -8, anchor: 'start' }
    const labelX = x + labelPlacement.dx
    const labelY = y + (mirrorVertical ? -labelPlacement.dy : labelPlacement.dy)
    return {
      id: station.id,
      x,
      y,
      isInterchange: Boolean(station.isInterchange),
      underConstruction: Boolean(station.underConstruction),
      proposed: Boolean(station.proposed),
      nameZh: station.nameZh || '',
      nameEn: station.nameEn || '',
      labelX,
      labelY,
      labelAnchor: labelPlacement.anchor || 'start',
    }
  })

  const lineLabels = buildLineLabels(lines, edges, stationById, toCanvas)

  return {
    width,
    height,
    edgePaths,
    stations: stationsRender,
    lineLabels,
    theme: {
      background: '#ECEFF1',
      panelText: '#39B6D7',
      lineText: '#2A3440',
      enSubtle: '#7C8A96',
      stationStroke: '#1F2937',
      interchangeStroke: '#334155',
    },
  }
}

function buildLineLabels(lines, edges, stationById, toCanvas) {
  const labels = []
  for (const line of lines) {
    const lineEdges = edges.filter(
      (edge) => Array.isArray(edge.sharedByLineIds) && edge.sharedByLineIds.includes(line.id),
    )
    if (!lineEdges.length) continue

    const adjacency = new Map()
    for (const edge of lineEdges) {
      if (!stationById.has(edge.fromStationId) || !stationById.has(edge.toStationId)) continue
      if (!adjacency.has(edge.fromStationId)) adjacency.set(edge.fromStationId, [])
      if (!adjacency.has(edge.toStationId)) adjacency.set(edge.toStationId, [])
      adjacency.get(edge.fromStationId).push(edge.toStationId)
      adjacency.get(edge.toStationId).push(edge.fromStationId)
    }
    if (!adjacency.size) continue

    const terminals = []
    for (const [stationId, neighbors] of adjacency) {
      if (neighbors.length === 1) terminals.push(stationId)
    }

    const isLoop = terminals.length === 0 && adjacency.size >= 3
    const nameZh = getDisplayLineName(line, 'zh') || line.nameZh || ''
    const number = extractSchematicLineNumber(nameZh, line.nameEn, line.key)
    const offsetDist = 42

    if (isLoop) {
      // For loop lines: compute centroid, then place label outside the topmost station
      const stationIds = [...adjacency.keys()]
      let topId = stationIds[0]
      let topY = Infinity
      for (const sid of stationIds) {
        const s = stationById.get(sid)
        if (!s?.displayPos) continue
        const [, sy] = toCanvas(s.displayPos)
        if (sy < topY) { topY = sy; topId = sid }
      }
      const topStation = stationById.get(topId)
      if (!topStation?.displayPos) continue
      const [tx, ty] = toCanvas(topStation.displayPos)

      labels.push({
        id: line.id,
        nameZh,
        nameEn: line.nameEn || '',
        color: line.color || '#2563EB',
        number,
        x: tx,
        y: ty - offsetDist,
      })
    } else {
      const terminalId = terminals.length ? terminals[terminals.length - 1] : adjacency.keys().next().value
      const station = stationById.get(terminalId)
      if (!station?.displayPos) continue

      const [cx, cy] = toCanvas(station.displayPos)
      const neighborIds = adjacency.get(terminalId) || []
      let dx = 1
      let dy = 0
      if (neighborIds.length) {
        const neighbor = stationById.get(neighborIds[0])
        if (neighbor?.displayPos) {
          const [nx, ny] = toCanvas(neighbor.displayPos)
          const len = Math.hypot(cx - nx, cy - ny)
          if (len > 1) {
            dx = (cx - nx) / len
            dy = (cy - ny) / len
          }
        }
      }

      labels.push({
        id: line.id,
        nameZh,
        nameEn: line.nameEn || '',
        color: line.color || '#2563EB',
        number,
        x: cx + dx * offsetDist,
        y: cy + dy * offsetDist,
      })
    }
  }
  return labels
}

function extractSchematicLineNumber(nameZh, nameEn, key) {
  for (const value of [nameZh, nameEn, key]) {
    const str = String(value || '').trim()
    if (!str) continue
    const zhMatch = str.match(/(\d+)\s*号?\s*线/u)
    if (zhMatch?.[1]) return zhMatch[1]
    const enMatch = str.match(/\bline\s*([0-9]+)/i)
    if (enMatch?.[1]) return enMatch[1]
  }
  return ''
}

function statusOrder(status) {
  if (status === 'proposed') return 0
  if (status === 'construction') return 1
  return 2
}

function directionIndexToAngle(index, mirrorVertical = false) {
  const normalized = (((index % 8) + 8) % 8) * (Math.PI / 4)
  return mirrorVertical ? -normalized : normalized
}

function polylineToRoundedPath(points, radius) {
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
