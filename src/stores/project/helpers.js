import { projectLngLat } from '../../lib/geo'

function estimateDisplayPositionFromLngLat(stations, lngLat) {
  const stationsWithDisplay = (stations || []).filter(
    (station) =>
      Array.isArray(station.lngLat) &&
      station.lngLat.length === 2 &&
      Array.isArray(station.displayPos) &&
      station.displayPos.length === 2,
  )

  if (stationsWithDisplay.length < 2) {
    return projectLngLat(lngLat)
  }

  let minLng = Number.POSITIVE_INFINITY
  let maxLng = Number.NEGATIVE_INFINITY
  let minLat = Number.POSITIVE_INFINITY
  let maxLat = Number.NEGATIVE_INFINITY
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const station of stationsWithDisplay) {
    minLng = Math.min(minLng, station.lngLat[0])
    maxLng = Math.max(maxLng, station.lngLat[0])
    minLat = Math.min(minLat, station.lngLat[1])
    maxLat = Math.max(maxLat, station.lngLat[1])
    minX = Math.min(minX, station.displayPos[0])
    maxX = Math.max(maxX, station.displayPos[0])
    minY = Math.min(minY, station.displayPos[1])
    maxY = Math.max(maxY, station.displayPos[1])
  }

  const lngSpan = Math.max(maxLng - minLng, 1e-6)
  const latSpan = Math.max(maxLat - minLat, 1e-6)
  const xSpan = Math.max(maxX - minX, 1)
  const ySpan = Math.max(maxY - minY, 1)

  const lngRatio = (lngLat[0] - minLng) / lngSpan
  const latRatio = (lngLat[1] - minLat) / latSpan

  return [minX + xSpan * lngRatio, minY + ySpan * latRatio]
}

function dedupeStationIds(ids, stationIdSet) {
  const result = []
  const seen = new Set()
  for (const id of ids || []) {
    if (!stationIdSet.has(id) || seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  return result
}

function applyRenameTemplate(template, sequenceNumber) {
  const normalized = String(template || '').trim()
  if (!normalized) return ''
  if (normalized.includes('{n}')) {
    return normalized.replaceAll('{n}', String(sequenceNumber))
  }
  return `${normalized}${sequenceNumber}`
}

function cloneLngLat(lngLat) {
  if (!Array.isArray(lngLat) || lngLat.length !== 2) return null
  const lng = Number(lngLat[0])
  const lat = Number(lngLat[1])
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  return [lng, lat]
}

function distanceSquared(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  return dx * dx + dy * dy
}

function buildEditableEdgeWaypoints(edge, fromLngLat, toLngLat) {
  const from = cloneLngLat(fromLngLat)
  const to = cloneLngLat(toLngLat)
  if (!from || !to) return null
  const rawPoints =
    Array.isArray(edge?.waypoints) && edge.waypoints.length >= 2
      ? edge.waypoints.map((point) => cloneLngLat(point)).filter(Boolean)
      : [from, to]
  if (rawPoints.length < 2) {
    return [from, to]
  }

  const directError = distanceSquared(rawPoints[0], from) + distanceSquared(rawPoints[rawPoints.length - 1], to)
  const reverseError = distanceSquared(rawPoints[0], to) + distanceSquared(rawPoints[rawPoints.length - 1], from)
  const orderedPoints = reverseError < directError ? [...rawPoints].reverse() : rawPoints
  orderedPoints[0] = from
  orderedPoints[orderedPoints.length - 1] = to
  return orderedPoints
}

function findClosestSegmentInsertionIndex(points, target) {
  if (!Array.isArray(points) || points.length < 2 || !Array.isArray(target) || target.length !== 2) {
    return 1
  }
  let bestInsertIndex = 1
  let bestDistanceSquared = Number.POSITIVE_INFINITY
  const [px, py] = target

  for (let i = 0; i < points.length - 1; i += 1) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[i + 1]
    const dx = x2 - x1
    const dy = y2 - y1
    const lenSq = dx * dx + dy * dy
    let t = 0
    if (lenSq > 0) {
      t = ((px - x1) * dx + (py - y1) * dy) / lenSq
    }
    const clamped = Math.max(0, Math.min(1, t))
    const cx = x1 + clamped * dx
    const cy = y1 + clamped * dy
    const distSq = (px - cx) * (px - cx) + (py - cy) * (py - cy)
    if (distSq < bestDistanceSquared) {
      bestDistanceSquared = distSq
      bestInsertIndex = i + 1
    }
  }
  return bestInsertIndex
}

export { estimateDisplayPositionFromLngLat, dedupeStationIds, applyRenameTemplate, cloneLngLat, distanceSquared, buildEditableEdgeWaypoints, findClosestSegmentInsertionIndex }
