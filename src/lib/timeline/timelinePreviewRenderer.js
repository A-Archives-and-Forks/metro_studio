/**
 * Real-time timeline preview renderer — geographic edition.
 *
 * Drives live playback on an OSM tile background using real lngLat
 * coordinates with CONTINUOUS line drawing from first station to last.
 *
 * State machine: idle → playing → idle
 *
 * Key design: the animation draws the entire network as one continuous
 * stroke across all years, rather than resetting per year.
 * Camera tracks the drawing tip closely for immersive zoom.
 */

import { TileCache, renderTiles, lngLatToPixel } from './timelineTileRenderer'
import { buildTimelineAnimationPlan, buildPseudoTimelineAnimationPlan, slicePolylineByProgress } from './timelineAnimationPlan'
import {
  computeGeoCamera,
  computeStatsForYear,
  easeOutCubic,
  easeOutBack,
  loadSourceHanSans,
  renderOverlayBranding,
  renderOverlayEvent,
  renderOverlayLineInfo,
  renderOverlayYear,
  renderPrevEdges,
  renderStations,
  renderTipGlow,
  renderScanLineLoading,
} from './timelineCanvasRenderer'

const MS_PER_KM = 1600 // 1.6 seconds per kilometer at 1x speed
const MIN_TOTAL_DRAW_MS = 3000 // minimum total draw time to avoid ultra-short animations
const MAX_TOTAL_DRAW_MS = 300000 // 5 minute cap

/**
 * Collect geographic bounds from all stations and edge waypoints.
 */
function collectBounds(project) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
  let hasData = false
  for (const s of project?.stations || []) {
    if (!Array.isArray(s.lngLat) || s.lngLat.length !== 2) continue
    const [lng, lat] = s.lngLat
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    minLng = Math.min(minLng, lng); minLat = Math.min(minLat, lat)
    maxLng = Math.max(maxLng, lng); maxLat = Math.max(maxLat, lat)
    hasData = true
  }
  for (const e of project?.edges || []) {
    for (const p of e?.waypoints || []) {
      if (!Array.isArray(p) || p.length !== 2) continue
      const [lng, lat] = p
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
      minLng = Math.min(minLng, lng); minLat = Math.min(minLat, lat)
      maxLng = Math.max(maxLng, lng); maxLat = Math.max(maxLat, lat)
      hasData = true
    }
  }
  return hasData ? { minLng, minLat, maxLng, maxLat } : null
}

/**
 * Build a flat continuous drawing plan from the per-year animation plan.
 * Ensures waypoint continuity: each segment's start connects to the previous
 * segment's end, preventing camera oscillation on ring lines.
 */
function buildContinuousPlan(animationPlan, years) {
  if (!animationPlan || !years.length) {
    return { segments: [], stationReveals: [], yearMarkers: [], totalLengthMeters: 0 }
  }

  let totalLengthMeters = 0
  for (const year of years) {
    const yp = animationPlan.yearPlans.get(year)
    if (!yp) continue
    for (const lp of yp.lineDrawPlans) {
      totalLengthMeters += lp.totalLength
    }
  }
  if (totalLengthMeters <= 0) {
    return { segments: [], stationReveals: [], yearMarkers: [], totalLengthMeters: 0 }
  }

  const segments = []
  const stationReveals = []
  const yearMarkers = []
  const revealedStations = new Set()
  let cumulativeLength = 0

  for (const year of years) {
    const yp = animationPlan.yearPlans.get(year)
    if (!yp) continue

    const yearStartProgress = cumulativeLength / totalLengthMeters
    yearMarkers.push({ year, globalStart: yearStartProgress, yearPlan: yp })

    for (const lp of yp.lineDrawPlans) {
      // Track the last endpoint of the previous segment within this line
      // to ensure waypoint continuity (critical for ring lines)
      let lastEndStationId = null

      for (const seg of lp.segments) {
        const segLenMeters = seg.lengthMeters || 0
        const globalStart = cumulativeLength / totalLengthMeters
        const globalEnd = (cumulativeLength + segLenMeters) / totalLengthMeters

        // Determine correct orientation: if the previous segment ended at
        // this segment's toStation (not fromStation), we need to flip
        let waypoints = seg.waypoints
        let fromId = seg.fromStationId
        let toId = seg.toStationId

        if (lastEndStationId != null && lastEndStationId !== fromId && lastEndStationId === toId) {
          // Flip: the previous segment ended at our toStation, so draw in reverse
          waypoints = [...waypoints].reverse()
          fromId = seg.toStationId
          toId = seg.fromStationId
        }

        lastEndStationId = toId

        segments.push({
          waypoints,
          color: lp.color,
          lineId: lp.lineId,
          nameZh: lp.nameZh,
          nameEn: lp.nameEn,
          globalStart,
          globalEnd,
          fromStationId: fromId,
          toStationId: toId,
          year,
        })

        if (!revealedStations.has(fromId)) {
          revealedStations.add(fromId)
          stationReveals.push({ stationId: fromId, triggerProgress: globalStart })
        }
        if (!revealedStations.has(toId)) {
          revealedStations.add(toId)
          stationReveals.push({ stationId: toId, triggerProgress: globalEnd })
        }

        cumulativeLength += segLenMeters
      }
    }
  }

  return { segments, stationReveals, yearMarkers, totalLengthMeters }
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {Object} project
 * @param {Object} options
 */
export function createTimelinePreviewRenderer(canvas, project, options = {}) {
  const {
    title = project?.name || 'RailMap',
    author = '',
    pseudoMode: initialPseudoMode = false,
    onStateChange,
    onYearChange,
  } = options

  let pseudoMode = initialPseudoMode
  let speed = 1
  let state = 'idle'
  let rafId = null
  let phaseStart = 0

  // Timeline data
  let years = []
  let eventMap = new Map()
  let lineLabels = new Map()
  let animationPlan = null
  let continuousPlan = null
  let currentYearIndex = 0

  // Geographic data
  let tileCache = new TileCache()
  let stationMap = new Map()
  let lineMap = new Map()
  let fullBounds = null

  // Camera — tip-tracking system
  let camera = { centerLng: 116.99, centerLat: 36.65, zoom: 11 }
  let fullCamera = null
  let smoothCamera = null // smoothly interpolated camera state
  let lastFrameTime = 0 // for delta-time based smoothing
  const CAMERA_SMOOTH_HALF_LIFE = 800 // ms — time for camera to move halfway to target (higher = smoother/slower)

  // ─── Animation state ──────────────────────────────────────────
  // Station pop-in & interchange morph
  const stationAnimState = new Map() // stationId → { popT: 0..1, interchangeT: 0..1, labelAlpha: 0..1, lineCount: number }
  const STATION_POP_DURATION = 0.005 // global progress units for pop-in
  const STATION_LABEL_DELAY = 0.0017 // label starts fading in after this delay
  const STATION_LABEL_DURATION = 0.0033
  const INTERCHANGE_MORPH_DURATION = 0.004

  // Year transition animation
  let prevYearLabel = null
  let yearTransitionT = 1 // 0 = just changed, 1 = settled
  let yearTransitionStart = 0 // global progress when year changed
  const YEAR_TRANSITION_DURATION = 0.0075 // global progress units

  // Stats counting-up animation
  let displayStats = null // { km, stations } — smoothly animated
  let targetStats = null
  const STATS_LERP_SPEED = 0.08 // per-frame lerp factor

  // Per-line stats counting-up
  let displayLineStats = new Map() // lineId → { km, stations }
  let targetLineStats = new Map()

  // Event banner slide-in
  let bannerSlideT = 0 // 0..1
  let bannerSlideYear = null // which year the banner is for
  const BANNER_SLIDE_DURATION = 0.01 // global progress units

  // Tip glow pulse
  let tipGlowPhase = 0 // continuous phase for pulsing

  // Loading animation state
  let loadingProgress = { loaded: 0, total: 0 }
  let loadingStartTime = 0
  let loadingThemeColor = '#2563EB'
  let loadingSmoothedProgress = 0
  let loadingComplete = false
  let loadingCompleteTime = 0
  let lastLoadingFrameTime = 0

  // Canvas
  const ctx = canvas.getContext('2d')
  let logicalWidth = canvas.width
  let logicalHeight = canvas.height
  const dpr = window.devicePixelRatio || 1

  function applyCanvasSize(w, h) {
    logicalWidth = w
    logicalHeight = h
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  // ─── Tile reload trigger ──────────────────────────────────────
  tileCache.onTileLoaded = () => {
    // Only trigger repaint in idle — during playback the RAF loop already repaints every frame
    if (state === 'idle' && fullBounds) {
      scheduleFrame()
    }
  }

  // ─── Data preparation ──────────────────────────────────────────

  function buildData() {
    stationMap = new Map((project?.stations || []).map(s => [s.id, s]))
    lineMap = new Map((project?.lines || []).map(l => [l.id, l]))
    fullBounds = collectBounds(project)

    if (pseudoMode) {
      const pseudoPlan = buildPseudoTimelineAnimationPlan(project)
      years = pseudoPlan.years
      animationPlan = pseudoPlan
      lineLabels = pseudoPlan.lineLabels || new Map()
      eventMap = new Map()
    } else {
      const yearSet = new Set()
      for (const edge of project?.edges || []) {
        if (edge.openingYear != null) yearSet.add(edge.openingYear)
      }
      years = [...yearSet].sort((a, b) => a - b)

      eventMap = new Map()
      for (const evt of project?.timelineEvents || []) {
        eventMap.set(evt.year, evt.description)
      }

      lineLabels = new Map()
      animationPlan = buildTimelineAnimationPlan(project)
    }

    continuousPlan = buildContinuousPlan(animationPlan, years)

    fullCamera = computeGeoCamera(fullBounds, logicalWidth, logicalHeight)
    camera = fullCamera
    smoothCamera = null

    // Prefetch tiles at multiple zoom levels
    if (fullBounds) {
      const baseZoom = Math.round(fullCamera.zoom)
      for (let z = baseZoom; z <= baseZoom + 4; z++) {
        tileCache.prefetchForBounds(fullBounds, z)
      }
    }
  }

  // ─── Timing helpers ─────────────────────────────────────────────

  function getTotalDrawMs() {
    const totalKm = (continuousPlan?.totalLengthMeters || 0) / 1000
    const baseMs = Math.max(MIN_TOTAL_DRAW_MS, Math.min(MAX_TOTAL_DRAW_MS, totalKm * MS_PER_KM))
    return baseMs / speed
  }

  // ─── Tip-tracking camera ──────────────────────────────────────

  /**
   * Compute a target camera centered on the drawing tip with fixed zoom.
   * Zoom stays constant throughout playback — only pans to follow the tip.
   */
  function computeTipCamera(globalProgress) {
    const cp = continuousPlan
    if (!cp || !cp.segments.length) return fullCamera

    // Find the tip point: the interpolated position at globalProgress
    let tipLng = null, tipLat = null

    for (const seg of cp.segments) {
      if (seg.globalStart >= globalProgress) break
      if (globalProgress <= seg.globalStart) continue

      const pts = seg.waypoints
      if (!pts || pts.length < 2) continue

      const segSpan = seg.globalEnd - seg.globalStart
      if (segSpan <= 0) continue

      const localEnd = Math.min(1, (globalProgress - seg.globalStart) / segSpan)

      // Track the tip (last drawn point)
      const idx = Math.min(Math.floor(localEnd * (pts.length - 1)), pts.length - 2)
      const frac = localEnd * (pts.length - 1) - idx
      tipLng = pts[idx][0] + (pts[idx + 1][0] - pts[idx][0]) * frac
      tipLat = pts[idx][1] + (pts[idx + 1][1] - pts[idx][1]) * frac
    }

    if (tipLng == null) return fullCamera

    // Fixed zoom: constant throughout playback
    const fixedZoom = fullCamera.zoom + 2.5

    return {
      centerLng: tipLng,
      centerLat: tipLat,
      zoom: fixedZoom,
    }
  }

  /**
   * Compute the smoothed camera for a given frame.
   * Uses exponential smoothing with delta-time for frame-rate-independent
   * smooth camera movement. The half-life parameter controls how quickly
   * the camera converges to the target (lower = snappier).
   */
  function computeCameraAtProgress(globalProgress, now) {
    if (!continuousPlan?.segments?.length) {
      return fullCamera || computeGeoCamera(fullBounds, logicalWidth, logicalHeight)
    }

    const target = computeTipCamera(globalProgress)

    if (!smoothCamera || !lastFrameTime) {
      // First frame: jump to target
      smoothCamera = { ...target }
      lastFrameTime = now || performance.now()
      return smoothCamera
    }

    // Delta-time exponential smoothing: factor = 1 - 2^(-dt / halfLife)
    const dt = Math.min((now || performance.now()) - lastFrameTime, 100) // cap at 100ms to avoid jumps after pauses
    lastFrameTime = now || performance.now()
    const t = 1 - Math.pow(2, -dt / CAMERA_SMOOTH_HALF_LIFE)

    smoothCamera = {
      centerLng: smoothCamera.centerLng + (target.centerLng - smoothCamera.centerLng) * t,
      centerLat: smoothCamera.centerLat + (target.centerLat - smoothCamera.centerLat) * t,
      zoom: smoothCamera.zoom + (target.zoom - smoothCamera.zoom) * t,
    }

    return smoothCamera
  }

  // ─── Stats helpers ──────────────────────────────────────────────

  /** Find which year the current global progress falls into. */
  function findCurrentYear(globalProgress) {
    if (!continuousPlan?.yearMarkers?.length) return { year: null, index: 0 }
    let idx = 0
    for (let i = continuousPlan.yearMarkers.length - 1; i >= 0; i--) {
      if (globalProgress >= continuousPlan.yearMarkers[i].globalStart) {
        idx = i
        break
      }
    }
    return { year: continuousPlan.yearMarkers[idx].year, index: idx }
  }

  /** Compute stats for pseudo mode up to a given year. */
  function computePseudoStats(yearPlan) {
    if (!yearPlan) return null
    const lineIds = new Set()
    const allEdges = [...(yearPlan.prevEdges || [])]
    for (const lp of yearPlan.lineDrawPlans || []) {
      lineIds.add(lp.lineId)
      for (const seg of lp.segments) {
        const edge = (project?.edges || []).find(e => e.id === seg.edgeId)
        if (edge) allEdges.push(edge)
      }
    }
    for (const e of allEdges) {
      for (const lid of e.sharedByLineIds || []) lineIds.add(lid)
    }
    let totalMeters = 0
    for (const e of allEdges) totalMeters += e.lengthMeters || 0
    return {
      lines: lineIds.size,
      stations: yearPlan.cumulativeStationIds?.size || 0,
      km: totalMeters / 1000,
    }
  }

  /** Compute stats at a given global progress. */
  function computeStatsAtProgress(globalProgress) {
    const { year, index } = findCurrentYear(globalProgress)
    if (year == null) return null
    const marker = continuousPlan.yearMarkers[index]
    if (!marker?.yearPlan) return null
    return pseudoMode
      ? computePseudoStats(marker.yearPlan)
      : computeStatsForYear(project, year)
  }

  /**
   * Compute per-line cumulative km and station count up to the given year marker index.
   */
  function computeCumulativeLineStats(yearMarkerIndex) {
    if (!continuousPlan?.yearMarkers?.length) return []
    const lineKm = new Map()
    const lineStations = new Map() // lineId → Set<stationId>
    const lineInfo = new Map()

    for (let i = 0; i <= yearMarkerIndex && i < continuousPlan.yearMarkers.length; i++) {
      const marker = continuousPlan.yearMarkers[i]
      const yp = marker?.yearPlan
      if (!yp) continue
      for (const lp of yp.lineDrawPlans) {
        if (!lineInfo.has(lp.lineId)) {
          const line = lineMap.get(lp.lineId)
          lineInfo.set(lp.lineId, {
            name: lp.nameZh || lp.nameEn || (line?.nameZh) || lp.lineId,
            color: lp.color || line?.color || '#2563EB',
          })
        }
        lineKm.set(lp.lineId, (lineKm.get(lp.lineId) || 0) + (lp.totalLength || 0))
        if (!lineStations.has(lp.lineId)) lineStations.set(lp.lineId, new Set())
        const stSet = lineStations.get(lp.lineId)
        for (const seg of lp.segments) {
          stSet.add(seg.fromStationId)
          stSet.add(seg.toStationId)
        }
      }
    }

    const orderedLineIds = (project?.lines || []).map(l => l.id)
    const result = []
    for (const lid of orderedLineIds) {
      if (lineInfo.has(lid)) {
        const info = lineInfo.get(lid)
        result.push({ lineId: lid, name: info.name, color: info.color, km: (lineKm.get(lid) || 0) / 1000, stations: lineStations.get(lid)?.size || 0 })
      }
    }
    for (const [lid, info] of lineInfo) {
      if (!result.find(r => r.lineId === lid)) {
        result.push({ lineId: lid, name: info.name, color: info.color, km: (lineKm.get(lid) || 0) / 1000, stations: lineStations.get(lid)?.size || 0 })
      }
    }
    return result
  }

  /**
   * Get the current year's new line draw info for the top banner.
   */
  function getCurrentYearLineInfo(yearMarkerIndex) {
    if (!continuousPlan?.yearMarkers?.length) return null
    const marker = continuousPlan.yearMarkers[yearMarkerIndex]
    const yp = marker?.yearPlan
    if (!yp?.lineDrawPlans?.length) return null

    let totalNewKm = 0
    for (const lp of yp.lineDrawPlans) {
      totalNewKm += (lp.totalLength || 0) / 1000
    }

    const primary = yp.lineDrawPlans[0]
    return {
      nameZh: primary.nameZh || '',
      nameEn: primary.nameEn || '',
      color: primary.color || '#2563EB',
      deltaKm: totalNewKm,
    }
  }

  // ─── State transitions ─────────────────────────────────────────

  function setState(next) {
    if (state === next) return
    state = next
    onStateChange?.(state, {
      year: years[currentYearIndex] ?? null,
      yearIndex: currentYearIndex,
      totalYears: years.length,
    })
  }

  function startPlaying(now) {
    currentYearIndex = 0
    phaseStart = now
    smoothCamera = null
    // Reset all animation state
    stationAnimState.clear()
    prevYearLabel = null
    yearTransitionT = 1
    displayStats = null
    targetStats = null
    displayLineStats = new Map()
    targetLineStats = new Map()
    bannerSlideT = 0
    bannerSlideYear = null
    tipGlowPhase = 0
    setState('playing')
    emitYearChange()
  }

  function emitYearChange() {
    onYearChange?.(years[currentYearIndex], currentYearIndex, years.length)
  }

  // ─── Continuous rendering ───────────────────────────────────────

  /**
   * Render the network at a given global draw progress (0..1).
   * Draws all segments up to the progress point as a single continuous stroke.
   * Orchestrates all animation state: station pop-in, interchange morph,
   * year transition, stats counting, event banner slide-in, tip glow.
   */
  function renderContinuousFrame(globalProgress, now) {
    const cp = continuousPlan
    if (!cp || !cp.segments.length) return

    // Dynamic camera: track drawing tip
    camera = computeCameraAtProgress(globalProgress, now)

    // Tiles — renderTiles handles on-demand fetching for any missing tiles,
    // so no per-frame prefetch is needed (precacheTilesForAnimation pre-warms the cache).
    renderTiles(ctx, camera, logicalWidth, logicalHeight, tileCache)

    const lw = Math.max(2, 3.5 * Math.pow(2, (camera.zoom - 12) * 0.45))

    // ─── Track the drawing tip for glow effect ───────────────
    let tipLng = null, tipLat = null
    let tipColor = '#2563EB'

    // ─── Draw all segments: fully drawn ones + the currently animating one ───
    for (const seg of cp.segments) {
      if (globalProgress <= seg.globalStart) break

      const segSpan = seg.globalEnd - seg.globalStart
      let segProgress = 1
      if (segSpan > 0 && globalProgress < seg.globalEnd) {
        segProgress = Math.max(0, Math.min(1, (globalProgress - seg.globalStart) / segSpan))
      }

      let points = seg.waypoints
      if (segProgress < 1) {
        const sliced = slicePolylineByProgress(seg.waypoints, segProgress)
        points = sliced.points
        // Track tip position from the currently-drawing segment
        if (sliced.tipPoint) {
          tipLng = sliced.tipPoint[0]
          tipLat = sliced.tipPoint[1]
          tipColor = seg.color
        }
      } else {
        // Fully drawn segment — tip is at the end
        const lastPt = seg.waypoints[seg.waypoints.length - 1]
        if (lastPt) {
          tipLng = lastPt[0]
          tipLat = lastPt[1]
          tipColor = seg.color
        }
      }

      if (points.length >= 2) {
        drawGeoPolyline(ctx, points, camera, logicalWidth, logicalHeight, seg.color, lw, 1)
      }
    }

    // ─── Tip glow effect (disabled) ─────────────────────────

    // ─── Update station animation state ──────────────────────
    // Track which lines have reached each station for interchange detection
    const stationLineIds = new Map() // stationId → Set<lineId>
    for (const seg of cp.segments) {
      if (globalProgress < seg.globalStart) break
      const segDone = globalProgress >= seg.globalEnd
      // fromStation is revealed at segment start
      if (globalProgress >= seg.globalStart) {
        if (!stationLineIds.has(seg.fromStationId)) stationLineIds.set(seg.fromStationId, new Set())
        stationLineIds.get(seg.fromStationId).add(seg.lineId)
      }
      // toStation is revealed at segment end (or partially if in progress)
      if (segDone) {
        if (!stationLineIds.has(seg.toStationId)) stationLineIds.set(seg.toStationId, new Set())
        stationLineIds.get(seg.toStationId).add(seg.lineId)
      }
    }

    const revealedIds = new Set()
    for (const reveal of cp.stationReveals) {
      if (globalProgress < reveal.triggerProgress) continue
      const sid = reveal.stationId
      revealedIds.add(sid)

      const elapsed = globalProgress - reveal.triggerProgress

      if (!stationAnimState.has(sid)) {
        stationAnimState.set(sid, { popT: 0, interchangeT: 0, labelAlpha: 0, lineCount: 0 })
      }
      const anim = stationAnimState.get(sid)

      // Pop-in animation
      anim.popT = Math.min(1, elapsed / STATION_POP_DURATION)

      // Label fade-in (delayed after pop)
      const labelElapsed = elapsed - STATION_LABEL_DELAY
      anim.labelAlpha = labelElapsed > 0 ? Math.min(1, labelElapsed / STATION_LABEL_DURATION) : 0

      // Interchange morph: triggered when lineCount goes from 1 to 2+
      const currentLineCount = stationLineIds.get(sid)?.size || 0
      if (currentLineCount >= 2 && anim.lineCount < 2) {
        // Just became interchange — start morph from current progress
        anim.interchangeMorphStart = globalProgress
      }
      anim.lineCount = currentLineCount

      if (anim.interchangeMorphStart != null) {
        const morphElapsed = globalProgress - anim.interchangeMorphStart
        anim.interchangeT = Math.min(1, morphElapsed / INTERCHANGE_MORPH_DURATION)
      } else {
        anim.interchangeT = 0
      }
    }

    // Render stations with animation state
    renderStations(ctx, revealedIds, camera, logicalWidth, logicalHeight, stationMap, {
      alpha: 0.9,
      stationAnimState,
    })

    // ─── Overlays ───────────────────────────────────────────────
    const { year, index } = findCurrentYear(globalProgress)
    if (year != null && year !== years[currentYearIndex]) {
      currentYearIndex = index
      emitYearChange()
    }

    const yearLabel = pseudoMode ? (lineLabels.get(year)?.nameZh || `#${year}`) : year

    // Year transition animation
    if (yearLabel !== prevYearLabel && prevYearLabel != null) {
      yearTransitionStart = globalProgress
      yearTransitionT = 0
    }
    if (yearTransitionT < 1) {
      yearTransitionT = Math.min(1, (globalProgress - yearTransitionStart) / YEAR_TRANSITION_DURATION)
    }
    const savedPrevYear = (yearTransitionT < 1) ? prevYearLabel : null
    if (yearLabel !== prevYearLabel) {
      prevYearLabel = yearLabel
    }

    // Stats counting-up animation
    const rawStats = computeStatsAtProgress(globalProgress)
    if (rawStats) {
      targetStats = rawStats
      if (!displayStats) {
        displayStats = { ...rawStats }
      } else {
        displayStats.km += (targetStats.km - displayStats.km) * STATS_LERP_SPEED
        displayStats.stations = Math.round(
          displayStats.stations + (targetStats.stations - displayStats.stations) * STATS_LERP_SPEED
        )
        // Snap when very close
        if (Math.abs(displayStats.km - targetStats.km) < 0.05) displayStats.km = targetStats.km
        if (displayStats.stations === targetStats.stations - 1 || displayStats.stations === targetStats.stations + 1) {
          displayStats.stations = targetStats.stations
        }
      }
    }

    const overlayAlpha = globalProgress < 0.01 ? globalProgress / 0.01 : globalProgress > 0.99 ? (1 - globalProgress) / 0.01 : 1

    // Year + Stats (bottom-left block)
    renderOverlayYear(ctx, yearLabel, overlayAlpha, logicalWidth, logicalHeight, {
      stats: rawStats,
      displayStats: displayStats || rawStats,
      yearTransition: yearTransitionT,
      prevYear: savedPrevYear,
    })
    renderOverlayBranding(ctx, title, author, overlayAlpha, logicalWidth, logicalHeight)

    // Current year marker
    const curMarker = continuousPlan.yearMarkers[index]

    // Compute yearLocalT for banner alpha and line card animation
    let yearLocalT = 0
    if (curMarker) {
      const nextMarker = continuousPlan.yearMarkers[index + 1]
      const yearEnd = nextMarker ? nextMarker.globalStart : 1
      const yearSpan = yearEnd - curMarker.globalStart
      yearLocalT = yearSpan > 0 ? (globalProgress - curMarker.globalStart) / yearSpan : 0
    }

    // Event banner slide-in
    if (curMarker) {
      if (bannerSlideYear !== year) {
        bannerSlideYear = year
        bannerSlideT = 0
      }
      // Slide in during first part of year, slide out at end
      if (yearLocalT < 0.075) {
        bannerSlideT = Math.min(1, yearLocalT / 0.075)
      } else if (yearLocalT > 0.925) {
        bannerSlideT = Math.max(0, (1 - yearLocalT) / 0.075)
      } else {
        bannerSlideT = 1
      }

      const eventText = eventMap.get(year)
      const lineInfo = getCurrentYearLineInfo(index)
      const lineColor = lineInfo?.color || continuousPlan.segments.find(s => s.year === year)?.color || '#2563EB'

      renderOverlayEvent(ctx, eventText || null, lineColor, overlayAlpha, logicalWidth, logicalHeight, {
        nameZh: lineInfo?.nameZh || '',
        nameEn: lineInfo?.nameEn || '',
        deltaKm: lineInfo?.deltaKm || 0,
        slideT: bannerSlideT,
      })
    }

    // Compute per-line appearance progress for slide-in animation
    const lineAppearProgress = new Map()
    for (let i = 0; i <= index && i < continuousPlan.yearMarkers.length; i++) {
      const marker = continuousPlan.yearMarkers[i]
      for (const lp of marker.yearPlan.lineDrawPlans) {
        if (i < index) {
          lineAppearProgress.set(lp.lineId, 1)
        } else {
          lineAppearProgress.set(lp.lineId, easeOutCubic(Math.min(yearLocalT * 18, 1)))
        }
      }
    }

    // Per-line stats counting-up
    const cumulativeLineStats = computeCumulativeLineStats(index)
    for (const entry of cumulativeLineStats) {
      if (!targetLineStats.has(entry.lineId)) {
        targetLineStats.set(entry.lineId, { km: entry.km, stations: entry.stations })
        displayLineStats.set(entry.lineId, { km: entry.km, stations: entry.stations })
      } else {
        const target = targetLineStats.get(entry.lineId)
        target.km = entry.km
        target.stations = entry.stations
        const disp = displayLineStats.get(entry.lineId)
        disp.km += (target.km - disp.km) * STATS_LERP_SPEED
        disp.stations = Math.round(disp.stations + (target.stations - disp.stations) * STATS_LERP_SPEED)
        if (Math.abs(disp.km - target.km) < 0.05) disp.km = target.km
        if (Math.abs(disp.stations - target.stations) <= 1) disp.stations = target.stations
      }
    }

    // Bottom-left line cards with slide-in + counting stats + stats pills
    if (cumulativeLineStats.length > 0) {
      renderOverlayLineInfo(ctx, curMarker?.yearPlan, rawStats, overlayAlpha, logicalWidth, logicalHeight, {
        cumulativeLineStats,
        lineAppearProgress,
        displayLineStats,
        displayStats: displayStats || rawStats,
      })
    }
  }

  /** Draw a single polyline in geographic coordinates. */
  function drawGeoPolyline(ctx2d, points, cam, width, height, color, lineWidth, alpha) {
    if (!points || points.length < 2) return
    ctx2d.save()
    ctx2d.globalAlpha = alpha
    ctx2d.strokeStyle = color
    ctx2d.lineWidth = lineWidth
    ctx2d.lineCap = 'round'
    ctx2d.lineJoin = 'round'
    ctx2d.setLineDash([])
    ctx2d.beginPath()
    const [sx, sy] = lngLatToPixel(points[0][0], points[0][1], cam, width, height)
    ctx2d.moveTo(sx, sy)
    for (let i = 1; i < points.length; i++) {
      const [px, py] = lngLatToPixel(points[i][0], points[i][1], cam, width, height)
      ctx2d.lineTo(px, py)
    }
    ctx2d.stroke()
    ctx2d.restore()
  }

  // ─── Rendering tick ────────────────────────────────────────────

  function tick(now) {
    rafId = null

    if (state === 'idle') {
      renderIdleFrame()
      return
    }

    if (state === 'loading') {
      tickLoading(now)
      scheduleFrame()
      return
    }

    if (state === 'playing') {
      tickPlaying(now)
      scheduleFrame()
      return
    }
  }

  function tickPlaying(now) {
    const totalMs = getTotalDrawMs()
    const elapsed = now - phaseStart
    const rawProgress = elapsed / totalMs

    if (rawProgress >= 1) {
      renderContinuousFrame(1, now)
      setState('idle')
      renderIdleFrame()
      return
    }

    renderContinuousFrame(rawProgress, now)
  }

  /**
   * Tick the loading animation: smooth progress, render scan line, handle completion.
   */
  function tickLoading(now) {
    const elapsed = now - loadingStartTime
    const dt = lastLoadingFrameTime ? Math.min(now - lastLoadingFrameTime, 100) : 16
    lastLoadingFrameTime = now

    // Raw progress from tile cache
    const { loaded, total } = loadingProgress
    const rawProgress = total > 0 ? Math.min(1, loaded / total) : 0

    // Exponential smoothing (half-life 400ms), never goes backwards
    const smoothFactor = 1 - Math.pow(2, -dt / 400)
    const target = Math.max(loadingSmoothedProgress, rawProgress)
    loadingSmoothedProgress += (target - loadingSmoothedProgress) * smoothFactor

    // Fast load shortcut: if completed in <500ms, skip animation entirely
    if (loadingComplete && elapsed < 500) {
      tileCache.stopProgressTracking()
      startPlaying(now)
      scheduleFrame()
      return
    }

    // Scan line Y position tracks smoothed progress
    const scanY = loadingSmoothedProgress * logicalHeight

    // Render the scan-line frame
    renderScanLineLoading(ctx, logicalWidth, logicalHeight, {
      scanY,
      progress: loadingSmoothedProgress,
      themeColor: loadingThemeColor,
      elapsed,
      camera: fullCamera,
      tileCache,
      renderTilesFn: renderTiles,
    })

    // Completion transition: snap to 1.0 when close enough, hold 300ms, then start playing
    if (loadingComplete) {
      if (loadingSmoothedProgress >= 0.995) {
        loadingSmoothedProgress = 1

        if (loadingCompleteTime === 0) {
          loadingCompleteTime = now
        }

        // Hold the completed frame for 300ms before transitioning
        if (now - loadingCompleteTime >= 300) {
          tileCache.stopProgressTracking()
          startPlaying(now)
          scheduleFrame()
          return
        }
      }
    }
  }

  function renderIdleFrame() {
    if (!fullBounds) {
      ctx.fillStyle = '#e8ecf0'
      ctx.fillRect(0, 0, logicalWidth, logicalHeight)
      return
    }
    const cam = computeGeoCamera(fullBounds, logicalWidth, logicalHeight)
    renderTiles(ctx, cam, logicalWidth, logicalHeight, tileCache)

    const allEdges = pseudoMode
      ? (project?.edges || [])
      : (project?.edges || []).filter(e => e.openingYear != null)
    renderPrevEdges(ctx, allEdges, cam, logicalWidth, logicalHeight, stationMap, lineMap)
    const allStationIds = new Set()
    for (const e of allEdges) {
      allStationIds.add(e.fromStationId)
      allStationIds.add(e.toStationId)
    }
    renderStations(ctx, allStationIds, cam, logicalWidth, logicalHeight, stationMap)
    renderOverlayBranding(ctx, title, author, 0.4, logicalWidth, logicalHeight)
  }

  function scheduleFrame() {
    if (rafId != null) return
    rafId = requestAnimationFrame(tick)
  }

  function cancelFrame() {
    if (rafId != null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  // ─── Public API ────────────────────────────────────────────────

  function play() {
    if (!years.length) return
    if (state === 'playing') return

    // Load font + pre-cache all tiles before starting playback
    buildData()
    camera = fullCamera || computeGeoCamera(fullBounds, logicalWidth, logicalHeight)

    // Extract theme color from first line segment for scan-line glow
    if (continuousPlan?.segments?.length) {
      loadingThemeColor = continuousPlan.segments[0].color || '#2563EB'
    } else {
      loadingThemeColor = '#2563EB'
    }

    // Reset loading animation state
    loadingProgress = { loaded: 0, total: 0 }
    loadingStartTime = performance.now()
    loadingSmoothedProgress = 0
    loadingComplete = false
    loadingCompleteTime = 0
    lastLoadingFrameTime = 0

    setState('loading') // signal loading state
    scheduleFrame() // start RAF loop immediately for scan-line animation

    // Collect all text that will be rendered on canvas so font subsets are downloaded
    const textParts = []
    for (const s of project?.stations || []) {
      if (s.nameZh) textParts.push(s.nameZh)
      if (s.nameEn) textParts.push(s.nameEn)
    }
    for (const l of project?.lines || []) {
      if (l.nameZh) textParts.push(l.nameZh)
      if (l.nameEn) textParts.push(l.nameEn)
    }
    for (const evt of project?.timelineEvents || []) {
      if (evt.description) textParts.push(evt.description)
    }
    const textHint = textParts.join('')

    Promise.all([
      loadSourceHanSans(textHint),
      precacheTilesForAnimation(),
    ]).then(() => {
      if (state !== 'loading') return // cancelled during loading
      // Don't start playing directly — set flag and let RAF loop handle the transition
      loadingComplete = true
    })
  }

  /**
   * Pre-cache all tiles the animation will need by sampling camera positions
   * along the timeline and prefetching tiles for each view.
   */
  function precacheTilesForAnimation() {
    if (!continuousPlan?.segments?.length || !fullBounds) return Promise.resolve()

    // Start progress tracking — update loadingProgress on each tile load
    tileCache.startProgressTracking((loaded, total) => {
      loadingProgress = { loaded, total }
    })

    const promises = []
    // Sample ~30 points along the animation to cover all camera positions
    const sampleCount = 30
    for (let i = 0; i <= sampleCount; i++) {
      const progress = i / sampleCount
      const cam = computeTipCamera(progress)
      const z = Math.round(Math.max(0, Math.min(18, cam.zoom)))
      // Compute view bounds at this camera position
      const halfLng = 0.02 * Math.pow(2, 12 - cam.zoom)
      const halfLat = 0.015 * Math.pow(2, 12 - cam.zoom)
      const viewBounds = {
        minLng: cam.centerLng - halfLng,
        maxLng: cam.centerLng + halfLng,
        minLat: cam.centerLat - halfLat,
        maxLat: cam.centerLat + halfLat,
      }
      promises.push(tileCache.prefetchForBounds(viewBounds, z))
      // Also prefetch one zoom level above and below for smooth transitions
      if (z > 0) promises.push(tileCache.prefetchForBounds(viewBounds, z - 1))
      if (z < 18) promises.push(tileCache.prefetchForBounds(viewBounds, z + 1))
    }

    // Also prefetch the full-extent view
    const baseZoom = Math.round(fullCamera.zoom)
    for (let z = baseZoom; z <= baseZoom + 4; z++) {
      promises.push(tileCache.prefetchForBounds(fullBounds, z))
    }

    return Promise.all(promises).then(() => {
      tileCache.stopProgressTracking()
    })
  }

  function pause() {
    if (state === 'loading') {
      cancelFrame()
      tileCache.stopProgressTracking()
      setState('idle')
      renderIdleFrame()
      return
    }
    if (state !== 'playing') return
    cancelFrame()
    setState('idle')
  }

  function stop() {
    if (state === 'loading') {
      tileCache.stopProgressTracking()
    }
    cancelFrame()
    currentYearIndex = 0
    smoothCamera = null
    camera = fullCamera || computeGeoCamera(fullBounds, logicalWidth, logicalHeight)
    setState('idle')
    renderIdleFrame()
  }

  function seekToYear(year) {
    const idx = years.indexOf(year)
    if (idx === -1 || !continuousPlan?.yearMarkers?.length) return
    currentYearIndex = idx

    const marker = continuousPlan.yearMarkers[idx]
    const nextMarker = continuousPlan.yearMarkers[idx + 1]
    const yearEnd = nextMarker ? nextMarker.globalStart : 1
    smoothCamera = null
    renderContinuousFrame(yearEnd, performance.now())
    emitYearChange()
  }

  function setSpeed(s) {
    const num = Number(s)
    if (Number.isFinite(num) && num > 0) speed = num
  }

  function setPseudoMode(v) { pseudoMode = Boolean(v) }

  function resize(w, h) {
    applyCanvasSize(w, h)
    if (fullBounds) {
      fullCamera = computeGeoCamera(fullBounds, logicalWidth, logicalHeight)
      smoothCamera = null
    }
    if (state === 'idle') renderIdleFrame()
  }

  function rebuild() {
    buildData()
    if (state === 'idle') renderIdleFrame()
  }

  function destroy() {
    cancelFrame()
    tileCache.stopProgressTracking()
    tileCache.onTileLoaded = null
    state = 'idle'
    tileCache.clear()
    animationPlan = null
    continuousPlan = null
    smoothCamera = null
    fullCamera = null
    years = []
    stationAnimState.clear()
    displayStats = null
    targetStats = null
    displayLineStats = new Map()
    targetLineStats = new Map()
    loadingComplete = false
    loadingProgress = { loaded: 0, total: 0 }
  }

  function getState() {
    return {
      state,
      currentYear: years[currentYearIndex] ?? null,
      yearIndex: currentYearIndex,
      totalYears: years.length,
      speed,
    }
  }

  // ─── Initialize ────────────────────────────────────────────────

  buildData()
  // Eagerly start loading the font so it's likely ready by the time user hits play
  loadSourceHanSans()

  return {
    play,
    pause,
    stop,
    seekToYear,
    setSpeed,
    setPseudoMode,
    resize,
    rebuild,
    destroy,
    getState,
    get state() { return state },
    get years() { return years },
    get currentYearIndex() { return currentYearIndex },
    get pseudoMode() { return pseudoMode },
    get lineLabels() { return lineLabels },
  }
}
