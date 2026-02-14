import {
  boxesOverlap,
  clamp,
  distance,
  distancePointToRect,
  distanceSegmentToRect,
  segmentIntersectsRectWithClearance,
  toFiniteNumber,
} from './shared'

function computeStationLabelLayout(positions, stations, edgeRecords, nodeDegrees, config) {
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
  const lineClearance = Math.max(2, toFiniteNumber(config.labelLineClearance, 9.5))
  const incidentIgnoreRadius = Math.max(0, toFiniteNumber(config.incidentEdgeLabelIgnoreRadius, 10))

  for (const stationIndex of order) {
    const station = stations[stationIndex]
    const base = positions[stationIndex]
    const width = estimateLabelWidth(station)
    const height = station.nameEn ? 26 : 15
    const templates = buildLabelTemplates(station, config, nodeDegrees[stationIndex] || 0)
    const orientationBias = detectStationOrientationBias(segments, stationIndex, base)
    const preferredTemplates =
      orientationBias === 'vertical'
        ? templates.filter((template) => template.anchor === 'middle')
        : templates

    let best = null
    let bestScore = Number.POSITIVE_INFINITY

    const scoreTemplate = (template, strictLineClearance) => {
      const box = buildLabelBox(base, width, height, template, config.labelPadding)
      let score = candidateSidePenalty(template.side, segments, stationIndex, base)
      let hardInvalid = false

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
        const isIncident = segment.fromIndex === stationIndex || segment.toIndex === stationIndex
        const stationCenter = isIncident ? base : null
        const intersected = segmentIntersectsRectWithClearance(
          segment.from,
          segment.to,
          box,
          lineClearance,
          stationCenter,
          incidentIgnoreRadius,
        )
        if (intersected) {
          score += isIncident ? 180 : 320
          if (strictLineClearance) hardInvalid = true
          continue
        }

        const segmentDistance = distanceSegmentToRect(
          segment.from,
          segment.to,
          box,
          stationCenter,
          incidentIgnoreRadius,
        )
        if (segmentDistance < lineClearance) {
          const gapPenalty = (lineClearance - segmentDistance) * (isIncident ? 18 : 22)
          score += gapPenalty
          if (strictLineClearance) hardInvalid = true
        }
      }

      return { score, hardInvalid, box }
    }

    const strictPools = []
    if (preferredTemplates.length) strictPools.push(preferredTemplates)
    strictPools.push(templates)

    for (const pool of strictPools) {
      for (const template of pool) {
        const candidate = scoreTemplate(template, true)
        if (candidate.hardInvalid) continue
        if (candidate.score < bestScore) {
          bestScore = candidate.score
          best = { ...template, box: candidate.box }
        }
      }
      if (best) break
    }

    if (!best) {
      const softPools = []
      if (preferredTemplates.length) softPools.push(preferredTemplates)
      softPools.push(templates)
      for (const pool of softPools) {
        for (const template of pool) {
          const candidate = scoreTemplate(template, false)
          if (candidate.score < bestScore) {
            bestScore = candidate.score
            best = { ...template, box: candidate.box }
          }
        }
        if (best) break
      }
    }

    if (!best) {
      for (const template of templates) {
        const box = buildLabelBox(base, width, height, template, config.labelPadding)
        let score = candidateSidePenalty(template.side, segments, stationIndex, base)
        for (const segment of segments) {
          const isIncident = segment.fromIndex === stationIndex || segment.toIndex === stationIndex
          const stationCenter = isIncident ? base : null
          const intersected = segmentIntersectsRectWithClearance(
            segment.from,
            segment.to,
            box,
            lineClearance,
            stationCenter,
            incidentIgnoreRadius,
          )
          if (intersected) score += isIncident ? 180 : 320
        }
        if (score < bestScore) {
          bestScore = score
          best = { ...template, box }
        }
      }
    }

    if (!best) {
      const fallbackPlacement = templates[0] || { dx: 14, dy: -26, anchor: 'start', side: 'E_N' }
      best = {
        ...fallbackPlacement,
        box: buildLabelBox(base, width, height, fallbackPlacement, config.labelPadding),
      }
    }

    labels[station.id] = {
      dx: best.dx,
      dy: best.dy,
      anchor: best.anchor,
    }
    placed.push({ stationIndex, box: best.box })
  }

  return relaxStationLabelLayout(
    positions,
    stations,
    labels,
    segments,
    config,
    lineClearance,
    incidentIgnoreRadius,
  )
}

function relaxStationLabelLayout(
  positions,
  stations,
  labels,
  segments,
  config,
  lineClearance,
  incidentIgnoreRadius,
) {
  const iterations = Math.max(0, Math.floor(toFiniteNumber(config.labelRelaxIterations, 26)))
  if (!iterations) return labels

  const maxOffset = Math.max(8, toFiniteNumber(config.labelRelaxMaxOffset, 34))
  const stepBase = clamp(toFiniteNumber(config.labelRelaxStep, 0.34), 0.05, 1)
  const pairPadding = Math.max(0, toFiniteNumber(config.labelPairPadding, 3.5))
  const anchorTether = clamp(toFiniteNumber(config.labelAnchorTether, 0.11), 0, 1)
  const maxMovePerIter = Math.max(0.4, toFiniteNumber(config.labelRelaxMaxMovePerIter, 5.2))

  const entries = []
  for (let stationIndex = 0; stationIndex < stations.length; stationIndex += 1) {
    const station = stations[stationIndex]
    const placement = labels[station.id]
    if (!placement) continue
    entries.push({
      stationId: station.id,
      stationIndex,
      basePoint: positions[stationIndex],
      width: estimateLabelWidth(station),
      height: station.nameEn ? 26 : 15,
      anchor: placement.anchor || 'start',
      baseDx: toFiniteNumber(placement.dx),
      baseDy: toFiniteNumber(placement.dy),
      dx: toFiniteNumber(placement.dx),
      dy: toFiniteNumber(placement.dy),
    })
  }
  if (!entries.length) return labels

  const minStationDistanceToLabel = 8.5

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const boxes = entries.map((entry) =>
      buildLabelBox(
        entry.basePoint,
        entry.width,
        entry.height,
        { dx: entry.dx, dy: entry.dy, anchor: entry.anchor },
        config.labelPadding,
      ),
    )
    const centers = boxes.map((box) => ({
      x: (box.left + box.right) * 0.5,
      y: (box.top + box.bottom) * 0.5,
    }))
    const deltas = entries.map(() => [0, 0])

    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const overlapX = Math.min(boxes[i].right, boxes[j].right) - Math.max(boxes[i].left, boxes[j].left)
        const overlapY = Math.min(boxes[i].bottom, boxes[j].bottom) - Math.max(boxes[i].top, boxes[j].top)
        if (overlapX <= 0 || overlapY <= 0) continue

        const pushX = overlapX + pairPadding
        const pushY = overlapY + pairPadding
        const prefersHorizontalSeparation =
          Math.abs(centers[i].x - centers[j].x) >= Math.abs(centers[i].y - centers[j].y)
        if (prefersHorizontalSeparation) {
          const dir = centers[i].x <= centers[j].x ? -1 : 1
          const magnitude = pushX * 0.4
          deltas[i][0] += dir * magnitude
          deltas[j][0] -= dir * magnitude
        } else {
          const dir = centers[i].y <= centers[j].y ? -1 : 1
          const magnitude = pushY * 0.55
          deltas[i][1] += dir * magnitude
          deltas[j][1] -= dir * magnitude
        }
      }
    }

    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      const entry = entries[entryIndex]
      const box = boxes[entryIndex]
      const center = centers[entryIndex]

      for (const segment of segments) {
        const isIncident =
          segment.fromIndex === entry.stationIndex || segment.toIndex === entry.stationIndex
        const stationCenter = isIncident ? entry.basePoint : null
        const intersects = segmentIntersectsRectWithClearance(
          segment.from,
          segment.to,
          box,
          lineClearance,
          stationCenter,
          incidentIgnoreRadius,
        )
        const segmentDistance = intersects
          ? 0
          : distanceSegmentToRect(
              segment.from,
              segment.to,
              box,
              stationCenter,
              incidentIgnoreRadius,
            )
        if (segmentDistance >= lineClearance) continue

        const segmentMidX = (segment.from[0] + segment.to[0]) * 0.5
        const segmentMidY = (segment.from[1] + segment.to[1]) * 0.5
        let vx = center.x - segmentMidX
        let vy = center.y - segmentMidY
        if (Math.hypot(vx, vy) < 1e-6) {
          const sx = segment.to[0] - segment.from[0]
          const sy = segment.to[1] - segment.from[1]
          vx = -sy
          vy = sx
        }
        const norm = Math.max(Math.hypot(vx, vy), 1e-6)
        const push = (lineClearance - segmentDistance + 0.8) * (isIncident ? 0.42 : 0.66)
        deltas[entryIndex][0] += (vx / norm) * push
        deltas[entryIndex][1] += (vy / norm) * push
      }

      for (let i = 0; i < positions.length; i += 1) {
        if (i === entry.stationIndex) continue
        const point = positions[i]
        const dist = distancePointToRect(point[0], point[1], box)
        if (dist >= minStationDistanceToLabel) continue
        const vx = center.x - point[0]
        const vy = center.y - point[1]
        const norm = Math.max(Math.hypot(vx, vy), 1e-6)
        const push = (minStationDistanceToLabel - dist + 0.6) * 0.72
        deltas[entryIndex][0] += (vx / norm) * push
        deltas[entryIndex][1] += (vy / norm) * push
      }
    }

    let maxMove = 0
    const cooling = 1 - (iteration / Math.max(1, iterations)) * 0.6

    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i]
      deltas[i][0] += (entry.baseDx - entry.dx) * anchorTether
      deltas[i][1] += (entry.baseDy - entry.dy) * anchorTether

      const moveX = clamp(deltas[i][0] * stepBase * cooling, -maxMovePerIter, maxMovePerIter)
      const moveY = clamp(deltas[i][1] * stepBase * cooling, -maxMovePerIter, maxMovePerIter)

      let nextDx = clamp(entry.dx + moveX, entry.baseDx - maxOffset, entry.baseDx + maxOffset)
      let nextDy = clamp(entry.dy + moveY, entry.baseDy - maxOffset, entry.baseDy + maxOffset)

      if (entry.anchor === 'start') nextDx = Math.max(nextDx, 5.5)
      if (entry.anchor === 'end') nextDx = Math.min(nextDx, -5.5)
      if (entry.anchor === 'middle') nextDx = clamp(nextDx, -18, 18)

      entry.dx = nextDx
      entry.dy = nextDy
      maxMove = Math.max(maxMove, Math.hypot(moveX, moveY))
    }

    if (maxMove < 0.07) break
  }

  const nextLabels = { ...labels }
  for (const entry of entries) {
    nextLabels[entry.stationId] = {
      dx: Number(entry.dx.toFixed(2)),
      dy: Number(entry.dy.toFixed(2)),
      anchor: entry.anchor,
    }
  }
  return nextLabels
}

function estimateLabelWidth(station) {
  const nameZh = station.nameZh || ''
  const nameEn = station.nameEn || ''
  const zhWidth = estimateMixedTextWidth(nameZh, 11.6, 7)
  const enWidth = estimateMixedTextWidth(nameEn, 6.2, 5.6)
  return Math.max(zhWidth, enWidth) + 14
}

function estimateMixedTextWidth(text, cjkWidth, latinWidth) {
  let width = 0
  for (const char of String(text || '')) {
    if (isCjkChar(char)) {
      width += cjkWidth
    } else if (char === ' ') {
      width += latinWidth * 0.55
    } else {
      width += latinWidth
    }
  }
  return width
}

function isCjkChar(char) {
  const code = char?.codePointAt?.(0)
  if (!Number.isFinite(code)) return false
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x20000 && code <= 0x2a6df) ||
    (code >= 0x2a700 && code <= 0x2b73f) ||
    (code >= 0x2b740 && code <= 0x2b81f) ||
    (code >= 0x2b820 && code <= 0x2ceaf) ||
    (code >= 0xf900 && code <= 0xfaff)
  )
}

function buildLabelTemplates(station, config, degree = 0) {
  const hasEnglish = Boolean(station?.nameEn)
  const clearance = Math.max(7, toFiniteNumber(config.labelLineClearance, 9.5))
  const nearVertical = Math.max(hasEnglish ? 18 : 14, clearance + (hasEnglish ? 8 : 6))
  const midVertical = nearVertical + (hasEnglish ? 6 : 4)
  const farVertical = midVertical + (hasEnglish ? 6 : 4)
  const isTerminalLike = degree <= 1
  const templates = [
    { dx: 0, dy: -nearVertical, anchor: 'middle', side: 'N_NEAR' },
    { dx: 0, dy: nearVertical, anchor: 'middle', side: 'S_NEAR' },
    { dx: 14, dy: -nearVertical, anchor: 'start', side: 'E_N_NEAR' },
    { dx: 14, dy: nearVertical, anchor: 'start', side: 'E_S_NEAR' },
    { dx: -14, dy: -nearVertical, anchor: 'end', side: 'W_N_NEAR' },
    { dx: -14, dy: nearVertical, anchor: 'end', side: 'W_S_NEAR' },
    { dx: 0, dy: -midVertical, anchor: 'middle', side: 'N_MID' },
    { dx: 0, dy: midVertical, anchor: 'middle', side: 'S_MID' },
    { dx: 14, dy: -midVertical, anchor: 'start', side: 'E_N_MID' },
    { dx: 14, dy: midVertical, anchor: 'start', side: 'E_S_MID' },
    { dx: -14, dy: -midVertical, anchor: 'end', side: 'W_N_MID' },
    { dx: -14, dy: midVertical, anchor: 'end', side: 'W_S_MID' },
    { dx: 0, dy: -farVertical, anchor: 'middle', side: 'N_FAR' },
    { dx: 0, dy: farVertical, anchor: 'middle', side: 'S_FAR' },
    { dx: 20, dy: -farVertical, anchor: 'start', side: 'E_N_FAR' },
    { dx: 20, dy: farVertical, anchor: 'start', side: 'E_S_FAR' },
    { dx: -20, dy: -farVertical, anchor: 'end', side: 'W_N_FAR' },
    { dx: -20, dy: farVertical, anchor: 'end', side: 'W_S_FAR' },
  ]
  if (isTerminalLike) return templates
  return [
    ...templates.filter((item) => item.anchor !== 'middle' || item.side.includes('FAR') === false),
    ...templates.filter((item) => item.anchor === 'middle'),
  ]
}

function detectStationOrientationBias(segments, stationIndex, point) {
  let horizontalStrength = 0
  let verticalStrength = 0
  let incidentCount = 0
  for (const segment of segments) {
    if (segment.fromIndex !== stationIndex && segment.toIndex !== stationIndex) continue
    const other = segment.fromIndex === stationIndex ? segment.to : segment.from
    const dx = other[0] - point[0]
    const dy = other[1] - point[1]
    horizontalStrength += Math.abs(dx)
    verticalStrength += Math.abs(dy)
    incidentCount += 1
  }
  if (!incidentCount) return 'neutral'
  if (verticalStrength > horizontalStrength * 1.18) return 'vertical'
  if (horizontalStrength > verticalStrength * 1.18) return 'horizontal'
  return 'neutral'
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

function candidateSidePenalty(side, segments, stationIndex, point) {
  let penalty = 0
  const prefersEast = side.includes('E')
  const prefersWest = side.includes('W')
  const prefersNorth = side.includes('N')
  const prefersSouth = side.includes('S')
  const prefersMiddle = !prefersEast && !prefersWest
  let horizontalStrength = 0
  let verticalStrength = 0

  for (const segment of segments) {
    if (segment.fromIndex !== stationIndex && segment.toIndex !== stationIndex) continue
    const other = segment.fromIndex === stationIndex ? segment.to : segment.from
    const dx = other[0] - point[0]
    const dy = other[1] - point[1]
    horizontalStrength += Math.abs(dx)
    verticalStrength += Math.abs(dy)
    if (prefersEast && dx > 0) penalty += 11
    if (prefersWest && dx < 0) penalty += 11
    if (prefersNorth && dy < 0) penalty += 11
    if (prefersSouth && dy > 0) penalty += 11
  }

  if (verticalStrength > horizontalStrength * 1.25) {
    if (prefersEast || prefersWest) penalty += 26
    if (prefersMiddle) penalty -= 12
  } else if (horizontalStrength > verticalStrength * 1.25) {
    if (prefersMiddle) penalty += 8
  }
  return penalty
}


export { computeStationLabelLayout, estimateLabelWidth, buildLabelBox }
