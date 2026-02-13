const DEFAULT_CONFIG = {
  maxIterations: 1700,
  cooling: 0.9972,
  initialTemperature: 9.8,
  anchorWeight: 0.0135,
  springWeight: 0.032,
  angleWeight: 0.02,
  repulsionWeight: 58,
  geoWeight: 0.72,
  minStationDistance: 30,
  minEdgeLength: 32,
  maxEdgeLength: 160,
  labelPadding: 6,
  displacementLimit: 230,
  geoAngleBias: 0.7,
  hardCrossingPasses: 2,
  junctionSpreadWeight: 0.24,
  crossingRepelWeight: 20,
  geoSeedScale: 3,
  corridorStraightenMinEdges: 4,
  corridorStraightenTortuosityMax: 1.16,
  corridorStraightenDeviationMax: 9.5,
  corridorStraightenBlend: 0.92,
  straightenTurnToleranceDeg: 18,
  straightenStrength: 0.58,
  normalizeTargetSpan: 1650,
  lineDirectionPasses: 3,
  lineDirectionBlend: 0.43,
  lineDataAngleWeight: 1.25,
  lineMainDirectionWeight: 0.52,
  lineTurnPenalty: 1.55,
  lineTurnStepPenalty: 0.62,
  lineUTurnPenalty: 3.6,
  lineMinRunEdges: 2,
  lineShortRunPenalty: 2.8,
  lineBendScoreWeight: 2.6,
  lineShortRunScoreWeight: 5.4,
  octilinearRelaxIterations: 40,
  octilinearBlend: 0.38,
  octilinearExactPasses: 3,
}

self.onmessage = (event) => {
  const { requestId, payload } = event.data || {}
  if (!requestId) return
  try {
    const result = optimizeLayout(payload)
    self.postMessage({ requestId, ok: true, result })
  } catch (error) {
    self.postMessage({
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : 'unknown-worker-error',
    })
  }
}

function optimizeLayout(payload) {
  const startedAt = performance.now()
  const stations = payload?.stations || []
  const edges = payload?.edges || []
  const lines = payload?.lines || []
  const config = { ...DEFAULT_CONFIG, ...(payload?.config || {}) }

  if (!stations.length || !edges.length) {
    return {
      stations,
      score: 0,
      breakdown: {
        angle: 0,
        length: 0,
        overlap: 0,
        crossing: 0,
        bend: 0,
        shortRun: 0,
        geoDeviation: 0,
        labelOverlap: 0,
      },
      elapsedMs: performance.now() - startedAt,
    }
  }

  const stationIndex = new Map()
  stations.forEach((station, index) => {
    stationIndex.set(station.id, index)
  })

  const original = normalizeSeedPositions(stations, config.normalizeTargetSpan, config.geoSeedScale)
  const positions = original.map((xy) => [...xy])

  const edgeRecords = []
  for (const edge of edges) {
    const fromIndex = stationIndex.get(edge.fromStationId)
    const toIndex = stationIndex.get(edge.toStationId)
    if (fromIndex == null || toIndex == null || fromIndex === toIndex) continue

    const baseLength = distance(original[fromIndex], original[toIndex])
    const desiredLength = estimateDesiredEdgeLength(baseLength, config)

    edgeRecords.push({
      id: edge.id,
      fromIndex,
      toIndex,
      desiredLength,
    })
  }
  const edgeById = new Map(edgeRecords.map((edge) => [edge.id, edge]))
  const nodeDegrees = buildNodeDegrees(stations.length, edgeRecords)
  const lineChains = buildLineChains(lines, edgeById)
  const adjacency = buildAdjacency(stations.length, edgeRecords)

  let temperature = config.initialTemperature

  for (let iteration = 0; iteration < config.maxIterations; iteration += 1) {
    const forces = positions.map(() => [0, 0])

    applyAnchorForce(forces, positions, original, config)
    applySpringAndAngleForce(forces, positions, original, edgeRecords, config)
    applyRepulsionForce(forces, positions, config)
    applyJunctionSpread(forces, positions, adjacency, nodeDegrees, config)
    if ((iteration + 1) % 14 === 0) {
      applyCrossingRepel(forces, positions, edgeRecords, config)
    }

    const step = 0.12 * temperature
    for (let i = 0; i < positions.length; i += 1) {
      positions[i][0] += forces[i][0] * step
      positions[i][1] += forces[i][1] * step
    }

    clampDisplacement(positions, original, config.displacementLimit)
    temperature *= config.cooling
  }

  snapEdgesToEightDirections(positions, edgeRecords, 0.18)
  straightenNearLinearSegments(positions, edgeRecords, lines, stations, config)
  compactLongEdges(positions, edgeRecords, config.maxEdgeLength * 1.12)
  snapEdgesToEightDirections(positions, edgeRecords, 0.24)
  enforceOctilinearHardConstraints(positions, edgeRecords, stations, config)
  clampDisplacement(positions, original, config.displacementLimit)

  for (let pass = 0; pass < config.hardCrossingPasses; pass += 1) {
    applyCrossingRepel(null, positions, edgeRecords, config)
    clampDisplacement(positions, original, config.displacementLimit)
  }

  const stationLabels = computeStationLabelLayout(positions, stations, edgeRecords, nodeDegrees, config)
  const edgeDirections = Object.fromEntries(
    edgeRecords.map((edge) => {
      const from = positions[edge.fromIndex]
      const to = positions[edge.toIndex]
      return [edge.id, angleToDirectionIndex(Math.atan2(to[1] - from[1], to[0] - from[0]))]
    }),
  )

  const breakdown = computeScoreBreakdown(
    positions,
    original,
    edgeRecords,
    lineChains,
    stations,
    stationLabels,
    config,
  )
  const safeBreakdown = sanitizeBreakdown(breakdown)
  const score = Object.values(safeBreakdown).reduce((sum, value) => sum + value, 0)

  const nextStations = stations.map((station, index) => ({
    ...station,
    displayPos: positions[index],
  }))

  return {
    stations: nextStations,
    score: toFiniteNumber(score),
    breakdown: safeBreakdown,
    layoutMeta: {
      stationLabels,
      edgeDirections,
    },
    elapsedMs: performance.now() - startedAt,
  }
}

function normalizeSeedPositions(stations, targetSpan, geoSeedScale = 1) {
  const raw = stations.map((station) => {
    if (Array.isArray(station.lngLat) && station.lngLat.length === 2) {
      return [toFiniteNumber(station.lngLat[0]), toFiniteNumber(station.lngLat[1])]
    }
    if (Array.isArray(station.displayPos) && station.displayPos.length === 2) {
      return [toFiniteNumber(station.displayPos[0]), toFiniteNumber(station.displayPos[1])]
    }
    return [0, 0]
  })

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const [x, y] of raw) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }

  const width = Math.max(maxX - minX, 1)
  const height = Math.max(maxY - minY, 1)
  const seedScale = Math.max(0.1, toFiniteNumber(geoSeedScale, 1))
  const scale = (targetSpan * seedScale) / Math.max(width, height)

  return raw.map(([x, y]) => [(x - minX) * scale, (y - minY) * scale])
}

function estimateDesiredEdgeLength(baseLength, config) {
  const safeBaseLength = toFiniteNumber(baseLength)
  const linearCompressed = 34 + Math.min(safeBaseLength, 280) * 0.2
  return clamp(linearCompressed, config.minEdgeLength, config.maxEdgeLength)
}

function applyAnchorForce(forces, positions, original, config) {
  for (let i = 0; i < positions.length; i += 1) {
    const dx = original[i][0] - positions[i][0]
    const dy = original[i][1] - positions[i][1]
    forces[i][0] += dx * config.anchorWeight
    forces[i][1] += dy * config.anchorWeight
  }
}

function applySpringAndAngleForce(forces, positions, original, edgeRecords, config) {
  for (const edge of edgeRecords) {
    const a = positions[edge.fromIndex]
    const b = positions[edge.toIndex]

    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const length = Math.max(distance(a, b), 0.00001)
    const ux = dx / length
    const uy = dy / length

    const springDelta = length - edge.desiredLength
    const springForce = springDelta * config.springWeight

    forces[edge.fromIndex][0] += ux * springForce
    forces[edge.fromIndex][1] += uy * springForce
    forces[edge.toIndex][0] -= ux * springForce
    forces[edge.toIndex][1] -= uy * springForce

    const snappedAngle = snapAngle(Math.atan2(dy, dx))
    const geoAngle = snapAngle(
      Math.atan2(
        original[edge.toIndex][1] - original[edge.fromIndex][1],
        original[edge.toIndex][0] - original[edge.fromIndex][0],
      ),
    )
    const preferredAngle = interpolateAngles(snappedAngle, geoAngle, config.geoAngleBias)
    const desiredDx = Math.cos(preferredAngle) * length
    const desiredDy = Math.sin(preferredAngle) * length
    const angleCorrectionX = (desiredDx - dx) * config.angleWeight
    const angleCorrectionY = (desiredDy - dy) * config.angleWeight

    forces[edge.fromIndex][0] -= angleCorrectionX
    forces[edge.fromIndex][1] -= angleCorrectionY
    forces[edge.toIndex][0] += angleCorrectionX
    forces[edge.toIndex][1] += angleCorrectionY
  }
}

function applyRepulsionForce(forces, positions, config) {
  const grid = new Map()
  const cellSize = config.minStationDistance * 1.6

  for (let i = 0; i < positions.length; i += 1) {
    const [x, y] = positions[i]
    const key = `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`
    if (!grid.has(key)) grid.set(key, [])
    grid.get(key).push(i)
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
    const baseX = Math.floor(x / cellSize)
    const baseY = Math.floor(y / cellSize)

    for (const [ox, oy] of neighborOffsets) {
      const key = `${baseX + ox}:${baseY + oy}`
      const bucket = grid.get(key)
      if (!bucket) continue
      for (const j of bucket) {
        if (i >= j) continue
        const dx = positions[j][0] - positions[i][0]
        const dy = positions[j][1] - positions[i][1]
        const d = Math.max(Math.sqrt(dx * dx + dy * dy), 0.00001)
        if (d >= config.minStationDistance * 2.5) continue
        const strength = (config.repulsionWeight / (d * d)) * 0.023
        const ux = dx / d
        const uy = dy / d
        forces[i][0] -= ux * strength
        forces[i][1] -= uy * strength
        forces[j][0] += ux * strength
        forces[j][1] += uy * strength
      }
    }
  }
}

function buildAdjacency(nodeCount, edgeRecords) {
  const adjacency = Array.from({ length: nodeCount }, () => [])
  for (const edge of edgeRecords) {
    adjacency[edge.fromIndex].push(edge.toIndex)
    adjacency[edge.toIndex].push(edge.fromIndex)
  }
  return adjacency
}

function applyJunctionSpread(forces, positions, adjacency, nodeDegrees, config) {
  for (let center = 0; center < adjacency.length; center += 1) {
    const neighbors = adjacency[center]
    if (!neighbors || neighbors.length < 3) continue

    const centerPoint = positions[center]
    const vectors = neighbors
      .map((neighbor) => {
        const p = positions[neighbor]
        const dx = p[0] - centerPoint[0]
        const dy = p[1] - centerPoint[1]
        const length = Math.max(Math.hypot(dx, dy), 0.00001)
        return {
          neighbor,
          ux: dx / length,
          uy: dy / length,
          angle: Math.atan2(dy, dx),
        }
      })
      .sort((a, b) => a.angle - b.angle)

    for (let i = 0; i < vectors.length; i += 1) {
      const current = vectors[i]
      const next = vectors[(i + 1) % vectors.length]
      const gap = normalizePositiveAngle(next.angle - current.angle)
      if (gap >= Math.PI / 4.4) continue

      const overlap = Math.PI / 4.4 - gap
      const strength = overlap * 0.38
      const centerBoost = nodeDegrees[center] >= 4 ? 1.16 : 1

      const normalCurrent = [-current.uy, current.ux]
      const normalNext = [next.uy, -next.ux]

      forces[current.neighbor][0] += normalCurrent[0] * strength * config.junctionSpreadWeight * centerBoost
      forces[current.neighbor][1] += normalCurrent[1] * strength * config.junctionSpreadWeight * centerBoost
      forces[next.neighbor][0] += normalNext[0] * strength * config.junctionSpreadWeight * centerBoost
      forces[next.neighbor][1] += normalNext[1] * strength * config.junctionSpreadWeight * centerBoost

      forces[center][0] -= (normalCurrent[0] + normalNext[0]) * strength * 0.3
      forces[center][1] -= (normalCurrent[1] + normalNext[1]) * strength * 0.3
    }
  }
}

function applyCrossingRepel(forces, positions, edgeRecords, config) {
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
      if (!segmentsIntersect(a1, a2, b1, b2)) continue

      const cx1 = (a1[0] + a2[0]) * 0.5
      const cy1 = (a1[1] + a2[1]) * 0.5
      const cx2 = (b1[0] + b2[0]) * 0.5
      const cy2 = (b1[1] + b2[1]) * 0.5
      const dx = cx2 - cx1
      const dy = cy2 - cy1
      const d = Math.max(Math.hypot(dx, dy), 0.00001)
      const ux = dx / d
      const uy = dy / d
      const push = config.crossingRepelWeight * 0.032

      if (forces) {
        forces[e1.fromIndex][0] -= ux * push
        forces[e1.fromIndex][1] -= uy * push
        forces[e1.toIndex][0] -= ux * push
        forces[e1.toIndex][1] -= uy * push
        forces[e2.fromIndex][0] += ux * push
        forces[e2.fromIndex][1] += uy * push
        forces[e2.toIndex][0] += ux * push
        forces[e2.toIndex][1] += uy * push
      } else {
        positions[e1.fromIndex][0] -= ux * push * 0.2
        positions[e1.fromIndex][1] -= uy * push * 0.2
        positions[e1.toIndex][0] -= ux * push * 0.2
        positions[e1.toIndex][1] -= uy * push * 0.2
        positions[e2.fromIndex][0] += ux * push * 0.2
        positions[e2.fromIndex][1] += uy * push * 0.2
        positions[e2.toIndex][0] += ux * push * 0.2
        positions[e2.toIndex][1] += uy * push * 0.2
      }
    }
  }
}

function clampDisplacement(positions, original, maxDisplacement) {
  if (!Number.isFinite(maxDisplacement) || maxDisplacement <= 0) return
  for (let i = 0; i < positions.length; i += 1) {
    const dx = positions[i][0] - original[i][0]
    const dy = positions[i][1] - original[i][1]
    const d = Math.hypot(dx, dy)
    if (d <= maxDisplacement) continue
    const ratio = maxDisplacement / d
    positions[i][0] = original[i][0] + dx * ratio
    positions[i][1] = original[i][1] + dy * ratio
  }
}

function snapEdgesToEightDirections(positions, edgeRecords, ratio) {
  for (const edge of edgeRecords) {
    const from = positions[edge.fromIndex]
    const to = positions[edge.toIndex]
    const dx = to[0] - from[0]
    const dy = to[1] - from[1]
    const length = distance(from, to)
    if (!length) continue
    const snapped = snapAngle(Math.atan2(dy, dx))
    const targetDx = Math.cos(snapped) * length
    const targetDy = Math.sin(snapped) * length
    const correctionX = (targetDx - dx) * ratio
    const correctionY = (targetDy - dy) * ratio
    from[0] -= correctionX
    from[1] -= correctionY
    to[0] += correctionX
    to[1] += correctionY
  }
}

function straightenNearLinearSegments(positions, edgeRecords, lines, stations, config) {
  const edgeById = new Map(edgeRecords.map((edge) => [edge.id, edge]))
  const turnTolerance = (config.straightenTurnToleranceDeg * Math.PI) / 180

  for (const line of lines || []) {
    const adjacency = new Map()
    for (const edgeId of line.edgeIds || []) {
      const edge = edgeById.get(edgeId)
      if (!edge) continue
      addNeighbor(adjacency, edge.fromIndex, edge.toIndex)
      addNeighbor(adjacency, edge.toIndex, edge.fromIndex)
    }

    for (let pass = 0; pass < 2; pass += 1) {
      for (const [centerIndex, neighbors] of adjacency.entries()) {
        if (neighbors.size !== 2) continue
        if ((stations[centerIndex]?.lineIds?.length || 0) > 1) continue
        const [leftIndex, rightIndex] = [...neighbors]
        const center = positions[centerIndex]
        const left = positions[leftIndex]
        const right = positions[rightIndex]

        const v1 = [left[0] - center[0], left[1] - center[1]]
        const v2 = [right[0] - center[0], right[1] - center[1]]
        const len1 = Math.max(Math.hypot(v1[0], v1[1]), 0.00001)
        const len2 = Math.max(Math.hypot(v2[0], v2[1]), 0.00001)

        const cosTheta = clamp((v1[0] * v2[0] + v1[1] * v2[1]) / (len1 * len2), -1, 1)
        const angle = Math.acos(cosTheta)
        const turn = Math.abs(Math.PI - angle)

        if (turn > turnTolerance) continue

        const projected = projectPointToLine(center, left, right)
        center[0] = lerp(center[0], projected[0], config.straightenStrength)
        center[1] = lerp(center[1], projected[1], config.straightenStrength)
      }
    }
  }
}

function compactLongEdges(positions, edgeRecords, maxLength) {
  for (const edge of edgeRecords) {
    const from = positions[edge.fromIndex]
    const to = positions[edge.toIndex]
    const length = distance(from, to)
    if (length <= maxLength) continue
    const target = maxLength
    const ratio = (length - target) / length
    const moveX = (to[0] - from[0]) * ratio * 0.5
    const moveY = (to[1] - from[1]) * ratio * 0.5
    from[0] += moveX
    from[1] += moveY
    to[0] -= moveX
    to[1] -= moveY
  }
}

function buildNodeDegrees(nodeCount, edgeRecords) {
  const degrees = new Array(nodeCount).fill(0)
  for (const edge of edgeRecords) {
    degrees[edge.fromIndex] += 1
    degrees[edge.toIndex] += 1
  }
  return degrees
}

function buildLineChains(lines, edgeById) {
  const chains = []

  for (const line of lines || []) {
    const lineEdgeIds = [...new Set((line.edgeIds || []).filter((edgeId) => edgeById.has(edgeId)))]
    if (!lineEdgeIds.length) continue

    const adjacency = new Map()
    for (const edgeId of lineEdgeIds) {
      const edge = edgeById.get(edgeId)
      if (!edge) continue
      addLineAdjacency(adjacency, edge.fromIndex, edge.toIndex, edgeId)
      addLineAdjacency(adjacency, edge.toIndex, edge.fromIndex, edgeId)
    }

    const visited = new Set()

    for (const edgeId of lineEdgeIds) {
      if (visited.has(edgeId)) continue
      const edge = edgeById.get(edgeId)
      if (!edge) continue

      const degreeA = adjacency.get(edge.fromIndex)?.length || 0
      const degreeB = adjacency.get(edge.toIndex)?.length || 0
      const startNode = degreeA !== 2 ? edge.fromIndex : degreeB !== 2 ? edge.toIndex : edge.fromIndex
      const chain = walkLineChain(startNode, edgeId, adjacency, edgeById, visited)
      if (!chain.edgePath.length || chain.nodePath.length !== chain.edgePath.length + 1) continue

      chains.push({
        lineId: line.id,
        ...chain,
      })
    }
  }

  return chains
}

function addLineAdjacency(adjacency, nodeIndex, neighborIndex, edgeId) {
  if (!adjacency.has(nodeIndex)) adjacency.set(nodeIndex, [])
  adjacency.get(nodeIndex).push({ neighborIndex, edgeId })
}

function walkLineChain(startNode, firstEdgeId, adjacency, edgeById, visited) {
  const nodePath = [startNode]
  const edgePath = []

  let currentNode = startNode
  let previousNode = -1
  let edgeId = firstEdgeId
  let isCycle = false

  while (edgeId != null) {
    if (visited.has(edgeId)) break
    visited.add(edgeId)
    const edge = edgeById.get(edgeId)
    if (!edge) break

    const nextNode = edge.fromIndex === currentNode ? edge.toIndex : edge.fromIndex
    edgePath.push(edgeId)
    nodePath.push(nextNode)

    previousNode = currentNode
    currentNode = nextNode

    if (currentNode === startNode) {
      isCycle = true
      break
    }

    const options = (adjacency.get(currentNode) || []).filter(
      (item) => !visited.has(item.edgeId) && item.neighborIndex !== previousNode,
    )

    edgeId = options.length === 1 ? options[0].edgeId : null
  }

  return { nodePath, edgePath, isCycle }
}

function applyLineDirectionPlanning(positions, edgeById, lineChains, stations, nodeDegrees, config) {
  const passes = Math.max(0, Math.floor(config.lineDirectionPasses || 0))
  if (!passes || !lineChains.length) return

  for (let pass = 0; pass < passes; pass += 1) {
    const targets = positions.map(() => [0, 0, 0])

    for (const chain of lineChains) {
      if (chain.edgePath.length < 2) continue
      const plan = planLineChainTargetPositions(chain, positions, edgeById, config)
      if (!plan) continue

      for (let i = 0; i < chain.nodePath.length; i += 1) {
        const nodeIndex = chain.nodePath[i]
        if (chain.isCycle && i === chain.nodePath.length - 1 && nodeIndex === chain.nodePath[0]) continue

        const station = stations[nodeIndex]
        const degree = Math.max(nodeDegrees[nodeIndex] || 1, 1)
        const degreeFactor = degree >= 4 ? 0.55 : degree === 3 ? 0.7 : degree === 2 ? 0.9 : 1
        const interchangeFactor = station?.isInterchange ? 0.62 : 1
        const weight = degreeFactor * interchangeFactor

        targets[nodeIndex][0] += plan.nodeTargets[i][0] * weight
        targets[nodeIndex][1] += plan.nodeTargets[i][1] * weight
        targets[nodeIndex][2] += weight
      }
    }

    for (let i = 0; i < positions.length; i += 1) {
      const weight = targets[i][2]
      if (!weight) continue

      const targetX = targets[i][0] / weight
      const targetY = targets[i][1] / weight
      const station = stations[i]
      const degree = Math.max(nodeDegrees[i] || 1, 1)
      const degreeFactor = degree >= 4 ? 0.58 : degree === 3 ? 0.72 : degree === 2 ? 0.9 : 1
      const interchangeFactor = station?.isInterchange ? 0.74 : 1
      const blend = clamp(config.lineDirectionBlend * degreeFactor * interchangeFactor, 0, 1)

      positions[i][0] = lerp(positions[i][0], targetX, blend)
      positions[i][1] = lerp(positions[i][1], targetY, blend)
    }
  }
}

function planLineChainTargetPositions(chain, positions, edgeById, config) {
  const edgeCount = chain.edgePath.length
  if (edgeCount < 2) return null

  const rawAngles = []
  const edgeLengths = []

  for (let i = 0; i < edgeCount; i += 1) {
    const from = positions[chain.nodePath[i]]
    const to = positions[chain.nodePath[i + 1]]
    const dx = to[0] - from[0]
    const dy = to[1] - from[1]
    rawAngles.push(Math.atan2(dy, dx))
    edgeLengths.push(Math.max(distance(from, to), 0.00001))
  }

  const mainDirection = estimateChainMainDirection(chain, positions, rawAngles, edgeLengths)
  let directionSequence = solveDirectionSequence(rawAngles, mainDirection, config)
  directionSequence = smoothShortDirectionRuns(directionSequence, rawAngles, mainDirection, config)

  const nodeTargets = [positions[chain.nodePath[0]].slice(0, 2)]

  for (let i = 0; i < edgeCount; i += 1) {
    const previous = nodeTargets[i]
    const angle = directionIndexToAngle(directionSequence[i])
    const length = edgeLengths[i]
    nodeTargets.push([
      previous[0] + Math.cos(angle) * length,
      previous[1] + Math.sin(angle) * length,
    ])
  }

  const lastIndex = nodeTargets.length - 1
  if (!chain.isCycle && lastIndex > 0) {
    const endIndex = chain.nodePath[lastIndex]
    const currentEnd = positions[endIndex]
    const deltaX = currentEnd[0] - nodeTargets[lastIndex][0]
    const deltaY = currentEnd[1] - nodeTargets[lastIndex][1]
    for (let i = 0; i <= lastIndex; i += 1) {
      const t = i / lastIndex
      nodeTargets[i][0] += deltaX * t
      nodeTargets[i][1] += deltaY * t
    }
  } else if (chain.isCycle && lastIndex > 0) {
    const closureX = nodeTargets[lastIndex][0] - nodeTargets[0][0]
    const closureY = nodeTargets[lastIndex][1] - nodeTargets[0][1]
    for (let i = 0; i <= lastIndex; i += 1) {
      const t = i / lastIndex
      nodeTargets[i][0] -= closureX * t
      nodeTargets[i][1] -= closureY * t
    }
  }

  return { nodeTargets, directionSequence }
}

function estimateChainMainDirection(chain, positions, rawAngles, edgeLengths) {
  const firstNode = positions[chain.nodePath[0]]
  const lastNode = positions[chain.nodePath[chain.nodePath.length - 1]]
  const endDx = lastNode[0] - firstNode[0]
  const endDy = lastNode[1] - firstNode[1]

  if (!chain.isCycle && Math.hypot(endDx, endDy) > 0.00001) {
    return angleToDirectionIndex(Math.atan2(endDy, endDx))
  }

  let vx = 0
  let vy = 0
  for (let i = 0; i < rawAngles.length; i += 1) {
    const weight = edgeLengths[i]
    vx += Math.cos(rawAngles[i]) * weight
    vy += Math.sin(rawAngles[i]) * weight
  }
  if (Math.hypot(vx, vy) <= 0.00001) {
    return angleToDirectionIndex(rawAngles[0] || 0)
  }

  return angleToDirectionIndex(Math.atan2(vy, vx))
}

function solveDirectionSequence(rawAngles, mainDirection, config) {
  const edgeCount = rawAngles.length
  if (!edgeCount) return []

  const dp = Array.from({ length: edgeCount }, () => new Array(8).fill(Number.POSITIVE_INFINITY))
  const previousDirection = Array.from({ length: edgeCount }, () => new Array(8).fill(-1))

  for (let direction = 0; direction < 8; direction += 1) {
    dp[0][direction] = directionUnaryCost(rawAngles[0], direction, mainDirection, config)
  }

  for (let edgeIndex = 1; edgeIndex < edgeCount; edgeIndex += 1) {
    for (let direction = 0; direction < 8; direction += 1) {
      const unaryCost = directionUnaryCost(rawAngles[edgeIndex], direction, mainDirection, config)
      for (let prevDirection = 0; prevDirection < 8; prevDirection += 1) {
        const candidate =
          dp[edgeIndex - 1][prevDirection] +
          unaryCost +
          directionTurnCost(prevDirection, direction, config)
        if (candidate < dp[edgeIndex][direction]) {
          dp[edgeIndex][direction] = candidate
          previousDirection[edgeIndex][direction] = prevDirection
        }
      }
    }
  }

  let bestDirection = 0
  let bestCost = Number.POSITIVE_INFINITY
  for (let direction = 0; direction < 8; direction += 1) {
    if (dp[edgeCount - 1][direction] < bestCost) {
      bestCost = dp[edgeCount - 1][direction]
      bestDirection = direction
    }
  }

  const sequence = new Array(edgeCount).fill(0)
  sequence[edgeCount - 1] = bestDirection

  for (let edgeIndex = edgeCount - 1; edgeIndex > 0; edgeIndex -= 1) {
    sequence[edgeIndex - 1] = previousDirection[edgeIndex][sequence[edgeIndex]]
  }

  return sequence
}

function smoothShortDirectionRuns(sequence, rawAngles, mainDirection, config) {
  const minRunEdges = Math.max(1, Math.floor(config.lineMinRunEdges || 1))
  if (sequence.length < 3 || minRunEdges <= 1) return sequence

  const result = [...sequence]

  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false
    let runStart = 0

    while (runStart < result.length) {
      let runEnd = runStart + 1
      while (runEnd < result.length && result[runEnd] === result[runStart]) {
        runEnd += 1
      }

      const runLength = runEnd - runStart
      if (runLength < minRunEdges) {
        const candidates = []
        if (runStart > 0) candidates.push(result[runStart - 1])
        if (runEnd < result.length) candidates.push(result[runEnd])
        candidates.push(mainDirection)

        let bestDirection = result[runStart]
        let bestCost = Number.POSITIVE_INFINITY

        for (const direction of new Set(candidates)) {
          let candidateCost = 0
          for (let i = runStart; i < runEnd; i += 1) {
            candidateCost += directionUnaryCost(rawAngles[i], direction, mainDirection, config)
          }
          if (runStart > 0) {
            candidateCost += directionTurnCost(result[runStart - 1], direction, config)
          }
          if (runEnd < result.length) {
            candidateCost += directionTurnCost(direction, result[runEnd], config)
          }
          if (direction !== result[runStart]) {
            candidateCost -= config.lineShortRunPenalty
          }

          if (candidateCost < bestCost) {
            bestCost = candidateCost
            bestDirection = direction
          }
        }

        if (bestDirection !== result[runStart]) {
          for (let i = runStart; i < runEnd; i += 1) {
            result[i] = bestDirection
          }
          changed = true
        }
      }

      runStart = runEnd
    }

    if (!changed) break
  }

  return result
}

function directionUnaryCost(observedAngle, direction, mainDirection, config) {
  const targetAngle = directionIndexToAngle(direction)
  const angleDeviation = Math.abs(normalizeAngle(observedAngle - targetAngle))
  const mainDistance = circularDirectionDistance(direction, mainDirection)
  return angleDeviation * config.lineDataAngleWeight + mainDistance * config.lineMainDirectionWeight
}

function directionTurnCost(previousDirection, nextDirection, config) {
  if (previousDirection === nextDirection) return 0
  const steps = circularDirectionDistance(previousDirection, nextDirection)
  let cost = config.lineTurnPenalty + steps * config.lineTurnStepPenalty
  if (steps >= 4) {
    cost += config.lineUTurnPenalty
  } else if (steps === 3) {
    cost += config.lineUTurnPenalty * 0.45
  }
  return cost
}

function circularDirectionDistance(a, b) {
  const direct = Math.abs(a - b)
  return Math.min(direct, 8 - direct)
}

function angleToDirectionIndex(angle) {
  const value = normalizeAngle(angle)
  const step = Math.PI / 4
  let index = Math.round(value / step)
  index %= 8
  if (index < 0) index += 8
  return index
}

function directionIndexToAngle(index) {
  return ((index % 8) + 8) % 8 * (Math.PI / 4)
}

function enforceOctilinearHardConstraints(positions, edgeRecords, stations, config) {
  if (!edgeRecords.length) return

  const degree = new Array(positions.length).fill(0)
  for (const edge of edgeRecords) {
    degree[edge.fromIndex] += 1
    degree[edge.toIndex] += 1
  }

  const relaxIterations = Math.max(0, Math.floor(config.octilinearRelaxIterations || 0))
  for (let iteration = 0; iteration < relaxIterations; iteration += 1) {
    const targets = positions.map(() => [0, 0, 0])

    for (const edge of edgeRecords) {
      const from = positions[edge.fromIndex]
      const to = positions[edge.toIndex]
      const dx = to[0] - from[0]
      const dy = to[1] - from[1]
      const length = Math.max(distance(from, to), 0.00001)
      const snapped = snapAngle(Math.atan2(dy, dx))

      const targetDx = Math.cos(snapped) * length
      const targetDy = Math.sin(snapped) * length
      const midX = (from[0] + to[0]) * 0.5
      const midY = (from[1] + to[1]) * 0.5
      const fromTarget = [midX - targetDx * 0.5, midY - targetDy * 0.5]
      const toTarget = [midX + targetDx * 0.5, midY + targetDy * 0.5]

      const fromWeight = 1 / Math.max(degree[edge.fromIndex], 1)
      const toWeight = 1 / Math.max(degree[edge.toIndex], 1)

      targets[edge.fromIndex][0] += fromTarget[0] * fromWeight
      targets[edge.fromIndex][1] += fromTarget[1] * fromWeight
      targets[edge.fromIndex][2] += fromWeight

      targets[edge.toIndex][0] += toTarget[0] * toWeight
      targets[edge.toIndex][1] += toTarget[1] * toWeight
      targets[edge.toIndex][2] += toWeight
    }

    for (let i = 0; i < positions.length; i += 1) {
      const weight = targets[i][2]
      if (!weight) continue
      const station = stations[i]
      const targetX = targets[i][0] / weight
      const targetY = targets[i][1] / weight
      const degreePenalty = degree[i] >= 4 ? 0.62 : degree[i] === 3 ? 0.74 : degree[i] === 2 ? 0.92 : 1
      const interchangePenalty = station?.isInterchange ? 0.7 : 1
      const blend = clamp(config.octilinearBlend * degreePenalty * interchangePenalty, 0, 1)
      positions[i][0] = lerp(positions[i][0], targetX, blend)
      positions[i][1] = lerp(positions[i][1], targetY, blend)
    }

    if ((iteration + 1) % 8 === 0) {
      snapEdgesToEightDirections(positions, edgeRecords, 0.2)
    }
  }

  const exactPasses = Math.max(1, Math.floor(config.octilinearExactPasses || 1))
  for (let pass = 0; pass < exactPasses; pass += 1) {
    for (const edge of edgeRecords) {
      const from = positions[edge.fromIndex]
      const to = positions[edge.toIndex]
      const dx = to[0] - from[0]
      const dy = to[1] - from[1]
      const length = Math.max(distance(from, to), 0.00001)
      const snapped = snapAngle(Math.atan2(dy, dx))
      const targetDx = Math.cos(snapped) * length
      const targetDy = Math.sin(snapped) * length
      const errX = targetDx - dx
      const errY = targetDy - dy

      const fromDegree = Math.max(degree[edge.fromIndex], 1)
      const toDegree = Math.max(degree[edge.toIndex], 1)
      let fromMove = toDegree / (fromDegree + toDegree)
      let toMove = fromDegree / (fromDegree + toDegree)
      if (fromDegree === 1 && toDegree > 1) {
        fromMove = 1
        toMove = 0
      } else if (toDegree === 1 && fromDegree > 1) {
        fromMove = 0
        toMove = 1
      }

      from[0] -= errX * fromMove
      from[1] -= errY * fromMove
      to[0] += errX * toMove
      to[1] += errY * toMove
    }
  }
}

function addNeighbor(adjacency, from, to) {
  if (!adjacency.has(from)) adjacency.set(from, new Set())
  adjacency.get(from).add(to)
}

function projectPointToLine(pointXY, lineA, lineB) {
  const ax = lineA[0]
  const ay = lineA[1]
  const bx = lineB[0]
  const by = lineB[1]
  const px = pointXY[0]
  const py = pointXY[1]

  const abx = bx - ax
  const aby = by - ay
  const length2 = abx * abx + aby * aby
  if (length2 < 1e-9) return [px, py]

  const t = ((px - ax) * abx + (py - ay) * aby) / length2
  return [ax + t * abx, ay + t * aby]
}

function computeStationLabelLayout(positions, stations, edgeRecords, nodeDegrees, config) {
  const templates = [
    { dx: 12, dy: -8, anchor: 'start', side: 'E' },
    { dx: 12, dy: 14, anchor: 'start', side: 'SE' },
    { dx: -12, dy: -8, anchor: 'end', side: 'W' },
    { dx: -12, dy: 14, anchor: 'end', side: 'SW' },
    { dx: 0, dy: -13, anchor: 'middle', side: 'N' },
    { dx: 0, dy: 19, anchor: 'middle', side: 'S' },
    { dx: 16, dy: 3, anchor: 'start', side: 'E2' },
    { dx: -16, dy: 3, anchor: 'end', side: 'W2' },
  ]

  const segments = edgeRecords.map((edge) => ({
    fromIndex: edge.fromIndex,
    toIndex: edge.toIndex,
    from: positions[edge.fromIndex],
    to: positions[edge.toIndex],
  }))

  const order = Array.from({ length: stations.length }, (_, index) => index).sort((a, b) => {
    const inter = Number(Boolean(stations[b]?.isInterchange)) - Number(Boolean(stations[a]?.isInterchange))
    if (inter !== 0) return inter
    const degreeDiff = (nodeDegrees[b] || 0) - (nodeDegrees[a] || 0)
    if (degreeDiff !== 0) return degreeDiff
    return (stations[b]?.nameZh?.length || 0) - (stations[a]?.nameZh?.length || 0)
  })

  const labels = {}
  const placed = []

  for (const stationIndex of order) {
    const station = stations[stationIndex]
    const base = positions[stationIndex]
    const width = estimateLabelWidth(station)
    const height = station.nameEn ? 26 : 15

    let best = null
    let bestScore = Number.POSITIVE_INFINITY

    for (const template of templates) {
      const box = buildLabelBox(base, width, height, template, config.labelPadding)
      let score = candidateSidePenalty(template.side, segments, stationIndex, base)

      for (const item of placed) {
        if (!boxesOverlap(box, item.box)) continue
        const overlapX = Math.min(box.right, item.box.right) - Math.max(box.left, item.box.left)
        const overlapY = Math.min(box.bottom, item.box.bottom) - Math.max(box.top, item.box.top)
        score += Math.max(0, overlapX) * Math.max(0, overlapY) * 0.34 + 180
      }

      for (let i = 0; i < positions.length; i += 1) {
        if (i === stationIndex) continue
        const dist = distancePointToRect(positions[i][0], positions[i][1], box)
        if (dist < 8.5) {
          score += (8.5 - dist) * 12
        }
      }

      for (const segment of segments) {
        if (segment.fromIndex === stationIndex || segment.toIndex === stationIndex) continue
        if (segmentIntersectsRect(segment.from, segment.to, box)) {
          score += 52
        }
      }

      if (score < bestScore) {
        bestScore = score
        best = { ...template, box }
      }
    }

    if (!best) {
      best = {
        dx: 12,
        dy: -8,
        anchor: 'start',
        side: 'E',
        box: buildLabelBox(base, width, height, { dx: 12, dy: -8, anchor: 'start' }, config.labelPadding),
      }
    }

    labels[station.id] = {
      dx: best.dx,
      dy: best.dy,
      anchor: best.anchor,
    }
    placed.push({ stationIndex, box: best.box })
  }

  return labels
}

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

function estimateLabelWidth(station) {
  const nameZh = station.nameZh || ''
  const nameEn = station.nameEn || ''
  return Math.max(nameZh.length * 8.3, nameEn.length * 5.3) + 10
}

function buildLabelBox(point, width, height, placement, padding) {
  const x = point[0] + placement.dx
  const y = point[1] + placement.dy
  let left = x
  let right = x + width

  if (placement.anchor === 'middle') {
    left = x - width / 2
    right = x + width / 2
  } else if (placement.anchor === 'end') {
    left = x - width
    right = x
  }

  const top = y - 12 - padding
  const bottom = y + Math.max(5, height - 12) + padding
  return { left, right, top, bottom }
}

function distancePointToRect(px, py, rect) {
  const dx = Math.max(rect.left - px, 0, px - rect.right)
  const dy = Math.max(rect.top - py, 0, py - rect.bottom)
  return Math.hypot(dx, dy)
}

function candidateSidePenalty(side, segments, stationIndex, point) {
  let penalty = 0
  for (const segment of segments) {
    if (segment.fromIndex !== stationIndex && segment.toIndex !== stationIndex) continue
    const other = segment.fromIndex === stationIndex ? segment.to : segment.from
    const dx = other[0] - point[0]
    const dy = other[1] - point[1]
    if ((side === 'E' || side === 'SE' || side === 'E2') && dx > 0) penalty += 11
    if ((side === 'W' || side === 'SW' || side === 'W2') && dx < 0) penalty += 11
    if (side === 'N' && dy < 0) penalty += 11
    if (side === 'S' && dy > 0) penalty += 11
  }
  return penalty
}

function segmentIntersectsRect(a, b, rect) {
  if (pointInRect(a[0], a[1], rect) || pointInRect(b[0], b[1], rect)) return true
  const topLeft = [rect.left, rect.top]
  const topRight = [rect.right, rect.top]
  const bottomRight = [rect.right, rect.bottom]
  const bottomLeft = [rect.left, rect.bottom]
  return (
    segmentsIntersect(a, b, topLeft, topRight) ||
    segmentsIntersect(a, b, topRight, bottomRight) ||
    segmentsIntersect(a, b, bottomRight, bottomLeft) ||
    segmentsIntersect(a, b, bottomLeft, topLeft)
  )
}

function pointInRect(x, y, rect) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
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

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function snapAngle(angle) {
  const step = Math.PI / 4
  return Math.round(angle / step) * step
}

function normalizeAngle(angle) {
  let value = angle
  while (value > Math.PI) value -= 2 * Math.PI
  while (value < -Math.PI) value += 2 * Math.PI
  return value
}

function normalizePositiveAngle(angle) {
  let value = angle
  while (value < 0) value += Math.PI * 2
  while (value >= Math.PI * 2) value -= Math.PI * 2
  return value
}

function interpolateAngles(a, b, alpha) {
  const diff = normalizeAngle(b - a)
  return a + diff * clamp(alpha, 0, 1)
}

function distance(a, b) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  return Math.sqrt(dx * dx + dy * dy)
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function lerp(start, end, alpha) {
  return start + (end - start) * alpha
}

function segmentBox(a, b) {
  return {
    left: Math.min(a[0], b[0]),
    right: Math.max(a[0], b[0]),
    top: Math.min(a[1], b[1]),
    bottom: Math.max(a[1], b[1]),
  }
}

function boxesOverlap(a, b) {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom)
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c)
  const o2 = orientation(a, b, d)
  const o3 = orientation(c, d, a)
  const o4 = orientation(c, d, b)

  if (o1 !== o2 && o3 !== o4) return true
  if (o1 === 0 && onSegment(a, c, b)) return true
  if (o2 === 0 && onSegment(a, d, b)) return true
  if (o3 === 0 && onSegment(c, a, d)) return true
  if (o4 === 0 && onSegment(c, b, d)) return true
  return false
}

function orientation(p, q, r) {
  const value = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1])
  if (Math.abs(value) < 1e-9) return 0
  return value > 0 ? 1 : 2
}

function onSegment(p, q, r) {
  return (
    q[0] <= Math.max(p[0], r[0]) &&
    q[0] >= Math.min(p[0], r[0]) &&
    q[1] <= Math.max(p[1], r[1]) &&
    q[1] >= Math.min(p[1], r[1])
  )
}
