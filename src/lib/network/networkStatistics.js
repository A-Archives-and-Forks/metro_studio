/**
 * Network topology statistics and analysis utilities.
 * Computes various metrics for rail transit network.
 *
 * Optimized: single Dijkstra pass per station, shared adjacency,
 * edge lookup map, and pre-indexed line→edges mapping.
 */

import { dijkstra } from '../hud/hudGraphAlgorithms'

/**
 * Build adjacency list for network analysis.
 */
function buildAdjacency(edges) {
  const adj = new Map()
  for (const edge of edges) {
    const { fromStationId, toStationId, lengthMeters, id } = edge
    if (!fromStationId || !toStationId) continue
    const weight = lengthMeters || 0
    if (!adj.has(fromStationId)) adj.set(fromStationId, [])
    if (!adj.has(toStationId)) adj.set(toStationId, [])
    adj.get(fromStationId).push({ to: toStationId, weight, edgeId: id })
    adj.get(toStationId).push({ to: fromStationId, weight, edgeId: id })
  }
  return adj
}

/**
 * Build a fast edge lookup: "stationA|stationB" -> edge,
 * keyed both directions for O(1) access.
 */
function buildEdgeLookup(edges) {
  const map = new Map()
  for (const edge of edges) {
    const { fromStationId, toStationId } = edge
    if (!fromStationId || !toStationId) continue
    map.set(`${fromStationId}|${toStationId}`, edge)
    map.set(`${toStationId}|${fromStationId}`, edge)
  }
  return map
}

/**
 * Reconstruct path from Dijkstra prev map.
 */
function reconstructPath(prev, from, to) {
  const path = []
  let current = to
  const visited = new Set()
  while (current) {
    if (visited.has(current)) return []
    visited.add(current)
    path.push(current)
    if (current === from) break
    current = prev.get(current)
  }
  path.reverse()
  if (path.length === 0 || path[0] !== from) return []
  return path
}

/**
 * Calculate path metrics using edge lookup map (O(1) per step).
 */
function calculatePathMetrics(stationIds, stationToLines, edgeLookup) {
  let totalMeters = 0
  let transferCount = 0
  const uniqueLines = new Set()

  for (let i = 0; i < stationIds.length - 1; i++) {
    const fromId = stationIds[i]
    const toId = stationIds[i + 1]

    const fromLines = stationToLines.get(fromId) || []
    const toLines = stationToLines.get(toId) || []

    for (const l of fromLines) uniqueLines.add(l)
    for (const l of toLines) uniqueLines.add(l)

    if (fromLines.length > 0 && toLines.length > 0) {
      if (!fromLines.some(l => toLines.includes(l))) {
        transferCount++
      }
    }

    const edge = edgeLookup.get(`${fromId}|${toId}`)
    if (edge) totalMeters += edge.lengthMeters || 0
  }

  return {
    stationCount: stationIds.length,
    totalMeters,
    transferCount,
    uniqueLinesCount: uniqueLines.size,
    uniqueLines: Array.from(uniqueLines)
  }
}

/**
 * Find all four "extreme" paths in a single pass of Dijkstra per station.
 * Instead of 4 separate O(N × Dijkstra) loops, we do 1 loop and evaluate
 * all criteria for each (start, end) pair simultaneously.
 */
function findAllExtremePaths(stations, adj, stationToLines, edgeLookup) {
  const stationIds = [...adj.keys()]
  if (stationIds.length === 0) return { longestDistance: null, maxTransfers: null, maxLines: null, maxStations: null }

  let bestDistance = null, maxDist = -1
  let bestTransfers = null, maxTrans = -1
  let bestLines = null, maxLn = -1
  let bestStations = null, maxSt = -1

  for (const startId of stationIds) {
    const { dist, prev } = dijkstra(adj, startId)

    for (const endId of stationIds) {
      if (endId === startId) continue
      const d = dist.get(endId)
      if (!Number.isFinite(d)) continue

      // Quick check: can this pair beat any current best?
      // For distance, we can check before reconstructing the path.
      const couldBeatDistance = d > maxDist
      // For others we need the path, but we can skip if distance is 0
      // (disconnected or same node — already filtered above).

      // Only reconstruct path if there's a chance it beats something,
      // or if we haven't found any path yet.
      const needPath = couldBeatDistance ||
        bestTransfers === null || bestLines === null || bestStations === null

      // For transfer/lines/stations, we can't pre-filter without the path,
      // so we reconstruct for all reachable pairs. The key optimization is
      // doing this once instead of 4 times.
      const pathIds = reconstructPath(prev, startId, endId)
      if (pathIds.length < 2) continue

      const metrics = calculatePathMetrics(pathIds, stationToLines, edgeLookup)

      // Longest distance
      if (d > maxDist) {
        maxDist = d
        bestDistance = { fromStationId: startId, toStationId: endId, stationIds: pathIds, metrics: { ...metrics, maxDistance: d } }
      }

      // Max transfers
      if (metrics.transferCount > maxTrans ||
          (metrics.transferCount === maxTrans && bestTransfers && metrics.totalMeters > bestTransfers.metrics.totalMeters)) {
        maxTrans = metrics.transferCount
        bestTransfers = { fromStationId: startId, toStationId: endId, stationIds: pathIds, metrics }
      }

      // Max unique lines
      if (metrics.uniqueLinesCount > maxLn ||
          (metrics.uniqueLinesCount === maxLn && bestLines && metrics.totalMeters > bestLines.metrics.totalMeters)) {
        maxLn = metrics.uniqueLinesCount
        bestLines = { fromStationId: startId, toStationId: endId, stationIds: pathIds, metrics }
      }

      // Max stations
      if (metrics.stationCount > maxSt ||
          (metrics.stationCount === maxSt && bestStations && metrics.totalMeters > bestStations.metrics.totalMeters)) {
        maxSt = metrics.stationCount
        bestStations = { fromStationId: startId, toStationId: endId, stationIds: pathIds, metrics }
      }
    }
  }

  return {
    longestDistance: bestDistance,
    maxTransfers: bestTransfers,
    maxLines: bestLines,
    maxStations: bestStations
  }
}

/**
 * Calculate comprehensive network topology metrics.
 */
export function calculateNetworkMetrics(project) {
  const stations = project.stations || []
  const edges = project.edges || []
  const lines = project.lines || []

  if (!stations.length || !edges.length) return null

  // Shared data structures — built once
  const adj = buildAdjacency(edges)
  const edgeLookup = buildEdgeLookup(edges)
  const lineById = new Map(lines.map(l => [l.id, l]))

  const stationToLines = new Map()
  for (const station of stations) {
    stationToLines.set(station.id, station.transferLineIds?.length ? station.transferLineIds : (station.lineIds || []))
  }

  const totalMeters = edges.reduce((sum, e) => sum + (e.lengthMeters || 0), 0)

  // Build transfer groups using manualTransfers (virtual interchange stations)
  const manualTransfers = project.manualTransfers || []
  const transferGroups = new Map() // rootStationId -> Set of stationIds in the group
  const stationToGroupRoot = new Map() // stationId -> rootStationId

  // Initialize each station as its own group
  for (const s of stations) {
    transferGroups.set(s.id, new Set([s.id]))
    stationToGroupRoot.set(s.id, s.id)
  }

  // Union-Find to merge connected stations
  function findRoot(id) {
    const root = stationToGroupRoot.get(id)
    if (root === id) return id
    const ultimateRoot = findRoot(root)
    stationToGroupRoot.set(id, ultimateRoot)
    return ultimateRoot
  }

  function union(idA, idB) {
    const rootA = findRoot(idA)
    const rootB = findRoot(idB)
    if (rootA === rootB) return
    // Merge groupB into groupA
    const groupA = transferGroups.get(rootA)
    const groupB = transferGroups.get(rootB)
    for (const id of groupB) {
      groupA.add(id)
      stationToGroupRoot.set(id, rootA)
    }
    transferGroups.delete(rootB)
  }

  // Process manual transfers to build groups
  for (const t of manualTransfers) {
    if (t.stationAId && t.stationBId && t.stationAId !== t.stationBId) {
      union(String(t.stationAId), String(t.stationBId))
    }
  }

  // Interchange stats
  const interchangeStations = stations.filter(s => s.isInterchange)
  const interchangeCounts = new Map()
  for (const station of interchangeStations) {
    const lineCount = stationToLines.get(station.id)?.length || 0
    interchangeCounts.set(lineCount, (interchangeCounts.get(lineCount) || 0) + 1)
  }

  // Line metrics — pre-index edges by lineId to avoid O(L×E) scan
  const edgesByLine = new Map()
  for (const edge of edges) {
    for (const lineId of (edge.sharedByLineIds || [])) {
      if (!edgesByLine.has(lineId)) edgesByLine.set(lineId, [])
      edgesByLine.get(lineId).push(edge)
    }
  }

  const lineMetrics = lines.map(line => {
    const lineEdges = edgesByLine.get(line.id) || []
    let lineMeters = 0
    const lineStations = new Set()
    for (const e of lineEdges) {
      lineMeters += e.lengthMeters || 0
      lineStations.add(e.fromStationId)
      lineStations.add(e.toStationId)
    }
    return {
      lineId: line.id,
      lineName: line.nameZh,
      stationCount: lineStations.size,
      edgeCount: lineEdges.length,
      meters: lineMeters,
      isLoop: line.isLoop
    }
  })

  // All path analyses in a single Dijkstra pass
  const paths = findAllExtremePaths(stations, adj, stationToLines, edgeLookup)

  // Interchange ranking — merge virtual transfer groups
  const stationById = new Map(stations.map(s => [s.id, s]))
  const seenRoots = new Set()
  const interchangeRanking = []
  for (const station of interchangeStations) {
    const root = findRoot(station.id)
    if (seenRoots.has(root)) continue
    seenRoots.add(root)
    const group = transferGroups.get(root)
    const mergedLineIds = new Set()
    const names = []
    for (const sid of group) {
      for (const lid of (stationToLines.get(sid) || [])) mergedLineIds.add(lid)
      const s = stationById.get(sid)
      if (s?.nameZh) names.push(s.nameZh)
    }
    if (mergedLineIds.size < 2) continue
    interchangeRanking.push({
      stationId: root,
      stationName: names.join('-'),
      lineCount: mergedLineIds.size,
      lineIds: [...mergedLineIds],
      lineNames: [...mergedLineIds].map(lid => lineById.get(lid)?.nameZh).filter(Boolean)
    })
  }
  interchangeRanking.sort((a, b) => b.lineCount - a.lineCount || a.stationName.localeCompare(b.stationName, 'zh-Hans-CN'))

  return {
    basics: {
      lineCount: lines.length,
      stationCount: stations.length,
      edgeCount: edges.length,
      interchangeCount: interchangeStations.length,
      totalKm: totalMeters / 1000,
      totalMeters
    },
    lines: lineMetrics,
    interchanges: {
      total: interchangeStations.length,
      byLineCount: Object.fromEntries(Array.from(interchangeCounts.entries()).sort((a, b) => a[0] - b[0])),
      ranking: interchangeRanking.slice(0, 50)
    },
    paths
  }
}
