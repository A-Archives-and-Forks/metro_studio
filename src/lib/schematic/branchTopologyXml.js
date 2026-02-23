/**
 * XML Serialization for Branch Topology Results
 *
 * Converts a BranchTopologyResult (from branchTopology.js) into a
 * semantically meaningful XML string.
 *
 * Schema overview:
 *
 * <MetroLine id="..." nameZh="..." nameEn="..." color="...">
 *
 *   <!-- 岔入支线（终点合入主干）：至多一条，merging INTO trunk -->
 *   <RightBranch attachTo="<trunkStartStationId>">
 *     <Station id="..." nameZh="..." nameEn="..." transferLineNamesZh="..." transferLineNamesEn="..." />
 *     ...
 *   </RightBranch>
 *
 *   <Trunk>
 *     <Station id="..." nameZh="..." nameEn="..." transferLineNamesZh="..." transferLineNamesEn="..." />
 *     ...
 *   </Trunk>
 *
 *   <!-- Zero or more interval branches, at the same level as Trunk -->
 *   <BranchInterval fromStation="..." toStation="...">
 *     <Station id="..." nameZh="..." nameEn="..." transferLineNamesZh="..." transferLineNamesEn="..." />
 *     ...
 *   </BranchInterval>
 *
 *   <!-- 岔出支线（从主干终点分出）：至多一条，branching OUT from trunk -->
 *   <LeftBranch attachTo="<trunkEndStationId>">
 *     <Station id="..." nameZh="..." nameEn="..." transferLineNamesZh="..." transferLineNamesEn="..." />
 *     ...
 *   </LeftBranch>
 *
 * </MetroLine>
 *
 * For loop (cycle) lines:
 *
 * <MetroLine id="..." nameZh="..." nameEn="..." color="..." isLoop="true">
 *   <Loop>
 *     <Station id="..." nameZh="..." nameEn="..." />
 *     ...
 *   </Loop>
 * </MetroLine>
 *
 * @module branchTopologyXml
 */

import { analyzeLineBranchTopology } from './branchTopology.js'

// ─── XML utility helpers ──────────────────────────────────────────────────────

/**
 * Escape special XML characters in an attribute or text value.
 * @param {string} value
 * @returns {string}
 */
function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Build an XML attribute string from a plain object.
 * @param {Record<string, string|number|null|undefined>} attrs
 * @returns {string}
 */
function xmlAttrs(attrs) {
  return Object.entries(attrs)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}="${escapeXml(v)}"`)
    .join(' ')
}

/**
 * Serialize a single <Station> element.
 * @param {import('../projectModel').RailStation} station
 * @param {Map<string, import('../projectModel').RailLine>} lineById
 * @param {string} currentLineId
 * @param {string} indent
 * @returns {string}
 */
function serializeStation(station, lineById, currentLineId, indent = '    ') {
  const transferLineIds = Array.isArray(station.transferLineIds) ? station.transferLineIds : []
  const effectiveTransferLineIds = transferLineIds.filter((lineId) => lineId && lineId !== currentLineId)
  const transferLineNamesZh = effectiveTransferLineIds
    .map((lineId) => lineById.get(lineId)?.nameZh || lineId)
    .join('|')
  const transferLineNamesEn = effectiveTransferLineIds
    .map((lineId) => lineById.get(lineId)?.nameEn || lineId)
    .join('|')

  const attrs = xmlAttrs({
    id: station.id,
    nameZh: station.nameZh || '',
    nameEn: station.nameEn || '',
    transferLineNamesZh: transferLineNamesZh || undefined,
    transferLineNamesEn: transferLineNamesEn || undefined,
  })
  return `${indent}<Station ${attrs} />`
}

// ─── Per-component serializer ─────────────────────────────────────────────────

/**
 * Serialize one component's BranchTopologyResult into a <MetroLine> XML element.
 *
 * @param {import('./branchTopology').BranchTopologyResult & { componentIndex: number }} result
 * @param {import('../projectModel').RailLine} line
 * @param {Map<string, import('../projectModel').RailStation>} stationById
 * @param {Map<string, import('../projectModel').RailLine>} lineById
 * @param {string} [baseIndent='']
 * @returns {string}
 */
function serializeComponent(result, line, stationById, lineById, baseIndent = '') {
  const i1 = baseIndent + '  '
  const i2 = baseIndent + '    '
  const i3 = baseIndent + '      '

  const lineAttrs = xmlAttrs({
    id: line.id,
    nameZh: line.nameZh || '',
    nameEn: line.nameEn || '',
    color: line.color || '',
    componentIndex: result.componentIndex > 0 ? result.componentIndex : undefined,
  })

  const lines = []

  // ── 环线（简单环）──────────────────────────────────────────────────────────
  if (result.isLoop) {
    const loopLineAttrs = xmlAttrs({
      id: line.id,
      nameZh: line.nameZh || '',
      nameEn: line.nameEn || '',
      color: line.color || '',
      isLoop: 'true',
      componentIndex: result.componentIndex > 0 ? result.componentIndex : undefined,
    })
    lines.push(`${baseIndent}<MetroLine ${loopLineAttrs}>`)
    lines.push(`${i1}<Loop>`)
    for (const sid of result.trunkStationIds) {
      const st = stationById.get(sid)
      if (st) lines.push(serializeStation(st, lineById, line.id, i2))
    }
    lines.push(`${i1}</Loop>`)
    lines.push(`${baseIndent}</MetroLine>`)
    return lines.join('\n')
  }

  lines.push(`${baseIndent}<MetroLine ${lineAttrs}>`)

  // ── 岔入支线（fromIndex = -1，tip 合入主干，上海地铁规范称 RightBranch）──────────────────
  const branchInInterval = (result.intervals || []).find((iv) => iv.fromIndex === -1)
  if (branchInInterval && branchInInterval.stationIds.length > 0) {
    lines.push(`${i1}<RightBranch attachTo="${escapeXml(branchInInterval.toStationId)}">`)
    for (const sid of branchInInterval.stationIds) {
      const st = stationById.get(sid)
      if (st) lines.push(serializeStation(st, lineById, line.id, i2))
    }
    lines.push(`${i1}</RightBranch>`)
    lines.push('')
  }

  // ── Trunk ──────────────────────────────────────────────────────────────────
  // Collect closed intervals (both endpoints on trunk) for emission after <Trunk>
  /** @type {Map<number, import('./branchTopology').BranchInterval[]>} */
  const intervalsByFromIndex = new Map()
  for (const interval of result.intervals || []) {
    if (interval.fromIndex < 0 || !isFinite(interval.toIndex)) continue
    const fromIndex = interval.fromIndex
    if (!intervalsByFromIndex.has(fromIndex)) intervalsByFromIndex.set(fromIndex, [])
    intervalsByFromIndex.get(fromIndex).push(interval)
  }

  lines.push(`${i1}<Trunk>`)
  for (let idx = 0; idx < result.trunkStationIds.length; idx++) {
    const sid = result.trunkStationIds[idx]
    const st = stationById.get(sid)
    if (st) lines.push(serializeStation(st, lineById, line.id, i2))
  }
  lines.push(`${i1}</Trunk>`)

  // ── BranchIntervals（与 Trunk 平级）────────────────────────────────────────
  const sortedFromIndices = [...intervalsByFromIndex.keys()].sort((a, b) => a - b)
  for (const fromIdx of sortedFromIndices) {
    const intervalsHere = intervalsByFromIndex.get(fromIdx) || []
    for (const interval of intervalsHere) {
      lines.push('')
      lines.push(
        `${i1}<BranchInterval fromStation="${escapeXml(interval.fromStationId)}" toStation="${escapeXml(interval.toStationId)}">`,
      )
      for (const branchSid of interval.stationIds) {
        const branchSt = stationById.get(branchSid)
        if (branchSt) lines.push(serializeStation(branchSt, lineById, line.id, i2))
      }
      lines.push(`${i1}</BranchInterval>`)
    }
  }

  // ── 岔出支线（toIndex = Infinity，从主干终点分出，上海地铁规范称 LeftBranch）─────────────
  const branchOutInterval = (result.intervals || []).find((iv) => !isFinite(iv.toIndex))
  if (branchOutInterval && branchOutInterval.stationIds.length > 0) {
    lines.push('')
    lines.push(`${i1}<LeftBranch attachTo="${escapeXml(branchOutInterval.fromStationId)}">`)
    for (const sid of branchOutInterval.stationIds) {
      const st = stationById.get(sid)
      if (st) lines.push(serializeStation(st, lineById, line.id, i2))
    }
    lines.push(`${i1}</LeftBranch>`)
  }

  lines.push(`${baseIndent}</MetroLine>`)
  return lines.join('\n')
}

// ─── Error element ─────────────────────────────────────────────────────────────

/**
 * Produce an <InvalidComponent> element for a failed analysis result.
 * @param {object} result
 * @param {import('../projectModel').RailLine} line
 * @param {string} [baseIndent='']
 * @returns {string}
 */
function serializeInvalidComponent(result, line, baseIndent = '') {
  const attrs = xmlAttrs({
    lineId: line.id,
    componentIndex: result.componentIndex,
    reason: result.reason || '未知错误',
  })
  return `${baseIndent}<InvalidComponent ${attrs} />`
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Serialize the branch topology of ALL connected components of a line to XML.
 *
 * @param {import('../projectModel').RailProject} project
 * @param {string} lineId
 * @returns {string}  complete XML document string
 */
export function serializeLineBranchTopologyXml(project, lineId) {
  const line = (project?.lines || []).find((l) => l.id === lineId)
  if (!line) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<Error reason="线路不存在" lineId="${escapeXml(lineId)}" />`
  }

  const stationById = new Map((project?.stations || []).map((s) => [s.id, s]))
  const lineById = new Map((project?.lines || []).map((l) => [l.id, l]))
  const results = analyzeLineBranchTopology(project, lineId)

  const xmlParts = ['<?xml version="1.0" encoding="UTF-8"?>']

  if (results.length === 1) {
    // Single component: emit MetroLine as root element
    const result = results[0]
    if (!result.valid) {
      xmlParts.push(serializeInvalidComponent(result, line))
    } else {
      xmlParts.push(serializeComponent(result, line, stationById, lineById))
    }
  } else {
    // Multiple components: wrap in <MetroLineComponents>
    xmlParts.push(`<MetroLineComponents lineId="${escapeXml(lineId)}" count="${results.length}">`)
    for (const result of results) {
      if (!result.valid) {
        xmlParts.push(serializeInvalidComponent(result, line, '  '))
      } else {
        xmlParts.push(serializeComponent(result, line, stationById, lineById, '  '))
      }
    }
    xmlParts.push('</MetroLineComponents>')
  }

  return xmlParts.join('\n')
}

/**
 * Serialize branch topology for ALL lines in a project to a single XML document.
 *
 * @param {import('../projectModel').RailProject} project
 * @returns {string}
 */
export function serializeProjectBranchTopologyXml(project) {
  const lines = project?.lines || []
  const stationById = new Map((project?.stations || []).map((s) => [s.id, s]))
  const lineById = new Map((project?.lines || []).map((l) => [l.id, l]))

  const xmlParts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<MetroProject name="${escapeXml(project?.name || '')}" id="${escapeXml(project?.id || '')}">`,
  ]

  for (const line of lines) {
    const results = analyzeLineBranchTopology(project, line.id)

    if (results.length === 0) continue

    if (results.length === 1) {
      const result = results[0]
      if (!result.valid) {
        xmlParts.push(serializeInvalidComponent(result, line, '  '))
      } else {
        xmlParts.push(serializeComponent(result, line, stationById, lineById, '  '))
      }
    } else {
      xmlParts.push(
        `  <MetroLineComponents lineId="${escapeXml(line.id)}" nameZh="${escapeXml(line.nameZh || '')}" count="${results.length}">`,
      )
      for (const result of results) {
        if (!result.valid) {
          xmlParts.push(serializeInvalidComponent(result, line, '    '))
        } else {
          xmlParts.push(serializeComponent(result, line, stationById, lineById, '    '))
        }
      }
      xmlParts.push('  </MetroLineComponents>')
    }
  }

  xmlParts.push('</MetroProject>')
  return xmlParts.join('\n')
}
