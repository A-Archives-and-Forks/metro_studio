import {
  clamp,
  toFiniteNumber,
  normalizeNameKey,
  round,
  MAX_RADIUS_METERS,
  ROAD_IMPORTANCE,
} from './nearbyStationNamingParser'

export function toScoredRecord({ entryType, nameZh, nameEn, distanceMeters, importance, type, element, meta = null }) {
  const distanceScore = clamp(1 - distanceMeters / (MAX_RADIUS_METERS * 1.2), 0, 1)
  const score =
    entryType === 'road'
      ? importance * 0.82 + distanceScore * 0.18
      : importance * 0.72 + distanceScore * 0.28
  return {
    entryType,
    nameZh,
    nameEn,
    type,
    distanceMeters,
    importance,
    score,
    osmType: String(element?.type || ''),
    osmId: element?.id,
    geometry: Array.isArray(element?.geometry) ? element.geometry : null,
    meta: meta && typeof meta === 'object' ? { ...meta } : null,
  }
}

export function projectApproxMeters(lngLat, centerLngLat) {
  const [lng, lat] = lngLat
  const [centerLng, centerLat] = centerLngLat
  const latRad = (centerLat * Math.PI) / 180
  const x = (lng - centerLng) * (111320 * Math.cos(latRad))
  const y = (lat - centerLat) * 110540
  return [x, y]
}

export function distancePointToSegmentMeters(p, a, b) {
  const vx = b[0] - a[0]
  const vy = b[1] - a[1]
  const wx = p[0] - a[0]
  const wy = p[1] - a[1]
  const len2 = vx * vx + vy * vy
  if (len2 < 1e-8) {
    const dx = p[0] - a[0]
    const dy = p[1] - a[1]
    return { distance: Math.hypot(dx, dy), direction: [0, 0] }
  }
  const t = clamp((wx * vx + wy * vy) / len2, 0, 1)
  const projX = a[0] + t * vx
  const projY = a[1] + t * vy
  const dx = p[0] - projX
  const dy = p[1] - projY
  const segLen = Math.hypot(vx, vy)
  const direction = segLen > 1e-8 ? [vx / segLen, vy / segLen] : [0, 0]
  return { distance: Math.hypot(dx, dy), direction }
}

export function analyzeRoadGeometryAtPoint(roadRecord, centerLngLat) {
  const geometry = Array.isArray(roadRecord?.geometry) ? roadRecord.geometry : []
  if (geometry.length < 2) return null
  const centerXY = projectApproxMeters(centerLngLat, centerLngLat)

  let best = null
  const maxDistance = 200

  for (let i = 0; i < geometry.length - 1; i += 1) {
    const from = [toFiniteNumber(geometry[i]?.lon, Number.NaN), toFiniteNumber(geometry[i]?.lat, Number.NaN)]
    const to = [toFiniteNumber(geometry[i + 1]?.lon, Number.NaN), toFiniteNumber(geometry[i + 1]?.lat, Number.NaN)]
    if (!Number.isFinite(from[0]) || !Number.isFinite(from[1]) || !Number.isFinite(to[0]) || !Number.isFinite(to[1])) continue

    const fromXY = projectApproxMeters(from, centerLngLat)
    const toXY = projectApproxMeters(to, centerLngLat)

    const candidate = distancePointToSegmentMeters(centerXY, fromXY, toXY)

    if (!best || candidate.distance < best.distance) {
      best = candidate
      if (best.distance <= 10) {
        return best
      }
    }
  }

  return best
}

export function detectRoadIntersections(roadRecords, centerLngLat, radiusMeters) {
  const roads = Array.isArray(roadRecords) ? roadRecords : []
  if (roads.length < 2) return []

  const analyzed = []
  for (const road of roads) {
    const nameZh = String(road?.nameZh || '').trim()
    if (!nameZh) continue
    const analysis = analyzeRoadGeometryAtPoint(road, centerLngLat)
    if (!analysis) continue
    analyzed.push({
      ...road,
      localDistanceMeters: analysis.distance,
      direction: analysis.direction,
    })
  }

  const nearThreshold = Math.min(55, radiusMeters * 0.2)

  const nearRoads = analyzed.filter((road) => road.localDistanceMeters <= nearThreshold)

  if (nearRoads.length < 2) return []

  const sortedNearRoads = nearRoads.sort((a, b) => a.localDistanceMeters - b.localDistanceMeters)

  const topRoads = sortedNearRoads.slice(0, Math.min(6, sortedNearRoads.length))

  const intersections = []
  const seen = new Set()

  for (let i = 0; i < topRoads.length; i += 1) {
    for (let j = i + 1; j < topRoads.length; j += 1) {
      const a = topRoads[i]
      const b = topRoads[j]
      if (normalizeNameKey(a.nameZh) === normalizeNameKey(b.nameZh)) continue

      const dot = clamp(a.direction[0] * b.direction[0] + a.direction[1] * b.direction[1], -1, 1)
      const angleDeg = Math.abs((Math.acos(Math.abs(dot)) * 180) / Math.PI)
      if (angleDeg < 18) continue

      const combinedImportance = (a.importance + b.importance) / 2
      const combinedDistance = (a.localDistanceMeters + b.localDistanceMeters) / 2
      const intersectionScore = combinedImportance * 0.8 + clamp(1 - combinedDistance / 60, 0, 1) * 0.2

      const pairNames = [a.nameZh, b.nameZh]
      const key = `${normalizeNameKey(pairNames[0])}__${normalizeNameKey(pairNames[1])}`
      if (seen.has(key)) continue
      seen.add(key)

      intersections.push({
        nameZh: `${pairNames[0]}·${pairNames[1]}`,
        nameEn: '',
        type: '道路交叉口',
        roadNameZhList: pairNames,
        distanceMeters: round(combinedDistance, 0),
        importance: round(combinedImportance, 3),
        score: round(intersectionScore, 3),
        source: `${a.osmType}/${a.osmId}+${b.osmType}/${b.osmId}`,
      })
    }
  }

  return intersections.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 1e-6) return b.score - a.score
    if (Math.abs(a.distanceMeters - b.distanceMeters) > 1e-6) return a.distanceMeters - b.distanceMeters
    const aName = String(a.nameZh)
    const bName = String(b.nameZh)
    return aName < bName ? -1 : aName > bName ? 1 : 0
  })
}

export function rebalanceRoadRecords(records, radiusMeters) {
  const items = Array.isArray(records) ? records : []
  if (!items.length) return []

  const nearbyMajorRoads = items.filter((record) => record.importance >= 0.9 && record.distanceMeters <= Math.min(radiusMeters * 0.95, 260))
  const hasNearbyMajorRoad = nearbyMajorRoads.length > 0
  const majorBestScore = nearbyMajorRoads.reduce((best, record) => Math.max(best, record.score), 0)

  const rebalanced = items.map((record) => {
    let adjustedScore = record.score
    if (record.importance >= 0.9) adjustedScore += 0.085
    else if (record.importance >= 0.84) adjustedScore += 0.032

    if (hasNearbyMajorRoad) {
      if (record.importance < 0.84 && record.distanceMeters > 85) adjustedScore -= 0.12
      if (record.importance < 0.76 && record.distanceMeters > 45) adjustedScore -= 0.16
    }

    return {
      ...record,
      score: adjustedScore,
    }
  })

  if (!hasNearbyMajorRoad) return rebalanced

  return rebalanced.filter((record) => {
    if (record.distanceMeters <= 55) return true
    if (record.importance >= 0.84) return true
    return record.score >= majorBestScore - 0.22
  })
}

export function upsertByName(bucket, record) {
  const key = normalizeNameKey(record?.nameZh || record?.nameEn)
  if (!key) return
  const previous = bucket.get(key)
  if (!previous) {
    bucket.set(key, record)
    return
  }
  const betterScore = record.score > previous.score + 1e-6
  const sameScoreCloser = Math.abs(record.score - previous.score) <= 1e-6 && record.distanceMeters < previous.distanceMeters
  if (betterScore || sameScoreCloser) {
    bucket.set(key, record)
  }
}

export function sortAndProjectRecords(records) {
  return [...records]
    .sort((a, b) => {
      if (Math.abs(b.score - a.score) > 1e-6) return b.score - a.score
      if (Math.abs(a.distanceMeters - b.distanceMeters) > 1e-6) return a.distanceMeters - b.distanceMeters
      const aName = String(a.nameZh)
      const bName = String(b.nameZh)
      return aName < bName ? -1 : aName > bName ? 1 : 0
    })
    .map((record) => ({
      nameZh: record.nameZh,
      nameEn: record.nameEn,
      type: record.type,
      distanceMeters: round(record.distanceMeters, 0),
      importance: round(record.importance, 3),
      score: round(record.score, 3),
      source: `${record.osmType}/${record.osmId}`,
      meta: record.meta || null,
    }))
}

export function assertLngLat(lngLat) {
  if (!Array.isArray(lngLat) || lngLat.length !== 2) {
    throw new Error('坐标格式无效')
  }
  const lng = toFiniteNumber(lngLat[0], Number.NaN)
  const lat = toFiniteNumber(lngLat[1], Number.NaN)
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    throw new Error('坐标格式无效')
  }
  return [lng, lat]
}
