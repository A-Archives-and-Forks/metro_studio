/**
 * Network topology statistics and analysis utilities.
 * Computes various metrics for rail transit network.
 */

import { dijkstra, findFarthestPair } from '../hud/hudGraphAlgorithms'
import { haversineDistanceMeters } from '../geo'

/**
 * Build adjacency list for network analysis.
 * @param {Array} edges - Project edges
 * @returns {Map<string, Array<{to: string, weight: number, edgeId: string}>>}
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
 * Build adjacency list with transfer penalty weights.
 * Higher weight for transfers to find paths with fewer transfers.
 * @param {Array} edges - Project edges
 * @param {Map<string, string[]>} stationToLines - Station ID -> Line IDs
 * @param {number} penaltyMultiplier - Transfer penalty multiplier (default: 1000)
 * @returns {Map<string, Array<{to: string, weight: number, edgeId: string, lineIds: string[]}>>}
 */
function buildTransferWeightAdj(edges, stationToLines, penaltyMultiplier = 1000) {
  const adj = new Map()
  for (const edge of edges) {
    const { fromStationId, toStationId, lengthMeters, id, sharedByLineIds } = edge
    if (!fromStationId || !toStationId) continue
    const fromLines = stationToLines.get(fromStationId) || []
    const toLines = stationToLines.get(toStationId) || []
    const edgeLines = sharedByLineIds || []
    const weight = lengthMeters || 0
    
    if (!adj.has(fromStationId)) adj.set(fromStationId, [])
    if (!adj.has(toStationId)) adj.set(toStationId, [])
    
    adj.get(fromStationId).push({ 
      to: toStationId, 
      weight, 
      edgeId: id,
      lineIds: edgeLines,
      fromLines,
      toLines 
    })
    adj.get(toStationId).push({ 
      to: fromStationId, 
      weight, 
      edgeId: id,
      lineIds: edgeLines,
      fromLines: toLines,
      toLines: fromLines
    })
  }
  return adj
}

/**
 * Reconstruct path from Dijkstra prev map.
 * @param {Map<string, string>} prev - Previous node map
 * @param {string} from - Start station ID
 * @param {string} to - End station ID
 * @returns {string[]} Station IDs in path (inclusive)
 */
function reconstructDijkstraPath(prev, from, to) {
  const path = []
  let current = to
  const visited = new Set()
  const maxSteps = 10000
  let steps = 0
  
  while (current && steps < maxSteps) {
    if (visited.has(current)) return []
    visited.add(current)
    path.push(current)
    if (current === from) break
    current = prev.get(current)
    steps++
  }
  
  path.reverse()
  if (path.length === 0 || path[0] !== from) return []
  return path
}

/**
 * Calculate path metrics: distance, station count, transfer count, unique lines.
 * @param {string[]} stationIds - Path station IDs
 * @param {Map<string, string[]>} stationToLines - Station line IDs
 * @param {Array} edges - All edges (for distance)
 * @param {Map<string, Object>} edgeById - Edge lookup
 * @returns {Object} Path metrics
 */
function calculatePathMetrics(stationIds, stationToLines, edges, edgeById) {
  let totalMeters = 0
  let transferCount = 0
  const uniqueLines = new Set()
  
  for (let i = 0; i < stationIds.length - 1; i++) {
    const fromId = stationIds[i]
    const toId = stationIds[i + 1]
    
    const fromLines = stationToLines.get(fromId) || []
    const toLines = stationToLines.get(toId) || []
    
    fromLines.forEach(l => uniqueLines.add(l))
    toLines.forEach(l => uniqueLines.add(l))
    
    if (fromLines.length > 0 && toLines.length > 0) {
      const hasSharedLine = fromLines.some(l => toLines.includes(l))
      if (!hasSharedLine) {
        transferCount++
      }
    }
    
    for (const edge of edges) {
      if ((edge.fromStationId === fromId && edge.toStationId === toId) ||
          (edge.fromStationId === toId && edge.toStationId === fromId)) {
        totalMeters += edge.lengthMeters || 0
        break
      }
    }
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
 * Find the path with maximum transfer count.
 * @param {Array} stations - All stations
 * @param {Array} edges - All edges
 * @returns {Object|null} Path info with stationIds, metrics, etc.
 */
export function findMaxTransferPath(stations, edges) {
  if (!stations?.length || !edges?.length) return null
  
  const stationToLines = new Map()
  for (const station of stations) {
    stationToLines.set(station.id, station.lineIds || [])
  }
  
  const adj = buildAdjacency(edges)
  const stationIds = stations.map(s => s.id)
  
  let bestPath = null
  let maxTransfers = 0
  
  for (const startId of stationIds) {
    const { prev } = dijkstra(adj, startId)
    
    for (const endId of stationIds) {
      if (endId === startId) continue
      
      const pathIds = reconstructDijkstraPath(prev, startId, endId)
      if (pathIds.length < 2) continue
      
      const metrics = calculatePathMetrics(pathIds, stationToLines, edges, new Map())
      
      if (metrics.transferCount > maxTransfers || 
          (metrics.transferCount === maxTransfers && bestPath && metrics.totalMeters > bestPath.metrics.totalMeters)) {
        maxTransfers = metrics.transferCount
        bestPath = {
          fromStationId: startId,
          toStationId: endId,
          stationIds: pathIds,
          metrics
        }
      }
    }
  }
  
  return bestPath
}

/**
 * Find the path with maximum unique lines count.
 * @param {Array} stations - All stations
 * @param {Array} edges - All edges
 * @returns {Object|null} Path info
 */
export function findMaxLinesPath(stations, edges) {
  if (!stations?.length || !edges?.length) return null
  
  const stationToLines = new Map()
  for (const station of stations) {
    stationToLines.set(station.id, station.lineIds || [])
  }
  
  const adj = buildAdjacency(edges)
  const stationIds = stations.map(s => s.id)
  
  let bestPath = null
  let maxLines = 0
  
  for (const startId of stationIds) {
    const { prev } = dijkstra(adj, startId)
    
    for (const endId of stationIds) {
      if (endId === startId) continue
      
      const pathIds = reconstructDijkstraPath(prev, startId, endId)
      if (pathIds.length < 2) continue
      
      const metrics = calculatePathMetrics(pathIds, stationToLines, edges, new Map())
      
      if (metrics.uniqueLinesCount > maxLines ||
          (metrics.uniqueLinesCount === maxLines && bestPath && metrics.totalMeters > bestPath.metrics.totalMeters)) {
        maxLines = metrics.uniqueLinesCount
        bestPath = {
          fromStationId: startId,
          toStationId: endId,
          stationIds: pathIds,
          metrics
        }
      }
    }
  }
  
  return bestPath
}

/**
 * Find the path with maximum station count.
 * @param {Array} stations - All stations
 * @param {Array} edges - All edges
 * @returns {Object|null} Path info
 */
export function findMaxStationsPath(stations, edges) {
  if (!stations?.length || !edges?.length) return null
  
  const stationToLines = new Map()
  for (const station of stations) {
    stationToLines.set(station.id, station.lineIds || [])
  }
  
  const adj = buildAdjacency(edges)
  const stationIds = stations.map(s => s.id)
  
  let bestPath = null
  let maxStations = 0
  
  for (const startId of stationIds) {
    const { prev } = dijkstra(adj, startId)
    
    for (const endId of stationIds) {
      if (endId === startId) continue
      
      const pathIds = reconstructDijkstraPath(prev, startId, endId)
      if (pathIds.length < 2) continue
      
      const metrics = calculatePathMetrics(pathIds, stationToLines, edges, new Map())
      
      if (metrics.stationCount > maxStations ||
          (metrics.stationCount === maxStations && bestPath && metrics.totalMeters > bestPath.metrics.totalMeters)) {
        maxStations = metrics.stationCount
        bestPath = {
          fromStationId: startId,
          toStationId: endId,
          stationIds: pathIds,
          metrics
        }
      }
    }
  }
  
  return bestPath
}

/**
 * Find the longest distance path using farthest pair algorithm.
 * @param {Array} stations - All stations
 * @param {Array} edges - All edges
 * @returns {Object|null} Path info
 */
export function findLongestDistancePath(stations, edges) {
  if (!stations?.length || !edges?.length) return null
  
  const stationToLines = new Map()
  for (const station of stations) {
    stationToLines.set(station.id, station.lineIds || [])
  }
  
  const adj = buildAdjacency(edges)
  const stationIdList = stations.map(s => s.id)
  
  const farthest = findFarthestPair(adj, stationIdList)
  if (!farthest) return null
  
  const { prev } = dijkstra(adj, farthest.from)
  const pathIds = reconstructDijkstraPath(prev, farthest.from, farthest.to)
  
  if (pathIds.length < 2) return null
  
  const metrics = calculatePathMetrics(pathIds, stationToLines, edges, new Map())
  
  return {
    fromStationId: farthest.from,
    toStationId: farthest.to,
    stationIds: pathIds,
    metrics: {
      ...metrics,
      maxDistance: farthest.distance
    }
  }
}

/**
 * Calculate comprehensive network topology metrics.
 * @param {Object} project - Project object
 * @returns {Object} Network metrics
 */
export function calculateNetworkMetrics(project) {
  const stations = project.stations || []
  const edges = project.edges || []
  const lines = project.lines || []
  
  if (!stations.length || !edges.length) {
    return null
  }
  
  const adj = buildAdjacency(edges)
  const lineById = new Map(lines.map(l => [l.id, l]))
  const stationById = new Map(stations.map(s => [s.id, s]))
  
  const stationToLines = new Map()
  for (const station of stations) {
    stationToLines.set(station.id, station.lineIds || [])
  }
  
  const totalMeters = edges.reduce((sum, e) => sum + (e.lengthMeters || 0), 0)
  
  const interchangeStations = stations.filter(s => s.isInterchange)
  const interchangeCounts = new Map()
  for (const station of interchangeStations) {
    const lineCount = stationToLines.get(station.id)?.length || 0
    interchangeCounts.set(lineCount, (interchangeCounts.get(lineCount) || 0) + 1)
  }
  
  const lineMetrics = lines.map(line => {
    const lineEdges = edges.filter(e => (e.sharedByLineIds || []).includes(line.id))
    const lineMeters = lineEdges.reduce((sum, e) => sum + (e.lengthMeters || 0), 0)
    const lineStations = new Set()
    for (const e of lineEdges) {
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
  
  const maxTransferPath = findMaxTransferPath(stations, edges)
  const maxLinesPath = findMaxLinesPath(stations, edges)
  const maxStationsPath = findMaxStationsPath(stations, edges)
  const longestDistancePath = findLongestDistancePath(stations, edges)
  
  const interchangeRanking = interchangeStations
    .map(station => ({
      stationId: station.id,
      stationName: station.nameZh,
      lineCount: stationToLines.get(station.id)?.length || 0,
      lineIds: stationToLines.get(station.id) || [],
      lineNames: (stationToLines.get(station.id) || []).map(lid => lineById.get(lid)?.nameZh).filter(Boolean)
    }))
    .sort((a, b) => b.lineCount - a.lineCount || a.stationName.localeCompare(b.stationName, 'zh-Hans-CN'))
  
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
    paths: {
      longestDistance: longestDistancePath,
      maxTransfers: maxTransferPath,
      maxLines: maxLinesPath,
      maxStations: maxStationsPath
    }
  }
}
