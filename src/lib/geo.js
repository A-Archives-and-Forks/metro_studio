const EARTH_RADIUS = 6378137
const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI

export function projectLngLat(lngLat) {
  const [lng, lat] = lngLat
  const x = EARTH_RADIUS * lng * DEG_TO_RAD
  const y =
    EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (Math.max(Math.min(lat, 89.5), -89.5) * DEG_TO_RAD) / 2))
  return [x, y]
}

export function unprojectXY(xy) {
  const [x, y] = xy
  const lng = (x / EARTH_RADIUS) * RAD_TO_DEG
  const lat = (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * RAD_TO_DEG
  return [lng, lat]
}

export function haversineDistanceMeters(a, b) {
  const [lng1, lat1] = a
  const [lng2, lat2] = b
  const dLat = (lat2 - lat1) * DEG_TO_RAD
  const dLng = (lng2 - lng1) * DEG_TO_RAD
  const sinDLat = Math.sin(dLat / 2)
  const sinDLng = Math.sin(dLng / 2)
  const q =
    sinDLat * sinDLat +
    Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * sinDLng * sinDLng
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(q))
}

export function segmentIntersects(a, b, c, d) {
  const o1 = orientation(a, b, c)
  const o2 = orientation(a, b, d)
  const o3 = orientation(c, d, a)
  const o4 = orientation(c, d, b)

  if (o1 !== o2 && o3 !== o4) {
    return true
  }

  if (o1 === 0 && onSegment(a, c, b)) return true
  if (o2 === 0 && onSegment(a, d, b)) return true
  if (o3 === 0 && onSegment(c, a, d)) return true
  if (o4 === 0 && onSegment(c, b, d)) return true

  return false
}

function orientation(p, q, r) {
  const value = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1])
  if (Math.abs(value) < 1e-10) return 0
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

export function bboxFromXY(points) {
  if (!points.length) {
    return { minX: 0, minY: 0, maxX: 1, maxY: 1 }
  }
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const [x, y] of points) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  return { minX, minY, maxX, maxY }
}

function roughlyEqual(a, b, epsilon = 1e-6) {
  return Math.abs(a - b) <= epsilon
}

function dedupeSequentialPoints(points, epsilon = 1e-6) {
  if (!points.length) return []
  const result = [points[0]]
  for (let i = 1; i < points.length; i += 1) {
    const prev = result[result.length - 1]
    const current = points[i]
    if (roughlyEqual(prev[0], current[0], epsilon) && roughlyEqual(prev[1], current[1], epsilon)) continue
    result.push(current)
  }
  return result
}

export function buildOctilinearPolyline(from, to, epsilon = 1e-6) {
  const [x1, y1] = from
  const [x2, y2] = to
  const dx = x2 - x1
  const dy = y2 - y1
  const absDx = Math.abs(dx)
  const absDy = Math.abs(dy)

  if (
    absDx <= epsilon ||
    absDy <= epsilon ||
    roughlyEqual(absDx, absDy, epsilon)
  ) {
    return dedupeSequentialPoints([from, to], epsilon)
  }

  const sx = dx >= 0 ? 1 : -1
  const sy = dy >= 0 ? 1 : -1

  if (absDx > absDy) {
    const diagonal = absDy
    const bend = [x1 + sx * diagonal, y1 + sy * diagonal]
    return dedupeSequentialPoints([from, bend, to], epsilon)
  }

  const diagonal = absDx
  const bend = [x1 + sx * diagonal, y1 + sy * diagonal]
  return dedupeSequentialPoints([from, bend, to], epsilon)
}
