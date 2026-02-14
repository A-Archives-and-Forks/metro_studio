import {
  angleToDirectionIndex,
  boxesOverlap,
  circularDirectionDistance,
  distance,
  normalizeAngle,
  segmentBox,
  segmentsIntersect,
  snapAngle,
  toFiniteNumber,
} from './shared'
import { buildLabelBox, estimateLabelWidth } from './labels'

function computeScoreBreakdown(positions, original, edgeRecords, lineChains, stations, stationLabels, config) {
  const breakdown = {
    angle: 0,
    length: 0,
    overlap: 0,
    crossing: 0,
    bend: 0,
    shortRun: 0,
    geoDeviation: 0,
    labelOverlap: 0,
  }

  for (const edge of edgeRecords) {
    const a = positions[edge.fromIndex]
    const b = positions[edge.toIndex]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const angle = Math.atan2(dy, dx)
    const snapped = snapAngle(angle)
    const angleDiff = Math.abs(normalizeAngle(angle - snapped))
    breakdown.angle += (angleDiff * 180) / Math.PI

    const length = distance(a, b)
    breakdown.length += Math.abs(length - edge.desiredLength) * 0.18
  }

  const minRunEdges = Math.max(1, Math.floor(config.lineMinRunEdges || 1))
  const shortRunLengthThreshold = config.minEdgeLength * 1.35

  for (const chain of lineChains || []) {
    if (chain.edgePath.length < 2) continue

    let currentDirection = null
    let runEdges = 0
    let runLength = 0

    for (let i = 0; i < chain.edgePath.length; i += 1) {
      const from = positions[chain.nodePath[i]]
      const to = positions[chain.nodePath[i + 1]]
      const edgeLength = distance(from, to)
      const direction = angleToDirectionIndex(Math.atan2(to[1] - from[1], to[0] - from[0]))

      if (currentDirection == null) {
        currentDirection = direction
        runEdges = 1
        runLength = edgeLength
        continue
      }

      if (direction === currentDirection) {
        runEdges += 1
        runLength += edgeLength
        continue
      }

      const turnSteps = circularDirectionDistance(currentDirection, direction)
      breakdown.bend += turnSteps * config.lineBendScoreWeight
      if (runEdges < minRunEdges || runLength < shortRunLengthThreshold) {
        const edgePenalty = Math.max(0, minRunEdges - runEdges) * config.lineShortRunScoreWeight
        const lengthPenalty = runLength < shortRunLengthThreshold ? config.lineShortRunScoreWeight : 0
        breakdown.shortRun += edgePenalty + lengthPenalty
      }

      currentDirection = direction
      runEdges = 1
      runLength = edgeLength
    }
  }

  const stationGrid = new Map()
  const cellSize = config.minStationDistance

  for (let i = 0; i < positions.length; i += 1) {
    const [x, y] = positions[i]
    const key = `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`
    if (!stationGrid.has(key)) stationGrid.set(key, [])
    stationGrid.get(key).push(i)
  }

  const neighborOffsets = [
    [-1, -1],
    [-1, 0],
    [-1, 1],
    [0, -1],
    [0, 0],
    [0, 1],
    [1, -1],
    [1, 0],
    [1, 1],
  ]

  for (let i = 0; i < positions.length; i += 1) {
    const [x, y] = positions[i]
    const cx = Math.floor(x / cellSize)
    const cy = Math.floor(y / cellSize)
    for (const [ox, oy] of neighborOffsets) {
      const bucket = stationGrid.get(`${cx + ox}:${cy + oy}`)
      if (!bucket) continue
      for (const j of bucket) {
        if (i >= j) continue
        const d = distance(positions[i], positions[j])
        if (d < config.minStationDistance) {
          breakdown.overlap += (config.minStationDistance - d) * 2.9
        }
      }
    }
  }

  for (let i = 0; i < edgeRecords.length; i += 1) {
    const e1 = edgeRecords[i]
    const a1 = positions[e1.fromIndex]
    const a2 = positions[e1.toIndex]
    const aBox = segmentBox(a1, a2)

    for (let j = i + 1; j < edgeRecords.length; j += 1) {
      const e2 = edgeRecords[j]
      if (
        e1.fromIndex === e2.fromIndex ||
        e1.fromIndex === e2.toIndex ||
        e1.toIndex === e2.fromIndex ||
        e1.toIndex === e2.toIndex
      ) {
        continue
      }
      const b1 = positions[e2.fromIndex]
      const b2 = positions[e2.toIndex]
      const bBox = segmentBox(b1, b2)
      if (!boxesOverlap(aBox, bBox)) continue
      if (segmentsIntersect(a1, a2, b1, b2)) {
        breakdown.crossing += 70
      }
    }
  }

  for (let i = 0; i < positions.length; i += 1) {
    breakdown.geoDeviation += distance(positions[i], original[i]) * config.geoWeight * 0.11
  }

  const labelBoxes = stations.map((station, index) => {
    const placement = stationLabels[station.id] || { dx: 12, dy: -8, anchor: 'start' }
    return buildLabelBox(
      positions[index],
      estimateLabelWidth(station),
      station.nameEn ? 26 : 15,
      placement,
      config.labelPadding,
    )
  })

  for (let i = 0; i < labelBoxes.length; i += 1) {
    for (let j = i + 1; j < labelBoxes.length; j += 1) {
      if (boxesOverlap(labelBoxes[i], labelBoxes[j])) {
        const overlapX =
          Math.min(labelBoxes[i].right, labelBoxes[j].right) -
          Math.max(labelBoxes[i].left, labelBoxes[j].left)
        const overlapY =
          Math.min(labelBoxes[i].bottom, labelBoxes[j].bottom) -
          Math.max(labelBoxes[i].top, labelBoxes[j].top)
        breakdown.labelOverlap += Math.max(0, overlapX) * Math.max(0, overlapY) * 0.045
      }
    }
  }

  return breakdown
}

function sanitizeBreakdown(breakdown) {
  return {
    angle: toFiniteNumber(breakdown.angle),
    length: toFiniteNumber(breakdown.length),
    overlap: toFiniteNumber(breakdown.overlap),
    crossing: toFiniteNumber(breakdown.crossing),
    bend: toFiniteNumber(breakdown.bend),
    shortRun: toFiniteNumber(breakdown.shortRun),
    geoDeviation: toFiniteNumber(breakdown.geoDeviation),
    labelOverlap: toFiniteNumber(breakdown.labelOverlap),
  }
}


export { computeScoreBreakdown, sanitizeBreakdown }
