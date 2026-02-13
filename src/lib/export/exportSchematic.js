import { buildSchematicRenderModel } from '../schematic/renderModel'

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function buildSchematicSvg(project, options = {}) {
  const model = buildSchematicRenderModel(project, options)

  const edgeHaloElements = model.edgePaths
    .map(
      (edge) =>
        `<path d="${edge.pathD}" fill="none" stroke="#f8fafc" stroke-width="${edge.width + 5.4}" stroke-linecap="round" stroke-linejoin="round" opacity="${Math.min(
          1,
          edge.opacity + 0.06,
        )}" />`,
    )
    .join('\n')

  const edgeCoreElements = model.edgePaths
    .map(
      (edge) =>
        `<path d="${edge.pathD}" fill="none" stroke="${escapeXml(edge.color)}" stroke-width="${edge.width}" stroke-linecap="round" stroke-linejoin="round" opacity="${edge.opacity}" />`,
    )
    .join('\n')

  const stationElements = model.stations
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

export function downloadSvg(project) {
  const svg = buildSchematicSvg(project)
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${project.name || 'railmap'}.svg`
  anchor.click()
  URL.revokeObjectURL(url)
}

export async function downloadPng(project, options = {}) {
  const svg = buildSchematicSvg(project, options)
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)

  const image = new Image()
  const scale = options.scale || 2

  await new Promise((resolve, reject) => {
    image.onload = resolve
    image.onerror = reject
    image.src = url
  })

  const canvas = document.createElement('canvas')
  canvas.width = image.width * scale
  canvas.height = image.height * scale
  const context = canvas.getContext('2d')
  context.scale(scale, scale)
  context.drawImage(image, 0, 0)

  const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  URL.revokeObjectURL(url)

  if (!pngBlob) {
    throw new Error('PNG 导出失败')
  }

  const pngUrl = URL.createObjectURL(pngBlob)
  const anchor = document.createElement('a')
  anchor.href = pngUrl
  anchor.download = `${project.name || 'railmap'}.png`
  anchor.click()
  URL.revokeObjectURL(pngUrl)
}
