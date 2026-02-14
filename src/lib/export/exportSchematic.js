import JSZip from 'jszip'
import { buildHudLineRoute, buildVehicleHudRenderModel } from '../hud/renderModel'
import { getDisplayLineName } from '../lineNaming'
import { buildSchematicRenderModel } from '../schematic/renderModel'

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function shouldRenderStation(station, stationVisibilityMode) {
  if (stationVisibilityMode === 'none') return false
  if (stationVisibilityMode === 'interchange') return Boolean(station.isInterchange)
  return true
}

export function buildSchematicSvg(project, options = {}) {
  const model = buildSchematicRenderModel(project, {
    ...options,
    mirrorVertical: options.mirrorVertical ?? true,
  })

  const edgeHaloElements = model.edgePaths
    .map(
      (edge) =>
        `<path d="${edge.pathD}" fill="none" stroke="#f8fafc" stroke-width="${edge.width + 5.4}" stroke-linecap="${
          edge.lineCap || 'round'
        }" stroke-linejoin="round"${edge.dasharray ? ` stroke-dasharray="${edge.dasharray}"` : ''} opacity="${Math.min(
          1,
          edge.opacity + 0.06,
        )}" />`,
    )
    .join('\n')

  const edgeCoreElements = model.edgePaths
    .map(
      (edge) =>
        `<path d="${edge.pathD}" fill="none" stroke="${escapeXml(edge.color)}" stroke-width="${edge.width}" stroke-linecap="${
          edge.lineCap || 'round'
        }" stroke-linejoin="round"${edge.dasharray ? ` stroke-dasharray="${edge.dasharray}"` : ''} opacity="${
          edge.opacity
        }" />`,
    )
    .join('\n')

  const stationElements = model.stations
    .filter((station) => shouldRenderStation(station, options.stationVisibilityMode || 'all'))
    .map((station) => {
      const symbol = station.isInterchange
        ? `<rect x="${station.x - 5.8}" y="${station.y - 3.6}" width="11.6" height="7.2" rx="3.5" ry="3.5" fill="#ffffff" stroke="${escapeXml(model.theme.interchangeStroke)}" stroke-width="1.7" />`
        : `<circle cx="${station.x}" cy="${station.y}" r="4.1" fill="#ffffff" stroke="${escapeXml(model.theme.stationStroke)}" stroke-width="1.7" />`
      const enText = station.nameEn
        ? `<text x="${station.labelX}" y="${station.labelY + 11}" text-anchor="${station.labelAnchor}" font-size="9.3" letter-spacing="0.015em" fill="#7b8794">${escapeXml(station.nameEn)}</text>`
        : ''
      return `
<g>
  ${symbol}
  <text x="${station.labelX}" y="${station.labelY}" text-anchor="${station.labelAnchor}" font-size="11.8" fill="#111827">${escapeXml(station.nameZh)}</text>
  ${enText}
</g>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${model.width}" height="${model.height}" viewBox="0 0 ${model.width} ${model.height}">
  <rect x="0" y="0" width="${model.width}" height="${model.height}" fill="${model.theme.background}" />

  <g>
    ${edgeHaloElements}
  </g>

  <g>
    ${edgeCoreElements}
  </g>

  <g>
    ${stationElements}
  </g>

</svg>`
}

export async function downloadOfficialSchematicPng(project, options = {}) {
  await downloadSchematicPng(project, {
    ...options,
    mirrorVertical: true,
    fileName: `${sanitizeFileName(project?.name, 'railmap')}_官方风格图.png`,
  })
}

async function downloadSchematicPng(project, options = {}) {
  const { fileName, scale = 2, mirrorVertical = true, ...renderOptions } = options
  const svg = buildSchematicSvg(project, {
    ...renderOptions,
    mirrorVertical,
  })
  const pngBlob = await svgToPngBlob(svg, { scale })
  downloadBlob(pngBlob, fileName || `${sanitizeFileName(project?.name, 'railmap')}.png`)
}

export async function downloadAllLineHudZip(project, options = {}) {
  const lines = project?.lines || []
  if (!lines.length) {
    throw new Error('当前工程没有可导出的线路')
  }

  const scale = Number.isFinite(options.scale) ? Math.max(1, options.scale) : 2
  const zip = new JSZip()
  const usedPaths = new Set()
  let exportedCount = 0

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const lineName = getDisplayLineName(line, 'zh') || line?.nameZh || line?.nameEn || `线路${index + 1}`
    const lineFolder = sanitizeZipSegment(lineName, `line_${index + 1}`)
    const route = buildHudLineRoute(project, line.id)
    if (!route.ready) continue
    const directions = route.directionOptions || []
    if (!directions.length) continue

    for (let directionIndex = 0; directionIndex < directions.length; directionIndex += 1) {
      const direction = directions[directionIndex]
      const model = buildVehicleHudRenderModel(project, {
        lineId: line.id,
        directionKey: direction.key,
        route,
      })
      if (!model.ready) continue

      const hudSvg = buildVehicleHudSvg(model)
      const hudPng = await svgToPngBlob(hudSvg, { scale })
      const directionName =
        direction.labelZh || direction.labelEn || direction.key || `direction_${directionIndex + 1}`
      const directionFile = sanitizeZipSegment(directionName, `direction_${directionIndex + 1}`)
      const path = ensureUniqueZipPath(`车辆HUD/${lineFolder}/${directionFile}.png`, usedPaths)
      zip.file(path, hudPng)
      exportedCount += 1
    }
  }

  if (!exportedCount) {
    throw new Error('没有可导出的车辆 HUD')
  }

  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
  downloadBlob(zipBlob, `${sanitizeFileName(project?.name, 'railmap')}_车辆HUD打包.zip`)
  return { exportedCount }
}

function ensureUniqueZipPath(path, usedPaths) {
  if (!usedPaths.has(path)) {
    usedPaths.add(path)
    return path
  }

  const dotIndex = path.lastIndexOf('.')
  const base = dotIndex >= 0 ? path.slice(0, dotIndex) : path
  const ext = dotIndex >= 0 ? path.slice(dotIndex) : ''
  let suffix = 2
  let candidate = `${base}_${suffix}${ext}`
  while (usedPaths.has(candidate)) {
    suffix += 1
    candidate = `${base}_${suffix}${ext}`
  }
  usedPaths.add(candidate)
  return candidate
}

async function svgToPngBlob(svg, options = {}) {
  const scale = Number.isFinite(options.scale) ? Math.max(1, options.scale) : 2
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)
  try {
    const image = new Image()
    await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = reject
      image.src = url
    })

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('PNG 导出失败: 无法创建画布上下文')
    }
    context.scale(scale, scale)
    context.drawImage(image, 0, 0)

    const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!pngBlob) {
      throw new Error('PNG 导出失败')
    }
    return pngBlob
  } finally {
    URL.revokeObjectURL(url)
  }
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

function sanitizeFileName(value, fallback = 'file') {
  const raw = String(value || '').trim()
  const sanitized = raw
    .replace(/[\\/:%*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '')
    .trim()
  return sanitized || fallback
}

function sanitizeZipSegment(value, fallback = 'item') {
  return sanitizeFileName(value, fallback).replaceAll('/', '_')
}

function buildVehicleHudSvg(model) {
  const chevrons = model.chevrons
    .map(
      (mark) =>
        `<g><use href="#hudChevron" transform="translate(${mark.x} ${mark.y}) rotate(${mark.angle})" /><use href="#hudChevron" transform="translate(${mark.x + 9} ${mark.y}) rotate(${mark.angle})" /></g>`,
    )
    .join('\n')

  const stations = model.stations
    .map((station) => {
      const interchangeCircle = station.isInterchange
        ? `<circle cx="${station.x}" cy="${station.y}" r="14.2" fill="#f9fcff" stroke="${escapeXml(model.lineColor)}" stroke-width="2.6" />`
        : ''

      const callout = station.isInterchange
        ? buildHudStationCalloutSvg(station)
        : ''

      const zhTransform = `rotate(${station.labelAngle} ${station.labelX} ${station.labelY})`
      const enTransform = `rotate(${station.labelAngle} ${station.labelX} ${station.labelEnY})`
      const enLabel = station.nameEn
        ? `<text x="${station.labelX}" y="${station.labelEnY}" text-anchor="${station.labelAnchor}" transform="${enTransform}" fill="#11263e" font-size="17" font-weight="700" letter-spacing="0.02em">${escapeXml(String(station.nameEn).toUpperCase())}</text>`
        : ''

      return `
<g>
  <circle cx="${station.x}" cy="${station.y}" r="20.2" fill="#ffffff" stroke="${escapeXml(model.lineColor)}" stroke-width="6" />
  ${interchangeCircle}
  ${callout}
  <text x="${station.labelX}" y="${station.labelY}" text-anchor="${station.labelAnchor}" transform="${zhTransform}" fill="#11263e" font-size="26" font-weight="700">${escapeXml(station.nameZh)}</text>
  ${enLabel}
</g>`
    })
    .join('\n')

  const terminalText = model.terminalNameZh
    ? `<text x="314" y="101" fill="#45617b" font-size="18">终点 ${escapeXml(model.terminalNameZh)}</text>`
    : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${model.width}" height="${model.height}" viewBox="0 0 ${model.width} ${model.height}">
  <defs>
    <linearGradient id="hudBg" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#f2f7fe" />
      <stop offset="100%" stop-color="#e6eef8" />
    </linearGradient>
    <filter id="hudShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="2.2" flood-color="#000000" flood-opacity="0.13" />
    </filter>
    <g id="hudChevron">
      <path d="M -7 -7 L 0 0 L -7 7" fill="none" stroke="#f5fbff" stroke-width="2.8" stroke-linecap="round" />
    </g>
  </defs>

  <rect width="100%" height="100%" fill="url(#hudBg)" />
  <g opacity="0.22">
    <path d="M0 400 L110 360 L170 380 L230 320 L300 350 L380 300 L430 340 L520 260 L620 330 L710 290 L780 345 L860 280 L940 355 L1010 310 L1090 350 L1170 285 L1260 360 L1340 300 L1410 345 L1490 280 L1580 355 L1660 320 L1730 360 L1810 330 L1920 385 L1920 620 L0 620 Z" fill="#bfd4ec" />
  </g>

  <g>
    <rect x="34" y="26" width="${model.width - 68}" height="${model.height - 52}" rx="20" fill="#ffffff" opacity="0.9" />

    <rect x="64" y="42" width="220" height="62" rx="10" fill="${escapeXml(model.lineColor)}" />
    <text x="84" y="80" fill="#ffffff" font-size="30" font-weight="700">${escapeXml(model.lineNameZh || '')}</text>

    <text x="314" y="72" fill="#12324c" font-size="31" font-weight="700">${escapeXml(model.directionLabelZh || '')}</text>
    ${terminalText}

    <path d="${model.trackPath}" fill="none" stroke="#ffffff" stroke-width="22" stroke-linecap="round" stroke-linejoin="round" filter="url(#hudShadow)" />
    <path d="${model.trackPath}" fill="none" stroke="${escapeXml(model.lineColor)}" stroke-width="13" stroke-linecap="round" stroke-linejoin="round" />

    ${chevrons}
    ${stations}
  </g>
</svg>`
}

function buildHudStationCalloutSvg(station) {
  const triangleColor = station.transferBadges?.[0]?.color || '#e6b460'
  const badges = (station.transferBadges || [])
    .map((badge, index) => {
      const offsetY = station.transferCalloutDirection > 0 ? index * 30 : index * -30
      const badgeY = station.transferBadgeY + offsetY
      return `
<g>
  <rect x="${station.x - badge.badgeWidth / 2}" y="${badgeY}" width="${badge.badgeWidth}" height="26" rx="6" fill="${escapeXml(badge.color || '#d5ab4f')}" stroke="#ffffff" stroke-width="1.1" />
  <text x="${station.x}" y="${badgeY + 18}" text-anchor="middle" fill="#ffffff" font-size="16" font-weight="800">${escapeXml(
        badge.text || '?',
      )}</text>
</g>`
    })
    .join('\n')

  return `
<g>
  <path d="M ${station.x - 7} ${station.connectorDotY} L ${station.x + 7} ${station.connectorDotY} L ${station.x} ${station.connectorDotY + station.transferCalloutDirection * 14} Z" fill="${escapeXml(triangleColor)}" stroke="#ffffff" stroke-width="1.1" />
  <text x="${station.x}" y="${station.transferLabelZhY}" text-anchor="middle" fill="#14283e" font-size="18" font-weight="700">换乘</text>
  <text x="${station.x}" y="${station.transferLabelEnY}" text-anchor="middle" fill="#516984" font-size="13" font-weight="600">Transfer</text>
  ${badges}
</g>`
}
