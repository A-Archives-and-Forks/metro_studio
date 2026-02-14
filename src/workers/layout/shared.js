
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

function pointInRect(x, y, rect) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

function distancePointToRect(px, py, rect) {
  const dx = Math.max(rect.left - px, 0, px - rect.right)
  const dy = Math.max(rect.top - py, 0, py - rect.bottom)
  return Math.hypot(dx, dy)
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

function segmentIntersectsRectWithClearance(
  from,
  to,
  rect,
  clearance,
  incidentStationPoint = null,
  endpointIgnoreRadius = 0,
) {
  const expanded = expandRect(rect, clearance)
  const { from: trimmedFrom, to: trimmedTo, valid } = trimSegmentNearStation(
    from,
    to,
    incidentStationPoint,
    endpointIgnoreRadius,
  )
  if (!valid) return false
  return segmentIntersectsRect(trimmedFrom, trimmedTo, expanded)
}

function distanceSegmentToRect(from, to, rect, incidentStationPoint = null, endpointIgnoreRadius = 0) {
  const { from: trimmedFrom, to: trimmedTo, valid } = trimSegmentNearStation(
    from,
    to,
    incidentStationPoint,
    endpointIgnoreRadius,
  )
  if (!valid) return Number.POSITIVE_INFINITY
  if (segmentIntersectsRect(trimmedFrom, trimmedTo, rect)) return 0

  const corners = [
    [rect.left, rect.top],
    [rect.right, rect.top],
    [rect.right, rect.bottom],
    [rect.left, rect.bottom],
  ]
  let minDistance = Number.POSITIVE_INFINITY
  for (const corner of corners) {
    minDistance = Math.min(minDistance, distancePointToSegment(corner, trimmedFrom, trimmedTo))
  }

  const edges = [
    [[rect.left, rect.top], [rect.right, rect.top]],
    [[rect.right, rect.top], [rect.right, rect.bottom]],
    [[rect.right, rect.bottom], [rect.left, rect.bottom]],
    [[rect.left, rect.bottom], [rect.left, rect.top]],
  ]
  for (const [edgeFrom, edgeTo] of edges) {
    minDistance = Math.min(minDistance, segmentToSegmentDistance(trimmedFrom, trimmedTo, edgeFrom, edgeTo))
  }
  return minDistance
}

function trimSegmentNearStation(from, to, stationPoint, ignoreRadius) {
  if (!stationPoint || ignoreRadius <= 0) return { from, to, valid: true }

  const trimmedFrom = [...from]
  const trimmedTo = [...to]
  const radius = Math.max(0, ignoreRadius)
  if (distance(trimmedFrom, trimmedTo) < 1e-6) return { from: trimmedFrom, to: trimmedTo, valid: false }

  const fromDistance = distance(trimmedFrom, stationPoint)
  if (fromDistance < radius) {
    const segmentLength = distance(trimmedFrom, trimmedTo)
    const ratio = clamp((radius - fromDistance) / Math.max(segmentLength, 1e-6), 0, 0.95)
    trimmedFrom[0] += (trimmedTo[0] - trimmedFrom[0]) * ratio
    trimmedFrom[1] += (trimmedTo[1] - trimmedFrom[1]) * ratio
  }

  const toDistance = distance(trimmedTo, stationPoint)
  if (toDistance < radius) {
    const segmentLength = distance(trimmedFrom, trimmedTo)
    const ratio = clamp((radius - toDistance) / Math.max(segmentLength, 1e-6), 0, 0.95)
    trimmedTo[0] += (trimmedFrom[0] - trimmedTo[0]) * ratio
    trimmedTo[1] += (trimmedFrom[1] - trimmedTo[1]) * ratio
  }

  return {
    from: trimmedFrom,
    to: trimmedTo,
    valid: distance(trimmedFrom, trimmedTo) > 1e-6,
  }
}

function expandRect(rect, margin) {
  return {
    left: rect.left - margin,
    right: rect.right + margin,
    top: rect.top - margin,
    bottom: rect.bottom + margin,
  }
}

function distancePointToSegment(point, from, to) {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-9) return distance(point, from)
  const t = clamp(((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / len2, 0, 1)
  const proj = [from[0] + dx * t, from[1] + dy * t]
  return distance(point, proj)
}

function segmentToSegmentDistance(a1, a2, b1, b2) {
  if (segmentsIntersect(a1, a2, b1, b2)) return 0
  return Math.min(
    distancePointToSegment(a1, b1, b2),
    distancePointToSegment(a2, b1, b2),
    distancePointToSegment(b1, a1, a2),
    distancePointToSegment(b2, a1, a2),
  )
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


export { toFiniteNumber, snapAngle, normalizeAngle, normalizePositiveAngle, interpolateAngles, distance, clamp, lerp, segmentBox, boxesOverlap, segmentsIntersect, orientation, onSegment, pointInRect, distancePointToRect, segmentIntersectsRect, segmentIntersectsRectWithClearance, distanceSegmentToRect, trimSegmentNearStation, expandRect, distancePointToSegment, segmentToSegmentDistance, projectPointToLine, circularDirectionDistance, angleToDirectionIndex, directionIndexToAngle }
