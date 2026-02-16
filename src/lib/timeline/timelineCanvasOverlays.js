/**
 * Overlay rendering functions for timeline canvas.
 * Renders year, stats, event banners, scale bar, branding, line info, and loading screen.
 */

import { metersPerPixel } from './timelineTileRenderer'
import { easeOutCubic } from './timelineCanvasEasing'
import { roundRect, uiScale, measurePillWidth, drawStatPill } from './timelineCanvasGeometry'

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

// ─── Overlay: Event banner (top-left) ───────────────────────────

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

// ─── Scan-line loading animation ─────────────────────────────────

/**
 * Render the scan-line tile loading animation.
 */
export function renderScanLineLoading(ctx, width, height, opts) {
  const {
    scanY,
    progress,
    themeColor = '#2563EB',
    elapsed = 0,
    camera,
    tileCache,
    renderTilesFn,
  } = opts

  const s = uiScale(width, height)

  // 1. Dark background
  ctx.fillStyle = '#0f1117'
  ctx.fillRect(0, 0, width, height)

  // 2. Dashed grid below scan line
  const gridSpacing = 48 * s
  if (scanY < height) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, scanY, width, height - scanY)
    ctx.clip()

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)'
    ctx.lineWidth = 1
    ctx.setLineDash([4 * s, 8 * s])

    // Vertical lines
    for (let x = gridSpacing; x < width; x += gridSpacing) {
      ctx.beginPath()
      ctx.moveTo(x, scanY)
      ctx.lineTo(x, height)
      ctx.stroke()
    }
    // Horizontal lines
    for (let y = scanY + gridSpacing - (scanY % gridSpacing); y < height; y += gridSpacing) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
    }

    ctx.setLineDash([])
    ctx.restore()
  }

  // 3. Real tiles above scan line (clipped), with fading grey overlay
  if (scanY > 0 && camera && tileCache && renderTilesFn) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, width, scanY)
    ctx.clip()

    renderTilesFn(ctx, camera, width, height, tileCache)

    // Grey overlay that fades as progress increases
    const overlayAlpha = Math.max(0, 0.45 * (1 - progress))
    if (overlayAlpha > 0.001) {
      ctx.fillStyle = `rgba(15, 17, 23, ${overlayAlpha})`
      ctx.fillRect(0, 0, width, scanY)
    }

    ctx.restore()
  }

  // 4. Scan line glow band + bright core
  const bandHeight = 32 * s
  const bandTop = scanY - bandHeight / 2
  const bandBottom = scanY + bandHeight / 2

  // Glow gradient band
  const glowGrad = ctx.createLinearGradient(0, bandTop, 0, bandBottom)
  glowGrad.addColorStop(0, themeColor + '00')    // transparent
  glowGrad.addColorStop(0.35, themeColor + '30')  // subtle glow
  glowGrad.addColorStop(0.5, themeColor + '60')   // peak glow
  glowGrad.addColorStop(0.65, themeColor + '30')
  glowGrad.addColorStop(1, themeColor + '00')
  ctx.fillStyle = glowGrad
  ctx.fillRect(0, bandTop, width, bandHeight)

  // Bright core line (2px)
  const coreHeight = 2 * s
  ctx.save()
  ctx.fillStyle = themeColor
  ctx.globalAlpha = 0.9
  ctx.fillRect(0, scanY - coreHeight / 2, width, coreHeight)

  // White highlight on core for extra brightness
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
  ctx.fillRect(0, scanY - coreHeight / 4, width, coreHeight / 2)
  ctx.restore()

  // 5. Bottom-left: percentage + subtitle
  const pctFontSize = Math.max(36, 64 * s)
  const subFontSize = Math.max(12, 18 * s)
  const marginX = 48 * s
  const marginY = height - 48 * s

  // Breathing pulse for subtitle (sine wave, period ~2s)
  const breathe = 0.5 + 0.5 * Math.sin(elapsed / 1000 * Math.PI)
  const subAlpha = 0.4 + 0.35 * breathe

  // Percentage number
  const pctText = `${Math.floor(progress * 100)}%`
  ctx.save()
  ctx.fillStyle = '#ffffff'
  ctx.font = `900 ${pctFontSize}px "DIN Alternate", "Bahnschrift", "Roboto Condensed", monospace`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillText(pctText, marginX, marginY - subFontSize - 8 * s)

  // Subtitle
  ctx.globalAlpha = subAlpha
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
  ctx.font = `500 ${subFontSize}px "Roboto Condensed", "Arial Narrow", sans-serif`
  ctx.textBaseline = 'bottom'
  ctx.fillText('Loading tiles...', marginX, marginY)

  ctx.restore()
}
