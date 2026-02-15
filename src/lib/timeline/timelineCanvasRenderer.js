/**
 * Geographic canvas renderer for timeline animation.
 *
 * Renders rail network on OSM tile background using real lngLat coordinates.
 * Includes progressive line drawing, station reveal animations, and
 * professional overlay UI (year, stats, events, branding, scale bar).
 *
 * Used by both timelinePreviewRenderer.js and timelineExporter.js.
 */

import { lngLatToPixel, renderTiles, metersPerPixel, selectZoomLevelFractional } from './timelineTileRenderer'
import { slicePolylineByProgress } from './timelineAnimationPlan'
import { haversineDistanceMeters } from '../geo'
import { getDisplayLineName } from '../lineNaming'

// ─── Font loading ───────────────────────────────────────────────

const FONT_FAMILY = '微软雅黑'

let _fontLoadPromise = null

/**
 * Load PingFang Bold from local project file via FontFace API.
 * Registers the font at multiple weights so Canvas ctx.font always matches.
 */
export function loadSourceHanSans(_textHint = '') {
  if (_fontLoadPromise) return _fontLoadPromise
  _fontLoadPromise = (async () => {
    try {
      const resp = await fetch('/PingFang-Bold.ttf')
      if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching font`)
      const buffer = await resp.arrayBuffer()
      console.log(`[timeline] Font fetched: ${buffer.byteLength} bytes`)

      // Font file declares itself as "Regular" weight internally,
      // so register without weight override and use without weight in ctx.font
      const face = new FontFace(FONT_FAMILY, buffer)
      const loaded = await face.load()
      document.fonts.add(loaded)
      console.log('[timeline] PingFang Bold registered')
    } catch (err) {
      console.error('[timeline] Font load failed:', err)
    }
  })()
  return _fontLoadPromise
}

// ─── Geometry / easing helpers ──────────────────────────────────

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3)
}

export function easeOutBack(t) {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

export function easeOutElastic(t) {
  if (t === 0 || t === 1) return t
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1
}

// ─── UI scale helper ────────────────────────────────────────────

function uiScale(width, height) {
  return Math.min(width / 1920, height / 1080)
}

// ─── Geographic camera ──────────────────────────────────────────

/**
 * Compute a geographic camera that fits the given bounds.
 * @param {{ minLng, minLat, maxLng, maxLat }|null} bounds
 * @param {number} width
 * @param {number} height
 * @returns {{ centerLng: number, centerLat: number, zoom: number }}
 */
export function computeGeoCamera(bounds, width, height) {
  if (!bounds) {
    return { centerLng: 116.99, centerLat: 36.65, zoom: 11 }
  }
  const centerLng = (bounds.minLng + bounds.maxLng) / 2
  const centerLat = (bounds.minLat + bounds.maxLat) / 2
  const zoom = selectZoomLevelFractional(bounds, width, height, 0.78)
  return { centerLng, centerLat, zoom }
}

/**
 * Compute camera focused on specific edges' bounding box, zoomed closer.
 */
export function computeFocusCamera(focusBounds, fullBounds, width, height) {
  if (!focusBounds) return computeGeoCamera(fullBounds, width, height)
  // Expand focus bounds slightly for context
  const padLng = Math.max((focusBounds.maxLng - focusBounds.minLng) * 0.3, 0.005)
  const padLat = Math.max((focusBounds.maxLat - focusBounds.minLat) * 0.3, 0.005)
  const expanded = {
    minLng: focusBounds.minLng - padLng,
    minLat: focusBounds.minLat - padLat,
    maxLng: focusBounds.maxLng + padLng,
    maxLat: focusBounds.maxLat + padLat,
  }
  const cam = computeGeoCamera(expanded, width, height)
  // Limit focus zoom: don't zoom in more than 2.5 levels beyond the full-extent zoom,
  // so the camera doesn't jump dramatically when a new line has a small geographic span
  const fullZoom = computeGeoCamera(fullBounds, width, height).zoom
  const maxFocusZoom = fullZoom + 2.5
  cam.zoom = Math.max(9, Math.min(maxFocusZoom, cam.zoom))
  return cam
}

/**
 * Smoothly interpolate between two geographic cameras.
 */
export function lerpGeoCamera(from, to, t) {
  const eased = easeInOutCubic(Math.max(0, Math.min(1, t)))
  return {
    centerLng: from.centerLng + (to.centerLng - from.centerLng) * eased,
    centerLat: from.centerLat + (to.centerLat - from.centerLat) * eased,
    zoom: from.zoom + (to.zoom - from.zoom) * eased,
  }
}

// ─── Stats computation ──────────────────────────────────────────

export function computeStatsForYear(project, year) {
  const edges = (project?.edges || []).filter(e => e.openingYear == null || e.openingYear <= year)
  const stationIds = new Set()
  const lineIds = new Set()
  let totalMeters = 0
  for (const e of edges) {
    stationIds.add(e.fromStationId)
    stationIds.add(e.toStationId)
    for (const lid of e.sharedByLineIds) lineIds.add(lid)
    totalMeters += e.lengthMeters || 0
  }
  return { lines: lineIds.size, stations: stationIds.size, km: totalMeters / 1000 }
}

// ─── Edge rendering (geographic) ────────────────────────────────

/**
 * Compute line width based on zoom level.
 */
function geoLineWidth(zoom) {
  return Math.max(2, 3.5 * Math.pow(2, (zoom - 12) * 0.45))
}

/**
 * Draw a polyline of [lng,lat] points onto the canvas.
 */
function drawGeoPolyline(ctx, points, camera, width, height, color, lineWidth, alpha) {
  if (!points || points.length < 2) return
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.setLineDash([])
  ctx.beginPath()
  const [sx, sy] = lngLatToPixel(points[0][0], points[0][1], camera, width, height)
  ctx.moveTo(sx, sy)
  for (let i = 1; i < points.length; i++) {
    const [px, py] = lngLatToPixel(points[i][0], points[i][1], camera, width, height)
    ctx.lineTo(px, py)
  }
  ctx.stroke()
  ctx.restore()
}

/**
 * Render all previously-completed edges (from prior years) as full lines.
 */
export function renderPrevEdges(ctx, prevEdges, camera, width, height, stationMap, lineMap) {
  const lw = geoLineWidth(camera.zoom)
  for (const edge of prevEdges) {
    const line = lineMap.get((edge.sharedByLineIds || [])[0])
    const color = line?.color || '#2563EB'
    const from = stationMap.get(edge.fromStationId)
    const to = stationMap.get(edge.toStationId)
    if (!from || !to) continue

    // Resolve waypoints inline
    let waypoints = edge._cachedWaypoints
    if (!waypoints) {
      waypoints = resolveWaypointsSimple(edge, from, to)
      edge._cachedWaypoints = waypoints
    }
    if (waypoints.length < 2) continue
    drawGeoPolyline(ctx, waypoints, camera, width, height, color, lw, 0.85)
  }
}

function resolveWaypointsSimple(edge, fromStation, toStation) {
  const from = fromStation?.lngLat
  const to = toStation?.lngLat
  if (!from || !to) return []
  const raw = Array.isArray(edge.waypoints) && edge.waypoints.length >= 2
    ? edge.waypoints.filter(p => Array.isArray(p) && p.length === 2)
    : [from, to]
  if (raw.length < 2) return [from, to]
  // Direction correction
  const dF = (raw[0][0] - from[0]) ** 2 + (raw[0][1] - from[1]) ** 2
  const dR = (raw[0][0] - to[0]) ** 2 + (raw[0][1] - to[1]) ** 2
  const ordered = dR < dF ? [...raw].reverse() : raw
  ordered[0] = from
  ordered[ordered.length - 1] = to
  return ordered
}

/**
 * Render the current year's edges with progressive drawing animation.
 */
export function renderAnimatedEdges(ctx, yearPlan, drawProgress, camera, width, height) {
  const lw = geoLineWidth(camera.zoom)
  for (const plan of yearPlan.lineDrawPlans) {
    for (const seg of plan.segments) {
      // Determine how much of this segment to draw
      const segSpan = seg.endProgress - seg.startProgress
      if (segSpan <= 0) continue
      const segProgress = Math.max(0, Math.min(1, (drawProgress - seg.startProgress) / segSpan))
      if (segProgress <= 0) continue

      const { points: slicedPoints } = slicePolylineByProgress(seg.waypoints, segProgress)
      if (slicedPoints.length < 2) continue
      drawGeoPolyline(ctx, slicedPoints, camera, width, height, plan.color, lw, 1)
    }
  }
}

// ─── Station rendering (geographic) ─────────────────────────────

/**
 * Render stations as circles/interchange markers with full animation support.
 *
 * opts.stationAnimState: Map<stationId, { popT, interchangeT, labelAlpha }>
 *   - popT: 0..1 station pop-in progress (easeOutBack applied externally)
 *   - interchangeT: 0..1 morph from circle to interchange rounded-rect
 *   - labelAlpha: 0..1 label fade-in
 * When stationAnimState is not provided, all stations render at full state (idle mode).
 */
export function renderStations(ctx, stationIds, camera, width, height, stationMap, opts = {}) {
  const alpha = opts.alpha ?? 1
  const zoom = camera.zoom
  const radius = Math.max(2.5, 3.5 * Math.pow(2, (zoom - 12) * 0.35))
  const fontSize = Math.max(8, 11 * Math.pow(2, (zoom - 12) * 0.25))
  const animState = opts.stationAnimState || null

  ctx.save()
  ctx.globalAlpha = alpha

  for (const sid of stationIds) {
    const station = stationMap.get(sid)
    if (!station?.lngLat) continue
    const [px, py] = lngLatToPixel(station.lngLat[0], station.lngLat[1], camera, width, height)

    // Skip if off-screen
    if (px < -50 || px > width + 50 || py < -50 || py > height + 50) continue

    // Animation state for this station
    const anim = animState?.get(sid)
    const popT = anim ? anim.popT : 1
    const interchangeT = anim ? anim.interchangeT : (station.isInterchange ? 1 : 0)
    const labelAlpha = anim ? anim.labelAlpha : 1

    if (popT <= 0) continue // not yet revealed

    // Pop-in: scale from 0 to overshoot then settle
    const scale = popT < 1 ? easeOutBack(popT) : 1
    const stationAlpha = Math.min(1, popT * 2) // fade in during first half of pop

    ctx.save()
    ctx.globalAlpha = alpha * stationAlpha
    ctx.translate(px, py)
    if (scale !== 1) ctx.scale(scale, scale)

    // Morph between circle and interchange rounded-rect
    ctx.beginPath()
    if (interchangeT > 0.01) {
      // Interpolate dimensions: circle (r,r) → interchange (1.4r, 0.9r) rounded rect
      const morphW = radius * (1 + interchangeT * 0.4) // 1r → 1.4r half-width
      const morphH = radius * (1 - interchangeT * 0.1) // 1r → 0.9r half-height
      const morphR = radius * (1 - interchangeT * 0.15) // corner radius shrinks slightly
      if (interchangeT >= 0.99) {
        // Full interchange
        roundRect(ctx, -radius * 1.4, -radius * 0.9, radius * 2.8, radius * 1.8, radius * 0.85)
      } else {
        // Morphing: draw as rounded rect with interpolated dimensions
        roundRect(ctx, -morphW, -morphH, morphW * 2, morphH * 2, morphR)
      }
    } else {
      ctx.arc(0, 0, radius, 0, Math.PI * 2)
    }
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.strokeStyle = interchangeT > 0.5 ? '#334155' : '#1F2937'
    ctx.lineWidth = Math.max(1, radius * 0.42)
    ctx.stroke()

    ctx.restore()

    // Station name (only at sufficient zoom) — with halo to avoid line overlap
    if (zoom >= 11 && opts.showLabels !== false && labelAlpha > 0.01) {
      const labelX = px + radius + 3
      const zhFont = `${fontSize}px 微软雅黑, "Source Han Sans SC", "Microsoft YaHei", sans-serif`
      const zhText = station.nameZh || ''

      ctx.save()
      ctx.globalAlpha = alpha * labelAlpha
      ctx.font = zhFont
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      // White halo
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)'
      ctx.lineWidth = Math.max(2.5, fontSize * 0.28)
      ctx.lineJoin = 'round'
      ctx.strokeText(zhText, labelX, py - fontSize * 0.3)
      ctx.fillStyle = '#1a1a2e'
      ctx.fillText(zhText, labelX, py - fontSize * 0.3)

      if (station.nameEn && zoom >= 12.5) {
        const enFont = `500 ${fontSize * 0.78}px "Roboto Condensed", "Arial Narrow", sans-serif`
        ctx.font = enFont
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.88)'
        ctx.lineWidth = Math.max(2, fontSize * 0.22)
        ctx.strokeText(station.nameEn, labelX, py + fontSize * 0.65)
        ctx.fillStyle = '#7b8794'
        ctx.fillText(station.nameEn, labelX, py + fontSize * 0.65)
      }
      ctx.restore()
    }
  }

  ctx.restore()
}

/**
 * Render stations that are being revealed this year, with fade-in based on drawProgress.
 */
export function renderAnimatedStations(ctx, yearPlan, drawProgress, camera, width, height, stationMap) {
  const zoom = camera.zoom
  const radius = Math.max(2.5, 3.5 * Math.pow(2, (zoom - 12) * 0.35))
  const fontSize = Math.max(8, 11 * Math.pow(2, (zoom - 12) * 0.25))

  for (const plan of yearPlan.lineDrawPlans) {
    for (const reveal of plan.stationReveals) {
      // Station appears when drawProgress reaches its trigger
      const revealT = reveal.triggerProgress
      const fadeProgress = revealT <= 0 ? 1 : Math.max(0, Math.min(1, (drawProgress - revealT + 0.05) / 0.05))
      if (fadeProgress <= 0) continue

      const station = stationMap.get(reveal.stationId)
      if (!station?.lngLat) continue
      const [px, py] = lngLatToPixel(station.lngLat[0], station.lngLat[1], camera, width, height)
      if (px < -50 || px > width + 50 || py < -50 || py > height + 50) continue

      const scale = 0.5 + fadeProgress * 0.5
      const alpha = fadeProgress

      ctx.save()
      ctx.globalAlpha = alpha
      ctx.translate(px, py)
      ctx.scale(scale, scale)

      ctx.beginPath()
      if (station.isInterchange) {
        roundRect(ctx, -radius * 1.4, -radius * 0.9, radius * 2.8, radius * 1.8, radius * 0.85)
      } else {
        ctx.arc(0, 0, radius, 0, Math.PI * 2)
      }
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.strokeStyle = station.isInterchange ? '#334155' : '#1F2937'
      ctx.lineWidth = Math.max(1, radius * 0.42)
      ctx.stroke()

      ctx.restore()

      // Label — with halo to avoid line overlap
      if (zoom >= 11 && fadeProgress > 0.5) {
        const labelX = px + radius + 3
        const labelAlpha = Math.max(0, (fadeProgress - 0.5) * 2)
        ctx.save()
        ctx.globalAlpha = labelAlpha

        const zhFont = `${fontSize}px 微软雅黑, "Source Han Sans SC", "Microsoft YaHei", sans-serif`
        ctx.font = zhFont
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)'
        ctx.lineWidth = Math.max(2.5, fontSize * 0.28)
        ctx.lineJoin = 'round'
        ctx.strokeText(station.nameZh || '', labelX, py - fontSize * 0.3)
        ctx.fillStyle = '#1a1a2e'
        ctx.fillText(station.nameZh || '', labelX, py - fontSize * 0.3)

        if (station.nameEn && zoom >= 12.5) {
          ctx.font = `500 ${fontSize * 0.78}px "Roboto Condensed", "Arial Narrow", sans-serif`
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.88)'
          ctx.lineWidth = Math.max(2, fontSize * 0.22)
          ctx.strokeText(station.nameEn, labelX, py + fontSize * 0.65)
          ctx.fillStyle = '#7b8794'
          ctx.fillText(station.nameEn, labelX, py + fontSize * 0.65)
        }
        ctx.restore()
      }
    }
  }
}

// ─── Overlay: Year + Stats block (bottom-left, reference layout) ─

/**
 * Render year + stats overlay at bottom-left.
 *
 * opts.stats: { km, stations, lines }
 * opts.yearTransition: 0..1 — year change animation (0 = just changed, 1 = settled)
 * opts.prevYear: previous year label (for crossfade)
 * opts.displayStats: { km, stations } — animated (counting-up) display values
 */
export function renderOverlayYear(ctx, year, alpha, width, height, opts = {}) {
  if (alpha <= 0 || year == null) return
  const { yearTransition = 1, prevYear } = opts
  const s = uiScale(width, height)
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha))

  // ── Measure year text ──
  const yearFontSize = 120 * s
  const yearFont = `900 ${yearFontSize}px "DIN Alternate", "Bahnschrift", "Roboto Condensed", monospace`
  ctx.font = yearFont
  const yearStr = String(year)
  const yearTextW = ctx.measureText(yearStr).width

  // ── Layout: dark rounded rect containing only year ──
  const padH = 28 * s
  const padV = 18 * s
  const rectW = yearTextW + padH * 2
  const rectH = yearFontSize * 1.1 + padV * 2
  const rectX = 48 * s
  const rectY = height - rectH - 48 * s
  const cornerR = 14 * s

  // Semi-transparent dark background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
  roundRect(ctx, rectX, rectY, rectW, rectH, cornerR)
  ctx.fill()

  // ── Year text with crossfade transition ──
  const yearCenterY = rectY + rectH / 2
  const yearX = rectX + padH

  if (yearTransition < 1 && prevYear != null) {
    // Outgoing year: slide up + fade out
    const outT = easeOutCubic(yearTransition)
    const outAlpha = 1 - outT
    const outOffsetY = -yearFontSize * 0.3 * outT
    ctx.save()
    ctx.globalAlpha = alpha * outAlpha
    ctx.fillStyle = '#ffffff'
    ctx.font = yearFont
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(prevYear), yearX, yearCenterY + outOffsetY)
    ctx.restore()

    // Incoming year: slide up from below + fade in
    const inAlpha = outT
    const inOffsetY = yearFontSize * 0.3 * (1 - outT)
    ctx.save()
    ctx.globalAlpha = alpha * inAlpha
    ctx.fillStyle = '#ffffff'
    ctx.font = yearFont
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(yearStr, yearX, yearCenterY + inOffsetY)
    ctx.restore()
  } else {
    ctx.fillStyle = '#ffffff'
    ctx.font = yearFont
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(yearStr, yearX, yearCenterY)
  }

  ctx.restore()
}

// ─── Overlay: Stats pills (left side, below year) ───────────────

export function renderOverlayStats(ctx, stats, alpha, width, height) {
  if (alpha <= 0 || !stats) return
  const s = uiScale(width, height)
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha))

  const baseX = 48 * s
  const baseY = height * 0.52 + 80 * s  // below the large year

  const pillH = 36 * s
  const pillR = pillH / 2
  const gap = 12 * s

  // KM pill
  const kmText = `${stats.km.toFixed(1)} KM`
  const stText = `${stats.stations} ST.`

  drawStatPill(ctx, baseX, baseY, pillH, pillR, s, kmText)
  const kmWidth = measurePillWidth(ctx, kmText, s, pillH)
  drawStatPill(ctx, baseX + kmWidth + gap, baseY, pillH, pillR, s, stText)

  ctx.restore()
}

function measurePillWidth(ctx, text, s, pillH) {
  ctx.font = `700 ${16 * s}px "DIN Alternate", "Bahnschrift", "Roboto Condensed", monospace`
  const tw = ctx.measureText(text).width
  return tw + pillH  // padding = pillH/2 on each side
}

function drawStatPill(ctx, x, y, h, r, s, text) {
  ctx.font = `700 ${16 * s}px "DIN Alternate", "Bahnschrift", "Roboto Condensed", monospace`
  const tw = ctx.measureText(text).width
  const w = tw + h  // padding = h/2 on each side

  // Pill background
  ctx.fillStyle = 'rgba(255, 255, 255, 0.15)'
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
  ctx.lineWidth = 1.2 * s
  roundRect(ctx, x, y, w, h, r)
  ctx.fill()
  ctx.stroke()

  // Text
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + w / 2, y + h / 2)
}

// ─── Overlay: Event banner (top-left) ───────────────────────────
// Shows: [color swatch] 线路名 开通运营 (+XX.Xkm) \n English name
// Slides in from left when appearing.
//
// opts.slideT: 0..1 — slide-in progress (0 = off-screen left, 1 = fully visible)

export function renderOverlayEvent(ctx, text, lineColor, alpha, width, height, opts = {}) {
  if (alpha <= 0) return
  const { nameZh, nameEn, deltaKm, slideT = 1 } = opts
  const s = uiScale(width, height)

  const swatchW = 8 * s
  const padH = 28 * s
  const lineGap = 18 * s

  // Build main text: either custom event text, or "线路名 开通运营 (+km)"
  let mainText = text || ''
  if (!mainText && nameZh) {
    mainText = `${nameZh} 开通运营`
    if (deltaKm != null && deltaKm > 0) {
      mainText += ` (+${deltaKm.toFixed(1)}km)`
    }
  }
  if (!mainText) return

  const mainFont = `${30 * s}px 微软雅黑, "Source Han Sans SC", "Microsoft YaHei", sans-serif`
  const subFont = `500 ${20 * s}px "Roboto Condensed", "Arial Narrow", sans-serif`

  ctx.font = mainFont
  const mainW = ctx.measureText(mainText).width

  let subText = nameEn || ''
  let subW = 0
  if (subText) {
    ctx.font = subFont
    subW = ctx.measureText(subText).width
  }

  const contentW = Math.max(mainW, subW)
  const bannerW = swatchW + contentW + padH * 2 + lineGap
  const bannerH = subText ? (96 * s) : (72 * s)

  // Slide-in animation: translate from left
  const easedSlide = easeOutCubic(Math.max(0, Math.min(1, slideT)))
  const slideOffset = -(bannerW + 24 * s) * (1 - easedSlide)
  const slideAlpha = easedSlide

  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha * slideAlpha))

  // Position: pinned to top-left corner
  const bannerX = 24 * s + slideOffset
  const bannerY = 24 * s

  // Semi-transparent dark background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.40)'
  roundRect(ctx, bannerX, bannerY, bannerW, bannerH, 14 * s)
  ctx.fill()

  // Line color swatch (vertical bar on left)
  const swatchX = bannerX + padH * 0.5
  const swatchPadV = 14 * s
  ctx.fillStyle = lineColor || '#2563EB'
  roundRect(ctx, swatchX, bannerY + swatchPadV, swatchW, bannerH - swatchPadV * 2, 4 * s)
  ctx.fill()

  // Main text — white on dark
  const textX = swatchX + swatchW + lineGap
  ctx.fillStyle = '#ffffff'
  ctx.font = mainFont
  ctx.textAlign = 'left'
  if (subText) {
    ctx.textBaseline = 'bottom'
    ctx.fillText(mainText, textX, bannerY + bannerH * 0.52)
    // English subtitle
    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)'
    ctx.font = subFont
    ctx.textBaseline = 'top'
    ctx.fillText(subText, textX, bannerY + bannerH * 0.56)
  } else {
    ctx.textBaseline = 'middle'
    ctx.fillText(mainText, textX, bannerY + bannerH / 2)
  }

  ctx.restore()
}

// ─── Overlay: Scale bar (bottom-left) ────────────────────────────

export function renderOverlayScaleBar(ctx, camera, alpha, width, height) {
  if (alpha <= 0) return
  const s = uiScale(width, height)
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha)) * 0.7

  const mpp = metersPerPixel(camera.centerLat, camera.zoom)
  // Choose a nice round distance
  const candidates = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000]
  let targetMeters = 1000
  for (const c of candidates) {
    const px = c / mpp
    if (px >= 40 * s && px <= 160 * s) {
      targetMeters = c
      break
    }
  }
  const barPx = targetMeters / mpp
  const label = targetMeters >= 1000 ? `${targetMeters / 1000} KM` : `${targetMeters} M`

  const x = 48 * s
  const y = height - 36 * s
  const barH = 3 * s

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(x, y, barPx, barH)
  // End ticks
  ctx.fillRect(x, y - 4 * s, 1.5 * s, barH + 8 * s)
  ctx.fillRect(x + barPx - 1.5 * s, y - 4 * s, 1.5 * s, barH + 8 * s)

  ctx.fillStyle = '#ffffff'
  ctx.font = `500 ${10 * s}px "Roboto Condensed", "Arial Narrow", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText(label, x + barPx / 2, y - 5 * s)

  ctx.restore()
}

// ─── Overlay: Branding (bottom-right, minimal) ──────────────────

/**
 * Render a glowing dot at the drawing tip to highlight where the line is being drawn.
 */
export function renderTipGlow(ctx, tipLng, tipLat, camera, width, height, color, pulseT) {
  if (tipLng == null || tipLat == null) return
  const [px, py] = lngLatToPixel(tipLng, tipLat, camera, width, height)
  if (px < -100 || px > width + 100 || py < -100 || py > height + 100) return

  const zoom = camera.zoom
  const baseRadius = Math.max(4, 6 * Math.pow(2, (zoom - 12) * 0.35))

  // Pulsing glow: oscillates between 0.6 and 1.0
  const pulse = 0.6 + 0.4 * Math.sin(pulseT * Math.PI * 2)

  ctx.save()

  // Outer glow (large, soft)
  const outerR = baseRadius * 3 * pulse
  const gradient = ctx.createRadialGradient(px, py, 0, px, py, outerR)
  gradient.addColorStop(0, color + '80') // 50% alpha at center
  gradient.addColorStop(0.4, color + '30') // 19% alpha
  gradient.addColorStop(1, color + '00') // transparent
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(px, py, outerR, 0, Math.PI * 2)
  ctx.fill()

  // Inner bright dot
  const innerR = baseRadius * 0.8
  ctx.fillStyle = '#ffffff'
  ctx.globalAlpha = 0.9
  ctx.beginPath()
  ctx.arc(px, py, innerR, 0, Math.PI * 2)
  ctx.fill()

  // Color ring
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(1.5, baseRadius * 0.35)
  ctx.globalAlpha = 0.8 * pulse
  ctx.beginPath()
  ctx.arc(px, py, baseRadius * 1.2, 0, Math.PI * 2)
  ctx.stroke()

  ctx.restore()
}

export function renderOverlayBranding(ctx, projectName, author, alpha, width, height) {
  if (alpha <= 0) return
  const s = uiScale(width, height)
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha)) * 0.5

  const x = width - 48 * s
  const y = height - 16 * s

  // OSM attribution only — no logo
  ctx.fillStyle = '#ffffff'
  ctx.font = `400 ${9 * s}px "Roboto Condensed", sans-serif`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  ctx.fillText('© OpenStreetMap contributors', x, y)

  ctx.restore()
}

// ─── Overlay: Line legend (bottom-left, above year block) ────────
// Each line is an independent colored rounded rect card with line name,
// and KM/ST stats stacked vertically to the right of the card.
// Positioned above the year+stats block at bottom-left.
//
// opts.displayLineStats: Map<lineId, { km, stations }> — animated counting-up values

export function renderOverlayLineInfo(ctx, yearPlan, stats, alpha, width, height, opts = {}) {
  if (alpha <= 0) return
  const { cumulativeLineStats, lineAppearProgress, displayLineStats, displayStats } = opts
  const lineEntries = cumulativeLineStats || []
  if (!lineEntries.length) return

  const s = uiScale(width, height)

  // ── Stats pills (between line cards and year block) ──
  const pillFontSize = 16 * s
  const pillFont = `700 ${pillFontSize}px "DIN Alternate", "Bahnschrift", "Roboto Condensed", monospace`
  const pillH = 32 * s
  const pillR = pillH / 2
  const pillGap = 10 * s
  const showStats = displayStats || stats
  let kmPillW = 0, stPillW = 0, kmText = '', stText = ''
  const hasPills = !!showStats
  if (showStats) {
    kmText = `${showStats.km.toFixed(1)} KM`
    stText = `${showStats.stations} ST.`
    ctx.font = pillFont
    kmPillW = ctx.measureText(kmText).width + pillH
    stPillW = ctx.measureText(stText).width + pillH
  }

  // Year block geometry
  const yearBlockH = 120 * s * 1.1 + 36 * s
  const yearBlockBottom = height - 48 * s
  const yearBlockTop = yearBlockBottom - yearBlockH

  const gapBetween = 10 * s
  const pillsRowH = hasPills ? pillH : 0
  const pillsRowTop = yearBlockTop - gapBetween - pillsRowH
  const baseX = 48 * s
  const cornerR = 14 * s

  // ── Determine layout mode: single-column vs multi-column with auto-scale ──
  // Available vertical space for cards (from top margin to pills/year block)
  const topMargin = 24 * s
  const availableH = pillsRowTop - gapBetween - topMargin

  // Base dimensions at scale 1.0
  const BASE_CARD_H = 52 * s
  const BASE_CARD_PAD_H = 22 * s
  const BASE_CARD_GAP = 10 * s
  const BASE_NAME_FONT_SIZE = 24 * s
  const BASE_STAT_FONT_SIZE = 14 * s
  const BASE_STAT_GAP = 14 * s
  const MIN_SCALE = 0.7

  // Layout: force two columns at 10+ lines, otherwise use height-based logic
  const count = lineEntries.length
  const MULTI_COL_THRESHOLD = 10
  const singleColH = count * (BASE_CARD_H + BASE_CARD_GAP) - BASE_CARD_GAP
  let columns = count >= MULTI_COL_THRESHOLD ? 2 : 1
  let cardScale = 1

  if (columns === 1 && singleColH > availableH) {
    // Try shrinking single column (down to MIN_SCALE)
    const minSingleH = count * (BASE_CARD_H * MIN_SCALE + BASE_CARD_GAP * MIN_SCALE) - BASE_CARD_GAP * MIN_SCALE
    if (minSingleH <= availableH) {
      cardScale = Math.max(MIN_SCALE, availableH / singleColH)
    } else {
      columns = 2
    }
  }

  if (columns === 2) {
    const perCol = Math.ceil(count / 2)
    const twoColH = perCol * (BASE_CARD_H + BASE_CARD_GAP) - BASE_CARD_GAP
    if (twoColH > availableH) {
      cardScale = Math.max(MIN_SCALE, availableH / twoColH)
    }
  }

  const multiCol = columns > 0 && columns >= 2
  const cardH = BASE_CARD_H * cardScale
  const cardPadH = BASE_CARD_PAD_H * cardScale
  const cardGap = BASE_CARD_GAP * cardScale
  const nameFontSize = BASE_NAME_FONT_SIZE * cardScale
  const statFontSize = BASE_STAT_FONT_SIZE * cardScale
  const statGap = BASE_STAT_GAP * cardScale
  const scaledCornerR = cornerR * cardScale

  const nameFont = `${nameFontSize}px 微软雅黑, "Source Han Sans SC", "Microsoft YaHei", sans-serif`
  const statFont = `600 ${statFontSize}px "DIN Alternate", "Bahnschrift", "Roboto Condensed", monospace`

  // Build card data with display names
  const cards = []
  for (const entry of lineEntries) {
    // In multi-column mode, abbreviate: keep leading digits, or first char if non-digit
    let displayName = entry.name
    if (multiCol) {
      const digitMatch = entry.name.match(/^\d+/)
      displayName = digitMatch ? digitMatch[0] : [...entry.name][0]
    }
    ctx.font = nameFont
    const textW = ctx.measureText(displayName).width
    const cardW = textW + cardPadH * 2
    cards.push({ ...entry, displayName, cardW })
  }

  // Compute per-column layout
  const perCol = columns >= 2 ? Math.ceil(cards.length / 2) : cards.length
  const totalCardsH = perCol * (cardH + cardGap) - cardGap
  const baseY = pillsRowTop - gapBetween - totalCardsH

  // Column gap for multi-column
  const colGap = 8 * s

  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha))

  // ── Draw stats pills ──
  if (hasPills) {
    const pillBaseY = pillsRowTop

    const pillsTotalW = kmPillW + pillGap + stPillW
    const bgPadH = 12 * s
    const bgPadV = 8 * s
    const bgX = baseX
    const bgY = pillBaseY - bgPadV
    const bgW = pillsTotalW + bgPadH * 2
    const bgH = pillH + bgPadV * 2
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
    roundRect(ctx, bgX, bgY, bgW, bgH, 14 * s)
    ctx.fill()

    const pillBaseX = baseX + bgPadH

    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)'
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
    ctx.lineWidth = 1.2 * s
    roundRect(ctx, pillBaseX, pillBaseY, kmPillW, pillH, pillR)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = '#ffffff'
    ctx.font = pillFont
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(kmText, pillBaseX + kmPillW / 2, pillBaseY + pillH / 2)

    const stPillX = pillBaseX + kmPillW + pillGap
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)'
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
    ctx.lineWidth = 1.2 * s
    roundRect(ctx, stPillX, pillBaseY, stPillW, pillH, pillR)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = '#ffffff'
    ctx.font = pillFont
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(stText, stPillX + stPillW / 2, pillBaseY + pillH / 2)
  }

  // ── Draw line cards ──
  // In multi-column mode, find the max card width of column 0 to position column 1
  let col0MaxW = 0
  if (multiCol) {
    for (let i = 0; i < Math.min(perCol, cards.length); i++) {
      col0MaxW = Math.max(col0MaxW, cards[i].cardW)
    }
  }

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]
    const col = multiCol ? (i < perCol ? 0 : 1) : 0
    const row = multiCol ? (col === 0 ? i : i - perCol) : i
    const cardY = baseY + row * (cardH + cardGap)
    const cardX = col === 0 ? baseX : baseX + col0MaxW + colGap

    // Per-card slide-in animation
    let progress = 1
    if (lineAppearProgress && lineAppearProgress.has(card.lineId)) {
      progress = lineAppearProgress.get(card.lineId)
    }

    const translateX = -(1 - progress) * (card.cardW + cardPadH)
    const cardAlpha = progress

    ctx.save()
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha * cardAlpha))
    ctx.translate(translateX, 0)

    // Card background = line color
    ctx.fillStyle = card.color || '#2563EB'
    roundRect(ctx, cardX, cardY, card.cardW, cardH, scaledCornerR)
    ctx.fill()

    // White line name text
    ctx.fillStyle = '#ffffff'
    ctx.font = nameFont
    if (i === 0 && !renderOverlayLineInfo._logged) {
      renderOverlayLineInfo._logged = true
      console.log('[timeline][CARD] nameFont:', JSON.stringify(nameFont))
      console.log('[timeline][CARD] ctx.font:', JSON.stringify(ctx.font))
      // Also try direct set
      ctx.font = '32px 微软雅黑'
      console.log('[timeline][CARD] direct 32px:', JSON.stringify(ctx.font))
      ctx.font = nameFont // restore
    }
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(card.displayName, cardX + cardPadH, cardY + cardH / 2)

    // KM and ST stats — only in single-column mode
    if (!multiCol) {
      const dispStats = displayLineStats?.get(card.lineId)
      const dispKm = dispStats ? dispStats.km : card.km
      const dispSt = dispStats ? dispStats.stations : card.stations

      const statX = cardX + card.cardW + statGap
      ctx.font = statFont
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(`${dispKm.toFixed(1)} km`, statX, cardY + 5 * s * cardScale)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
      ctx.fillText(`${dispSt} st.`, statX, cardY + cardH / 2 + 3 * s * cardScale)
    }

    ctx.restore()
  }

  ctx.restore()
}
