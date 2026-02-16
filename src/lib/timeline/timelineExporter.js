/**
 * Timeline exporter — renders timeline animation to video (WebM).
 *
 * Uses an offscreen canvas to render each frame with geographic coordinates
 * on OSM tile background, then records via MediaRecorder API.
 *
 * Camera system: pans/zooms to focus on newly added edges each year.
 * Includes progressive line drawing, station reveals, and professional UI overlays.
 */

import { TileCache, renderTiles } from './timelineTileRenderer'
import { buildTimelineAnimationPlan, slicePolylineByProgress } from './timelineAnimationPlan'
import {
  computeGeoCamera,
  computeFocusCamera,
  computeStatsForYear,
  easeOutCubic,
  lerpGeoCamera,
  renderAnimatedEdges,
  renderAnimatedStations,
  renderOverlayBranding,
  renderOverlayEvent,
  renderOverlayLineInfo,
  renderOverlayScaleBar,
  renderOverlayStats,
  renderOverlayYear,
  renderPrevEdges,
  renderStations,
} from './timelineCanvasRenderer'

const RESOLUTION_PRESETS = {
  '1080p': { width: 1920, height: 1080 },
  '2k': { width: 2560, height: 1440 },
  '4k': { width: 3840, height: 2160 },
}

const DEFAULT_FPS = 30
const YEAR_HOLD_FRAMES = 96        // ~3.2s at 30fps
const TRANSITION_FRAMES = 60       // ~2.0s at 30fps
const DRAW_FRACTION = 0.72

export function getResolutionPresets() {
  return { ...RESOLUTION_PRESETS }
}

/**
 * Collect geographic bounds from project.
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
 * Export timeline animation as video.
 *
 * @param {Object} project
 * @param {Object} options
 * @returns {Promise<Blob>}
 */
export async function exportTimelineVideo(project, options = {}) {
  const {
    resolution = '1080p',
    format = 'webm',
    title = project?.name || 'Metro Studio',
    author = '',
    onProgress,
    signal,
  } = options

  const { width, height } = RESOLUTION_PRESETS[resolution] || RESOLUTION_PRESETS['1080p']

  // Collect sorted years
  const yearSet = new Set()
  for (const edge of project?.edges || []) {
    if (edge.openingYear != null) yearSet.add(edge.openingYear)
  }
  const years = [...yearSet].sort((a, b) => a - b)
  if (!years.length) throw new Error('没有标记年份的线段，无法导出时间轴动画')

  // Build event map
  const eventMap = new Map()
  for (const evt of project?.timelineEvents || []) {
    eventMap.set(evt.year, evt.description)
  }

  // Build lookup maps
  const stationMap = new Map((project?.stations || []).map(s => [s.id, s]))
  const lineMap = new Map((project?.lines || []).map(l => [l.id, l]))

  // Geographic bounds
  const fullBounds = collectBounds(project)

  // Build animation plan
  const animationPlan = buildTimelineAnimationPlan(project)

  // Tile cache — prefetch all needed tiles before export
  const tileCache = new TileCache()
  const fullCam = computeGeoCamera(fullBounds, width, height)

  // Prefetch tiles for full extent and each year's focus
  const prefetchPromises = []
  if (fullBounds) {
    prefetchPromises.push(tileCache.prefetchForBounds(fullBounds, Math.round(fullCam.zoom)))
  }
  for (const year of years) {
    const yearPlan = animationPlan.yearPlans.get(year)
    if (yearPlan?.focusBounds) {
      const focusCam = computeFocusCamera(yearPlan.focusBounds, fullBounds, width, height)
      prefetchPromises.push(tileCache.prefetchForBounds(yearPlan.focusBounds, Math.round(focusCam.zoom)))
    }
  }
  await Promise.all(prefetchPromises)

  // Calculate total frames
  const yearFrames = years.length * (YEAR_HOLD_FRAMES + TRANSITION_FRAMES) - TRANSITION_FRAMES
  const totalFrames = yearFrames

  // Create offscreen canvas
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')

  // Set up MediaRecorder
  const mimeType = format === 'webm' ? 'video/webm;codecs=vp9' : 'video/webm'
  const stream = canvas.captureStream?.(DEFAULT_FPS)

  let recorder
  let chunks = []
  let fallbackCanvas = null

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

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  const recordingDone = new Promise((resolve, reject) => {
    recorder.onstop = () => resolve()
    recorder.onerror = (e) => reject(e.error || new Error('录制失败'))
  })

  recorder.start()

  // Camera state
  let camera = { ...fullCam }
  let cameraFrom = null

  // Main render loop
  for (let f = 0; f < totalFrames; f++) {
    if (signal?.aborted) {
      recorder.stop()
      throw new Error('导出已取消')
    }

    // Main timeline
    const mainFrame = f
    const yearCycleFrames = YEAR_HOLD_FRAMES + TRANSITION_FRAMES
    const yearIndex = Math.min(Math.floor(mainFrame / yearCycleFrames), years.length - 1)
    const frameInYear = mainFrame - yearIndex * yearCycleFrames

    const year = years[yearIndex]
    const yearPlan = animationPlan.yearPlans.get(year)

    if (!yearPlan) {
      renderTiles(ctx, fullCam, width, height, tileCache)
    } else {
      const focusCam = computeFocusCamera(yearPlan.focusBounds, fullBounds, width, height)

      if (frameInYear < YEAR_HOLD_FRAMES) {
        // Hold phase
        const holdT = frameInYear / YEAR_HOLD_FRAMES

        // Camera
        const camT = holdT < 0.3 ? holdT / 0.3 : 1 - (holdT - 0.3) * 0.15
        const targetCam = lerpGeoCamera(fullCam, focusCam, Math.max(0, Math.min(1, camT)))
        camera = cameraFrom
          ? lerpGeoCamera(cameraFrom, targetCam, Math.min(holdT * 2.5, 1))
          : targetCam

        const drawProgress = easeOutCubic(Math.min(holdT / DRAW_FRACTION, 1))

        // Render
        renderTiles(ctx, camera, width, height, tileCache)
        renderPrevEdges(ctx, yearPlan.prevEdges, camera, width, height, stationMap, lineMap)
        renderAnimatedEdges(ctx, yearPlan, drawProgress, camera, width, height)
        renderStations(ctx, yearPlan.prevStationIds, camera, width, height, stationMap, { alpha: 0.85 })
        renderAnimatedStations(ctx, yearPlan, drawProgress, camera, width, height, stationMap)

        // Overlays
        const yearAlpha = holdT < 0.08 ? holdT / 0.08 : holdT > 0.9 ? (1 - holdT) / 0.1 : 1
        renderOverlayYear(ctx, year, yearAlpha, width, height)
        renderOverlayStats(ctx, computeStatsForYear(project, year), yearAlpha, width, height)
        renderOverlayScaleBar(ctx, camera, yearAlpha, width, height)
        renderOverlayBranding(ctx, title, author, yearAlpha, width, height)
        renderOverlayLineInfo(ctx, yearPlan, computeStatsForYear(project, year), yearAlpha, width, height)

        const eventText = eventMap.get(year)
        if (eventText) {
          const eventAlpha = holdT < 0.15 ? holdT / 0.15 : holdT > 0.85 ? (1 - holdT) / 0.15 : 1
          const lineColor = yearPlan.lineDrawPlans?.[0]?.color || '#2563EB'
          renderOverlayEvent(ctx, eventText, lineColor, eventAlpha, width, height)
        }

        cameraFrom = null
      } else if (yearIndex < years.length - 1) {
        // Transition phase
        const transT = (frameInYear - YEAR_HOLD_FRAMES) / TRANSITION_FRAMES
        const nextYear = years[yearIndex + 1]
        const nextYearPlan = animationPlan.yearPlans.get(nextYear)
        const nextFocusCam = nextYearPlan
          ? computeFocusCamera(nextYearPlan.focusBounds, fullBounds, width, height)
          : fullCam

        camera = lerpGeoCamera(focusCam, nextFocusCam, transT)
        cameraFrom = { ...camera }

        renderTiles(ctx, camera, width, height, tileCache)
        renderPrevEdges(ctx, yearPlan.prevEdges, camera, width, height, stationMap, lineMap)
        renderAnimatedEdges(ctx, yearPlan, 1, camera, width, height)
        renderStations(ctx, yearPlan.cumulativeStationIds, camera, width, height, stationMap, { alpha: 0.85 })

        const fadeAlpha = 1 - transT
        renderOverlayYear(ctx, year, fadeAlpha, width, height)
        renderOverlayStats(ctx, computeStatsForYear(project, year), fadeAlpha, width, height)
        renderOverlayScaleBar(ctx, camera, fadeAlpha * 0.5, width, height)
        renderOverlayBranding(ctx, title, author, 0.5, width, height)
      }
    }

    // Copy to fallback canvas if needed
    if (fallbackCanvas) {
      const fallbackCtx = fallbackCanvas.getContext('2d')
      const bitmap = canvas.transferToImageBitmap()
      fallbackCtx.drawImage(bitmap, 0, 0)
      bitmap.close()
    }

    // Yield to allow MediaRecorder to process frames
    if (f % 5 === 0) {
      await new Promise(r => setTimeout(r, 0))
    }

    onProgress?.(f / totalFrames)
  }

  // Stop recording
  recorder.stop()
  await recordingDone

  // Cleanup
  tileCache.clear()

  onProgress?.(1)
  return new Blob(chunks, { type: recorder.mimeType })
}
