/**
 * Timeline exporter — renders timeline animation to video (WebM).
 *
 * Reuses the same continuous rendering pipeline as TimelinePreviewEngine:
 * tip-tracking camera, continuous plan, line cards, event banners, etc.
 */

import { TileCache, renderTiles, lngLatToPixel } from './timelineTileRenderer'
import { buildTimelineAnimationPlan, slicePolylineByProgress } from './timelineAnimationPlan'
import {
  computeGeoCamera,
  easeOutCubic,
  loadSourceHanSans,
  renderOverlayBranding,
  renderOverlayEvent,
  renderOverlayLineInfo,
  renderOverlayYear,
  renderStations,
} from './timelineCanvasRenderer'
import { collectBounds, buildContinuousPlan } from './timelinePreviewBounds'
import { isTrial } from '../../composables/useLicense'

const RESOLUTION_PRESETS = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '2k': { width: 2560, height: 1440 },
  '4k': { width: 3840, height: 2160 },
}

const DEFAULT_FPS = 30
const MS_PER_FRAME = 1000 / DEFAULT_FPS
const MS_PER_KM = 1600
const MIN_TOTAL_DRAW_MS = 3000
const MAX_TOTAL_DRAW_MS = 300000
const CAMERA_SMOOTH_HALF_LIFE = 800
const ZOOM_OFFSET = 2.5
const OUTRO_HOLD_LAST_MS = 1500
const OUTRO_ZOOM_OUT_MS = 2000
const OUTRO_HOLD_FULL_MS = 2000
const LINE_PAUSE_MS = 1200
const CAM_TRAVEL_MS = 800

export function getResolutionPresets() {
  return { ...RESOLUTION_PRESETS }
}

export async function exportTimelineVideo(project, options = {}) {
  const {
    resolution = '1080p',
    format = 'webm',
    title = project?.name || 'Metro Studio',
    author = '',
    onProgress,
    signal,
  } = options

  const effectiveRes = isTrial.value ? '720p' : resolution
  const { width, height } = RESOLUTION_PRESETS[effectiveRes] || RESOLUTION_PRESETS['1080p']

  // ── Build data ──
  const yearSet = new Set()
  for (const edge of project?.edges || []) {
    if (edge.openingYear != null) yearSet.add(edge.openingYear)
  }
  const years = [...yearSet].sort((a, b) => a - b)
  if (!years.length) throw new Error('没有标记年份的线段，无法导出时间轴动画')

  const eventMap = new Map()
  for (const evt of project?.timelineEvents || []) {
    eventMap.set(evt.year, evt.description)
  }

  const stationMap = new Map((project?.stations || []).map(s => [s.id, s]))
  const lineMap = new Map((project?.lines || []).map(l => [l.id, l]))
  const fullBounds = collectBounds(project)
  const animationPlan = buildTimelineAnimationPlan(project)
  const continuousPlan = buildContinuousPlan(animationPlan, years)
  const fullCamera = computeGeoCamera(fullBounds, width, height)

  const totalKm = (continuousPlan.totalLengthMeters || 0) / 1000
  const totalDrawMs = Math.max(MIN_TOTAL_DRAW_MS, Math.min(MAX_TOTAL_DRAW_MS, totalKm * MS_PER_KM))

  // ── Prefetch tiles ──
  const tileCache = new TileCache()
  await prefetchAllTiles(tileCache, continuousPlan, fullBounds, fullCamera, width, height)

  // Load fonts
  const textParts = []
  for (const s of project?.stations || []) { if (s.nameZh) textParts.push(s.nameZh) }
  for (const l of project?.lines || []) { if (l.nameZh) textParts.push(l.nameZh) }
  for (const evt of project?.timelineEvents || []) { if (evt.description) textParts.push(evt.description) }
  await loadSourceHanSans(textParts.join(''))

  // ── Set up recording ──
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')

  const mimeType = format === 'webm' ? 'video/webm;codecs=vp9' : 'video/webm'
  let recorder, chunks = [], fallbackCanvas = null
  const stream = canvas.captureStream?.(DEFAULT_FPS)

  if (!stream) {
    fallbackCanvas = document.createElement('canvas')
    fallbackCanvas.width = width
    fallbackCanvas.height = height
    const fallbackStream = fallbackCanvas.captureStream(DEFAULT_FPS)
    recorder = new MediaRecorder(fallbackStream, {
      mimeType: MediaRecorder.isTypeSupported(mimeType) ? mimeType : 'video/webm',
      videoBitsPerSecond: resolution === '4k' ? 20_000_000 : resolution === '2k' ? 12_000_000 : 8_000_000,
    })
  } else {
    recorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported(mimeType) ? mimeType : 'video/webm',
      videoBitsPerSecond: resolution === '4k' ? 20_000_000 : resolution === '2k' ? 12_000_000 : 8_000_000,
    })
  }

  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
  const recordingDone = new Promise((resolve, reject) => {
    recorder.onstop = () => resolve()
    recorder.onerror = (e) => reject(e.error || new Error('录制失败'))
  })
  recorder.start()

  // ── Animation state ──
  const state = createAnimState(fullCamera, continuousPlan, project, years, eventMap, lineMap, stationMap)

  // ── Main render loop ──
  // Phase 1: draw (simulated time drives globalProgress 0→1, with line pauses)
  // Phase 2: outro (holdLast → zoomOut → holdFull)
  let simTime = 0
  let phase = 'draw' // 'draw' | 'holdLast' | 'zoomOut' | 'holdFull'
  let phaseStart = 0
  let drawPhaseStart = 0
  let frameIndex = 0

  while (phase !== 'done') {
    if (signal?.aborted) { recorder.stop(); throw new Error('导出已取消') }

    if (phase === 'draw') {
      const drawElapsed = simTime - drawPhaseStart - state.pauseAccum
      const rawProgress = Math.min(1, drawElapsed / totalDrawMs)

      // Detect line change and accumulate pause time
      handleLinePause(state, rawProgress, simTime)

      const progress = Math.min(1, (simTime - drawPhaseStart - state.pauseAccum) / totalDrawMs)
      renderExportFrame(ctx, progress, simTime, state, width, height, tileCache, title, author)

      if (progress >= 1) {
        phase = 'holdLast'
        phaseStart = simTime
      }
    } else if (phase === 'holdLast') {
      renderExportFrame(ctx, 1, simTime, state, width, height, tileCache, title, author)
      if (simTime - phaseStart >= OUTRO_HOLD_LAST_MS) {
        phase = 'zoomOut'
        phaseStart = simTime
        state.outroCamFrom = { ...state.smoothCamera }
      }
    } else if (phase === 'zoomOut') {
      const t = Math.min(1, (simTime - phaseStart) / OUTRO_ZOOM_OUT_MS)
      const ease = t * t * (3 - 2 * t)
      state.camera = state.smoothCamera = {
        centerLng: state.outroCamFrom.centerLng + (fullCamera.centerLng - state.outroCamFrom.centerLng) * ease,
        centerLat: state.outroCamFrom.centerLat + (fullCamera.centerLat - state.outroCamFrom.centerLat) * ease,
        zoom: state.outroCamFrom.zoom + (fullCamera.zoom - state.outroCamFrom.zoom) * ease,
      }
      renderExportFrame(ctx, 1, simTime, state, width, height, tileCache, title, author)
      if (t >= 1) { phase = 'holdFull'; phaseStart = simTime }
    } else if (phase === 'holdFull') {
      renderExportFrame(ctx, 1, simTime, state, width, height, tileCache, title, author)
      if (simTime - phaseStart >= OUTRO_HOLD_FULL_MS) phase = 'done'
    }

    // Copy to fallback if needed
    if (fallbackCanvas) {
      const fallbackCtx = fallbackCanvas.getContext('2d')
      const bitmap = canvas.transferToImageBitmap()
      fallbackCtx.drawImage(bitmap, 0, 0)
      bitmap.close()
    }

    simTime += MS_PER_FRAME
    frameIndex++
    if (frameIndex % 5 === 0) await new Promise(r => setTimeout(r, 0))

    const totalEstFrames = (totalDrawMs + state.pauseAccum + OUTRO_HOLD_LAST_MS + OUTRO_ZOOM_OUT_MS + OUTRO_HOLD_FULL_MS) / MS_PER_FRAME
    onProgress?.(Math.min(0.99, frameIndex / totalEstFrames))
  }

  recorder.stop()
  await recordingDone
  tileCache.clear()
  onProgress?.(1)
  return new Blob(chunks, { type: recorder.mimeType })
}

// ── State factory ──

function createAnimState(fullCamera, continuousPlan, project, years, eventMap, lineMap, stationMap) {
  return {
    fullCamera,
    continuousPlan,
    project,
    years,
    eventMap,
    lineMap,
    stationMap,
    camera: { ...fullCamera },
    smoothCamera: null,
    lastFrameTime: 0,
    stationAnimState: new Map(),
    prevYearLabel: null,
    yearTransitionT: 1,
    yearTransitionStart: 0,
    bannerSlideT: 0,
    bannerSlideYear: null,
    lineFirstSeen: new Map(),
    displayStats: null,
    displayLineStats: new Map(),
    // Line pause
    pauseAccum: 0,
    pauseLastLineId: null,
    outroCamFrom: null,
  }
}

// ── Line pause detection ──

function handleLinePause(state, rawProgress, simTime) {
  const cp = state.continuousPlan
  if (!cp?.segments?.length) return

  let curLineId = null
  for (const seg of cp.segments) {
    if (seg.globalStart > rawProgress) break
    curLineId = seg.lineId
  }

  if (curLineId && state.pauseLastLineId && curLineId !== state.pauseLastLineId) {
    state.pauseAccum += LINE_PAUSE_MS + CAM_TRAVEL_MS
  }
  state.pauseLastLineId = curLineId
}

// ── Tip-tracking camera ──

function computeTipCamera(continuousPlan, fullCamera, globalProgress) {
  const cp = continuousPlan
  if (!cp?.segments?.length) return fullCamera

  let tipLng = null, tipLat = null
  for (const seg of cp.segments) {
    if (seg.globalStart >= globalProgress) break
    const pts = seg.waypoints
    if (!pts || pts.length < 2) continue
    const segSpan = seg.globalEnd - seg.globalStart
    if (segSpan <= 0) continue
    const localEnd = Math.min(1, (globalProgress - seg.globalStart) / segSpan)
    const idx = Math.min(Math.floor(localEnd * (pts.length - 1)), pts.length - 2)
    const frac = localEnd * (pts.length - 1) - idx
    tipLng = pts[idx][0] + (pts[idx + 1][0] - pts[idx][0]) * frac
    tipLat = pts[idx][1] + (pts[idx + 1][1] - pts[idx][1]) * frac
  }

  if (tipLng == null) return fullCamera
  return { centerLng: tipLng, centerLat: tipLat, zoom: fullCamera.zoom + ZOOM_OFFSET }
}

function updateSmoothCamera(state, globalProgress, simTime) {
  const target = computeTipCamera(state.continuousPlan, state.fullCamera, globalProgress)

  if (!state.smoothCamera || !state.lastFrameTime) {
    state.smoothCamera = { ...target }
    state.lastFrameTime = simTime
    state.camera = state.smoothCamera
    return
  }

  const dt = Math.min(simTime - state.lastFrameTime, 100)
  state.lastFrameTime = simTime
  const t = 1 - Math.pow(2, -dt / CAMERA_SMOOTH_HALF_LIFE)

  state.smoothCamera = {
    centerLng: state.smoothCamera.centerLng + (target.centerLng - state.smoothCamera.centerLng) * t,
    centerLat: state.smoothCamera.centerLat + (target.centerLat - state.smoothCamera.centerLat) * t,
    zoom: state.smoothCamera.zoom + (target.zoom - state.smoothCamera.zoom) * t,
  }
  state.camera = state.smoothCamera
}

// ── Year helpers ──

function findCurrentYear(continuousPlan, globalProgress) {
  if (!continuousPlan?.yearMarkers?.length) return { year: null, index: 0 }
  let idx = 0
  for (let i = continuousPlan.yearMarkers.length - 1; i >= 0; i--) {
    if (globalProgress >= continuousPlan.yearMarkers[i].globalStart) { idx = i; break }
  }
  return { year: continuousPlan.yearMarkers[idx].year, index: idx }
}

function getCurrentYearLineInfo(continuousPlan, yearMarkerIndex, globalProgress) {
  if (!continuousPlan?.yearMarkers?.length) return null
  const marker = continuousPlan.yearMarkers[yearMarkerIndex]
  const yp = marker?.yearPlan
  if (!yp?.lineDrawPlans?.length) return null

  let activeLp = yp.lineDrawPlans[0]
  if (globalProgress != null) {
    for (const seg of continuousPlan.segments) {
      if (seg.globalStart > globalProgress) break
      if (seg.year === marker.year) activeLp = yp.lineDrawPlans.find(lp => lp.lineId === seg.lineId) || activeLp
    }
  }

  let totalNewKm = 0
  for (const lp of yp.lineDrawPlans) totalNewKm += (lp.totalLength || 0) / 1000

  return {
    nameZh: activeLp.nameZh || '',
    nameEn: activeLp.nameEn || '',
    color: activeLp.color || '#2563EB',
    phase: activeLp.phase || '',
    deltaKm: totalNewKm,
    activeLineId: activeLp.lineId,
  }
}

// ── Live line stats ──

function computeLiveLineStats(state, globalProgress) {
  const cp = state.continuousPlan
  if (!cp?.segments?.length) return []
  const totalM = cp.totalLengthMeters
  const lineKm = new Map(), lineStations = new Map(), lineInfo = new Map()

  for (const seg of cp.segments) {
    if (seg.globalStart >= globalProgress) break
    if (!lineInfo.has(seg.lineId)) {
      lineInfo.set(seg.lineId, { name: seg.nameZh || seg.lineId, color: seg.color || '#2563EB' })
      lineKm.set(seg.lineId, 0)
      lineStations.set(seg.lineId, new Set())
    }
    const segSpan = seg.globalEnd - seg.globalStart
    const segProgress = segSpan > 0 ? Math.min(1, (globalProgress - seg.globalStart) / segSpan) : 1
    const segM = (seg.globalEnd - seg.globalStart) * totalM
    lineKm.set(seg.lineId, lineKm.get(seg.lineId) + segM * segProgress)
    const stSet = lineStations.get(seg.lineId)
    if (segProgress >= 1) { stSet.add(seg.fromStationId); stSet.add(seg.toStationId) }
    else if (segProgress > 0) stSet.add(seg.fromStationId)
  }

  const orderedLineIds = (state.project?.lines || []).map(l => l.id)
  const result = []
  for (const lid of orderedLineIds) {
    if (lineInfo.has(lid)) {
      const info = lineInfo.get(lid)
      result.push({ lineId: lid, name: info.name, color: info.color, km: (lineKm.get(lid) || 0) / 1000, stations: lineStations.get(lid)?.size || 0 })
    }
  }
  return result
}

// ── Main frame renderer ──

function renderExportFrame(ctx, globalProgress, simTime, state, width, height, tileCache, title, author) {
  const cp = state.continuousPlan
  if (!cp?.segments?.length) return

  // Camera
  updateSmoothCamera(state, globalProgress, simTime)
  const camera = state.camera

  // Tiles
  renderTiles(ctx, camera, width, height, tileCache)

  // Draw segments
  const lw = Math.max(2, 3.5 * Math.pow(2, (camera.zoom - 12) * 0.45))
  for (const seg of cp.segments) {
    if (globalProgress <= seg.globalStart) break
    const segSpan = seg.globalEnd - seg.globalStart
    let segProgress = 1
    if (segSpan > 0 && globalProgress < seg.globalEnd) {
      segProgress = Math.max(0, Math.min(1, (globalProgress - seg.globalStart) / segSpan))
    }
    let points = seg.waypoints
    if (segProgress < 1) {
      points = slicePolylineByProgress(seg.waypoints, segProgress).points
    }
    if (points.length >= 2) {
      drawGeoPolyline(ctx, points, camera, width, height, seg.color, lw)
    }
  }

  // Stations
  updateStationAnim(state, globalProgress)
  const revealedIds = new Set()
  for (const reveal of cp.stationReveals) {
    if (globalProgress >= reveal.triggerProgress) revealedIds.add(reveal.stationId)
  }
  renderStations(ctx, revealedIds, camera, width, height, state.stationMap, {
    alpha: 0.9,
    stationAnimState: state.stationAnimState,
  })

  // ── Overlays ──
  const { year, index } = findCurrentYear(cp, globalProgress)
  const yearLabel = year

  // Year transition
  if (yearLabel !== state.prevYearLabel && state.prevYearLabel != null) {
    state.yearTransitionStart = globalProgress
    state.yearTransitionT = 0
  }
  if (state.yearTransitionT < 1) {
    state.yearTransitionT = Math.min(1, (globalProgress - state.yearTransitionStart) / 0.0075)
  }
  const savedPrevYear = (state.yearTransitionT < 1) ? state.prevYearLabel : null
  if (yearLabel !== state.prevYearLabel) state.prevYearLabel = yearLabel

  // Stats
  const cumulativeLineStats = computeLiveLineStats(state, globalProgress)
  const rawStats = cumulativeLineStats.length > 0 ? {
    km: cumulativeLineStats.reduce((s, e) => s + e.km, 0),
    stations: cumulativeLineStats.reduce((s, e) => s + e.stations, 0),
    lines: cumulativeLineStats.length,
  } : null
  if (rawStats) state.displayStats = rawStats

  const overlayAlpha = globalProgress < 0.01 ? globalProgress / 0.01 : globalProgress > 0.99 ? (1 - globalProgress) / 0.01 : 1

  renderOverlayYear(ctx, yearLabel, overlayAlpha, width, height, {
    stats: rawStats,
    displayStats: state.displayStats || rawStats,
    yearTransition: state.yearTransitionT,
    prevYear: savedPrevYear,
  })
  renderOverlayBranding(ctx, title, author, overlayAlpha, width, height)

  // Event banner
  const curMarker = cp.yearMarkers[index]
  if (curMarker) {
    const nextMarker = cp.yearMarkers[index + 1]
    const yearEnd = nextMarker ? nextMarker.globalStart : 1
    const yearSpan = yearEnd - curMarker.globalStart
    const yearLocalT = yearSpan > 0 ? (globalProgress - curMarker.globalStart) / yearSpan : 0

    const eventText = state.eventMap.get(year)
    const lineInfo = getCurrentYearLineInfo(cp, index, globalProgress)
    const bannerKey = `${year}:${lineInfo?.activeLineId}`
    if (state.bannerSlideYear !== bannerKey) {
      state.bannerSlideYear = bannerKey
      state.bannerSlideT = 0
    }
    if (yearLocalT < 0.075) state.bannerSlideT = Math.min(1, yearLocalT / 0.075)
    else if (yearLocalT > 0.925) state.bannerSlideT = Math.max(0, (1 - yearLocalT) / 0.075)
    else state.bannerSlideT = 1

    const lineColor = lineInfo?.color || cp.segments.find(s => s.year === year)?.color || '#2563EB'
    renderOverlayEvent(ctx, eventText || null, lineColor, overlayAlpha, width, height, {
      nameZh: lineInfo?.nameZh || '',
      nameEn: lineInfo?.nameEn || '',
      phase: lineInfo?.phase || '',
      deltaKm: (lineInfo?.activeLineId && cumulativeLineStats.find(e => e.lineId === lineInfo.activeLineId)?.km) || lineInfo?.deltaKm || 0,
      slideT: state.bannerSlideT,
    })
  }

  // Line cards
  if (cumulativeLineStats.length > 0) {
    const lineAppearProgress = computeLineAppearProgress(state, cp, index, globalProgress)
    for (const entry of cumulativeLineStats) {
      if (!state.displayLineStats.has(entry.lineId)) state.displayLineStats.set(entry.lineId, { km: 0, stations: 0 })
      const disp = state.displayLineStats.get(entry.lineId)
      disp.km = entry.km
      disp.stations = entry.stations
    }
    renderOverlayLineInfo(ctx, curMarker?.yearPlan, rawStats, overlayAlpha, width, height, {
      cumulativeLineStats,
      lineAppearProgress,
      displayLineStats: state.displayLineStats,
      displayStats: state.displayStats || rawStats,
    })
  }
}

// ── Station animation state ──

function updateStationAnim(state, globalProgress) {
  const cp = state.continuousPlan
  const stationLineIds = new Map()
  for (const seg of cp.segments) {
    if (globalProgress < seg.globalStart) break
    if (!stationLineIds.has(seg.fromStationId)) stationLineIds.set(seg.fromStationId, new Set())
    stationLineIds.get(seg.fromStationId).add(seg.lineId)
    if (globalProgress >= seg.globalEnd) {
      if (!stationLineIds.has(seg.toStationId)) stationLineIds.set(seg.toStationId, new Set())
      stationLineIds.get(seg.toStationId).add(seg.lineId)
    }
  }

  for (const reveal of cp.stationReveals) {
    if (globalProgress < reveal.triggerProgress) continue
    const sid = reveal.stationId
    const elapsed = globalProgress - reveal.triggerProgress
    if (!state.stationAnimState.has(sid)) {
      state.stationAnimState.set(sid, { popT: 0, interchangeT: 0, labelAlpha: 0, lineCount: 0 })
    }
    const anim = state.stationAnimState.get(sid)
    anim.popT = Math.min(1, elapsed / 0.005)
    const labelElapsed = elapsed - 0.0017
    anim.labelAlpha = labelElapsed > 0 ? Math.min(1, labelElapsed / 0.0033) : 0

    const currentLineCount = stationLineIds.get(sid)?.size || 0
    if (currentLineCount >= 2 && anim.lineCount < 2) anim.interchangeMorphStart = globalProgress
    anim.lineCount = currentLineCount
    if (anim.interchangeMorphStart != null) {
      anim.interchangeT = Math.min(1, (globalProgress - anim.interchangeMorphStart) / 0.004)
    }
  }
}

// ── Line appear progress ──

function computeLineAppearProgress(state, cp, yearIndex, globalProgress) {
  const lineAppearProgress = new Map()
  const APPEAR_SPAN = 0.055
  for (let i = 0; i <= yearIndex && i < cp.yearMarkers.length; i++) {
    const marker = cp.yearMarkers[i]
    for (const lp of marker.yearPlan.lineDrawPlans) {
      if (i < yearIndex) {
        lineAppearProgress.set(lp.lineId, 1)
      } else {
        if (!state.lineFirstSeen.has(lp.lineId)) {
          const firstSeg = cp.segments.find(s => s.lineId === lp.lineId && s.year === marker.year)
          if (firstSeg && globalProgress >= firstSeg.globalStart) state.lineFirstSeen.set(lp.lineId, firstSeg.globalStart)
        }
        const seenAt = state.lineFirstSeen.get(lp.lineId)
        lineAppearProgress.set(lp.lineId, seenAt == null ? 0 : easeOutCubic(Math.min((globalProgress - seenAt) / APPEAR_SPAN, 1)))
      }
    }
  }
  return lineAppearProgress
}

// ── Geo polyline drawing ──

function drawGeoPolyline(ctx, points, camera, width, height, color, lineWidth) {
  if (!points || points.length < 2) return
  ctx.save()
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

// ── Tile prefetching ──

async function prefetchAllTiles(tileCache, continuousPlan, fullBounds, fullCamera, width, height) {
  const promises = []
  const sampleCount = 30
  for (let i = 0; i <= sampleCount; i++) {
    const progress = i / sampleCount
    const cam = computeTipCamera(continuousPlan, fullCamera, progress)
    const z = Math.round(Math.max(0, Math.min(18, cam.zoom)))
    const halfLng = 0.02 * Math.pow(2, 12 - cam.zoom)
    const halfLat = 0.015 * Math.pow(2, 12 - cam.zoom)
    const viewBounds = {
      minLng: cam.centerLng - halfLng, maxLng: cam.centerLng + halfLng,
      minLat: cam.centerLat - halfLat, maxLat: cam.centerLat + halfLat,
    }
    promises.push(tileCache.prefetchForBounds(viewBounds, z))
    if (z > 0) promises.push(tileCache.prefetchForBounds(viewBounds, z - 1))
    if (z < 18) promises.push(tileCache.prefetchForBounds(viewBounds, z + 1))
  }
  if (fullBounds) {
    const baseZoom = Math.round(fullCamera.zoom)
    for (let z = baseZoom; z <= baseZoom + 4; z++) {
      promises.push(tileCache.prefetchForBounds(fullBounds, z))
    }
  }
  await Promise.all(promises)
}
