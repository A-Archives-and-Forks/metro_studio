/**
 * RMG (Rail Map Generator) Configuration File Serializer
 *
 * Converts BranchTopologyResult + metro_studio project data into a
 * RMG-compatible JSON configuration file (.json) that can be imported
 * directly into https://railmapgen.github.io/rmg/
 *
 * Handles:
 *  - Simple trunk lines (linestart → stations → lineend)
 *  - Lines with left/right hanging branches (fork at a trunk node)
 *  - Loop/cycle lines (loop: true)
 *
 * @module branchTopologyRmg
 */

import { analyzeLineBranchTopology } from './branchTopology.js'

// ─── ID generation ───────────────────────────────────────────────────────────

const NANOID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** Generate a short random ID (6 chars, matching RMG convention) */
function nanoid6() {
  let id = ''
  for (let i = 0; i < 6; i++) {
    id += NANOID_CHARS[Math.floor(Math.random() * NANOID_CHARS.length)]
  }
  return id
}

/**
 * Build a stable mapping from metro_studio station IDs to short RMG IDs.
 * @param {string[]} stationIds
 * @returns {Map<string, string>}
 */
function buildIdMap(stationIds) {
  const map = new Map()
  const used = new Set(['linestart', 'lineend'])
  for (const sid of stationIds) {
    if (map.has(sid)) continue
    let rmgId
    do { rmgId = nanoid6() } while (used.has(rmgId))
    used.add(rmgId)
    map.set(sid, rmgId)
  }
  return map
}

// ─── Color helpers ───────────────────────────────────────────────────────────

/**
 * Decide appropriate foreground color for a given background hex color.
 * Uses relative luminance formula.
 * @param {string} hexColor  e.g. "#C6AFD4"
 * @returns {"#000" | "#fff"}
 */
function contrastForeground(hexColor) {
  if (!hexColor || hexColor[0] !== '#') return '#000'
  const hex = hexColor.replace('#', '')
  const r = parseInt(hex.substring(0, 2), 16) / 255
  const g = parseInt(hex.substring(2, 4), 16) / 255
  const b = parseInt(hex.substring(4, 6), 16) / 255
  // sRGB relative luminance
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 0.5 ? '#000' : '#fff'
}

/**
 * Build a RMG theme tuple from a line object.
 * @param {object} line  { id, nameZh, nameEn, color }
 * @returns {[string, string, string, string]}  [cityId, lineId, color, fgColor]
 */
function buildTheme(line) {
  const color = line.color || '#999999'
  return ['other', line.id || 'line', color, contrastForeground(color)]
}

// ─── Station builder ─────────────────────────────────────────────────────────

/**
 * Build a single RMG StationInfo object.
 *
 * @param {object} station         metro_studio RailStation
 * @param {string[]} parentRmgIds  RMG IDs of parent stations
 * @param {string[]} childRmgIds   RMG IDs of child stations
 * @param {object} options
 * @param {object} [options.branch]       branch descriptor if this is a fork node
 * @param {boolean} [options.loopPivot]   mark as loop pivot
 * @param {Map<string, object>} options.lineById  lineId → line object
 * @param {string} options.currentLineId
 * @returns {object}  RMG StationInfo
 */
function buildStationInfo(station, parentRmgIds, childRmgIds, options = {}) {
  const { branch, loopPivot, lineById, currentLineId } = options

  // Transfer lines (换乘信息)
  const transferLineIds = Array.isArray(station.transferLineIds) ? station.transferLineIds : []
  const effectiveTransferIds = transferLineIds.filter((lid) => lid && lid !== currentLineId)

  const transferLines = effectiveTransferIds
    .map((lid) => {
      const l = lineById?.get(lid)
      if (!l) return null
      return {
        theme: buildTheme(l),
        name: [l.nameZh || lid, l.nameEn || lid],
      }
    })
    .filter(Boolean)

  const transferGroup = transferLines.length > 0 ? { lines: transferLines } : {}

  const info = {
    parents: parentRmgIds,
    children: childRmgIds,
    num: '00',
    transfer: {
      tick_direc: 'r',
      paid_area: true,
      groups: [transferGroup],
    },
    services: ['local'],
    loop_pivot: loopPivot || false,
    one_line: true,
    int_padding: 250,
    localisedName: {
      zh: station.nameZh || station.id,
      en: station.nameEn || '',
    },
    character_spacing: 75,
  }

  if (branch) {
    info.branch = branch
  }

  // For stations with long names, use multi-line display
  if ((station.nameZh || '').length > 5 || (station.nameEn || '').length > 20) {
    info.one_line = false
    info.int_padding = 140
  }

  return info
}

// ─── Trunk + branch serialization (non-loop) ────────────────────────────────

/**
 * Build a complete RMG stn_list for a non-loop line topology.
 *
 * The approach:
 *  1. Map the trunk as a linear chain:  linestart → trunk[0] → ... → trunk[N-1] → lineend
 *  2. For each interval with fromIndex=-1 (left/岔入 branch): attach a branch
 *     chain arriving at the trunk start (via branch.right on linestart).
 *  3. For each interval with toIndex=Infinity (right/岔出 branch): attach a branch
 *     chain departing from the trunk end.
 *  4. For other intervals (closed): splice the branch as a parallel path between
 *     the fork and rejoin trunk nodes, using branch.left on the fork node.
 *
 * RMG branch convention:
 *  - `branch.right` → station has 2 children (fork/split):
 *    `branch.right = ["through", <trunkChildId>]` identifies the trunk continuation
 *  - `branch.left`  → station has 2 parents (merge/rejoin):
 *    `branch.left = ["through", <trunkParentId>]` identifies the trunk continuation
 *
 * @param {import('./branchTopology').BranchTopologyResult} result
 * @param {Map<string, object>} stationById
 * @param {Map<string, object>} lineById
 * @param {string} currentLineId
 * @returns {{ stnList: object, idMap: Map<string, string> }}
 */
function buildNonLoopStnList(result, stationById, lineById, currentLineId) {
  const allStationIds = [
    ...result.trunkStationIds,
    ...(result.intervals || []).flatMap((iv) => iv.stationIds || []),
    ...(result.midBranches || []).flatMap((mb) => mb.stationIds || []),
  ]
  const idMap = buildIdMap(allStationIds)
  const rmg = (sid) => idMap.get(sid)

  const stnList = {}

  // ── Identify branches ──
  const leftBranch = (result.intervals || []).find((iv) => iv.fromIndex === -1)
  const rightBranch = (result.intervals || []).find((iv) => !isFinite(iv.toIndex))

  // ── Build trunk chain ──
  const trunkIds = result.trunkStationIds
  const trunkRmgIds = trunkIds.map(rmg)

  // Find closed intervals (fork from trunk, rejoin trunk)
  const closedIntervals = (result.intervals || []).filter(
    (iv) => iv.fromIndex >= 0 && isFinite(iv.toIndex),
  )

  // Build a set of trunk indices that are fork points (have a closed interval departing)
  const forkFromIndex = new Map() // trunkIndex → interval
  for (const iv of closedIntervals) {
    forkFromIndex.set(iv.fromIndex, iv)
  }
  const rejoinToIndex = new Map() // trunkIndex → interval
  for (const iv of closedIntervals) {
    rejoinToIndex.set(iv.toIndex, iv)
  }

  // ── linestart ──
  {
    let children
    let branch
    if (leftBranch && leftBranch.stationIds.length > 0) {
      // Left branch: linestart → two children: branchFirst then trunkFirst
      // Branch child must be at index 0 so RMG indexOf finds it correctly
      const branchFirstRmg = rmg(leftBranch.stationIds[0])
      children = [branchFirstRmg, trunkRmgIds[0]]
      branch = { right: ['through', branchFirstRmg] }
    } else {
      children = [trunkRmgIds[0]]
    }
    stnList['linestart'] = {
      parents: [],
      children,
      ...(branch ? { branch } : {}),
      transfer: { tick_direc: 'r', paid_area: true, groups: [{}] },
      services: ['local'],
      num: '00',
      loop_pivot: false,
      one_line: true,
      int_padding: 250,
      localisedName: { zh: '路綫左端', en: 'LEFT END' },
      character_spacing: 75,
    }
  }

  // ── Trunk stations ──
  for (let i = 0; i < trunkIds.length; i++) {
    const sid = trunkIds[i]
    const station = stationById.get(sid)
    if (!station) continue

    // Determine parents
    // Branch parent must come first (index 0) so RMG indexOf identifies it correctly
    const parentRmgIds = []
    let hasBranchParent = false
    // If this trunk node is the rejoin point of a closed interval, add branch parent first
    const rejoinIv = rejoinToIndex.get(i)
    if (rejoinIv && rejoinIv.stationIds.length > 0) {
      parentRmgIds.push(rmg(rejoinIv.stationIds[rejoinIv.stationIds.length - 1]))
      hasBranchParent = true
    }
    // If this is the attach point of the left branch (toStationId), add branch last station as parent first
    if (leftBranch && leftBranch.toStationId === sid && leftBranch.stationIds.length > 0) {
      parentRmgIds.push(rmg(leftBranch.stationIds[leftBranch.stationIds.length - 1]))
      hasBranchParent = true
    }
    // Then add the trunk continuation parent
    if (i === 0) {
      parentRmgIds.push('linestart')
    } else {
      parentRmgIds.push(trunkRmgIds[i - 1])
    }

    // Determine children
    // Branch child must come first (index 0) so RMG indexOf identifies it correctly
    const childRmgIds = []
    let hasBranchChild = false
    // If this trunk node is the fork point of a closed interval, add branch child first
    const forkIv = forkFromIndex.get(i)
    if (forkIv && forkIv.stationIds.length > 0) {
      childRmgIds.push(rmg(forkIv.stationIds[0]))
      hasBranchChild = true
    }
    // If this is the attach point of the right branch (fromStationId), add branch first station as child
    if (rightBranch && rightBranch.fromStationId === sid && rightBranch.stationIds.length > 0) {
      childRmgIds.push(rmg(rightBranch.stationIds[0]))
      hasBranchChild = true
    }
    // Then add the trunk continuation child
    if (i < trunkIds.length - 1) {
      childRmgIds.push(trunkRmgIds[i + 1])
    } else {
      childRmgIds.push('lineend')
    }

    // Branch descriptor for fork/merge nodes
    // RMG convention: right = children-side fork, left = parents-side merge
    let branch
    if (childRmgIds.length === 2) {
      // Fork: 2 children → branch.right, branch child is at index 0
      branch = { right: ['through', childRmgIds[0]] }
    }
    if (parentRmgIds.length === 2) {
      // Merge: 2 parents → branch.left, branch parent is at index 0
      branch = { ...(branch || {}), left: ['through', parentRmgIds[0]] }
    }

    stnList[trunkRmgIds[i]] = buildStationInfo(station, parentRmgIds, childRmgIds, {
      branch,
      lineById,
      currentLineId,
    })
  }

  // ── Left branch stations (岔入支线) ──
  if (leftBranch && leftBranch.stationIds.length > 0) {
    const branchSids = leftBranch.stationIds
    for (let j = 0; j < branchSids.length; j++) {
      const sid = branchSids[j]
      const station = stationById.get(sid)
      if (!station) continue

      const parents = j === 0 ? ['linestart'] : [rmg(branchSids[j - 1])]
      const children = j < branchSids.length - 1
        ? [rmg(branchSids[j + 1])]
        : [rmg(leftBranch.toStationId)] // rejoin trunk

      stnList[rmg(sid)] = buildStationInfo(station, parents, children, {
        lineById,
        currentLineId,
      })
    }
  }

  // ── Right branch stations (岔出支线) ──
  if (rightBranch && rightBranch.stationIds.length > 0) {
    const branchSids = rightBranch.stationIds
    for (let j = 0; j < branchSids.length; j++) {
      const sid = branchSids[j]
      const station = stationById.get(sid)
      if (!station) continue

      const parents = j === 0 ? [rmg(rightBranch.fromStationId)] : [rmg(branchSids[j - 1])]
      const children = j < branchSids.length - 1 ? [rmg(branchSids[j + 1])] : ['lineend']

      stnList[rmg(sid)] = buildStationInfo(station, parents, children, {
        lineById,
        currentLineId,
      })
    }
  }

  // ── Closed interval branch stations ──
  for (const iv of closedIntervals) {
    const branchSids = iv.stationIds
    for (let j = 0; j < branchSids.length; j++) {
      const sid = branchSids[j]
      const station = stationById.get(sid)
      if (!station) continue

      const parents = j === 0 ? [rmg(iv.fromStationId)] : [rmg(branchSids[j - 1])]
      const children = j < branchSids.length - 1
        ? [rmg(branchSids[j + 1])]
        : [rmg(iv.toStationId)] // rejoin trunk

      stnList[rmg(sid)] = buildStationInfo(station, parents, children, {
        lineById,
        currentLineId,
      })
    }
  }

  // ── lineend ──
  {
    const parents = []
    if (rightBranch && rightBranch.stationIds.length > 0) {
      // Right branch ends at lineend
      parents.push(rmg(rightBranch.stationIds[rightBranch.stationIds.length - 1]))
      parents.push(trunkRmgIds[trunkRmgIds.length - 1])
    } else {
      parents.push(trunkRmgIds[trunkRmgIds.length - 1])
    }
    // lineend with 2 parents needs branch.left to identify the branch-side parent
    const lineEndBranch = parents.length === 2 ? { left: ['through', parents[0]] } : undefined
    stnList['lineend'] = {
      parents,
      children: [],
      ...(lineEndBranch ? { branch: lineEndBranch } : {}),
      transfer: { tick_direc: 'r', paid_area: true, groups: [{}] },
      services: ['local'],
      num: '00',
      loop_pivot: false,
      one_line: true,
      int_padding: 250,
      localisedName: { zh: '路綫右端', en: 'RIGHT END' },
      character_spacing: 75,
    }
  }

  return { stnList, idMap }
}

// ─── Loop serialization ──────────────────────────────────────────────────────

/**
 * Build a complete RMG stn_list for a loop/cycle line.
 *
 * RMG loop convention (from the Line 4 sample):
 *  - `loop: true`
 *  - linestart.children = [firstStation]
 *  - lineend.parents = [lastStation]
 *  - The first station's parents = ["linestart"]
 *  - The last station's children = ["lineend"]
 *  - In the station chain, the "last" station also circles back conceptually,
 *    but RMG uses linestart/lineend as virtual anchors.
 *  - Key transfer stations can be marked `loop_pivot: true` to control the
 *    visual layout breakpoints.
 *
 * @param {import('./branchTopology').BranchTopologyResult} result
 * @param {Map<string, object>} stationById
 * @param {Map<string, object>} lineById
 * @param {string} currentLineId
 * @returns {{ stnList: object, idMap: Map<string, string> }}
 */
function buildLoopStnList(result, stationById, lineById, currentLineId) {
  const loopIds = result.trunkStationIds
  const idMap = buildIdMap(loopIds)
  const rmg = (sid) => idMap.get(sid)

  const loopRmgIds = loopIds.map(rmg)
  const stnList = {}

  // ── linestart ──
  stnList['linestart'] = {
    parents: [],
    children: [loopRmgIds[0]],
    transfer: { tick_direc: 'r', paid_area: true, groups: [{}] },
    services: ['local'],
    num: '00',
    loop_pivot: false,
    one_line: true,
    int_padding: 250,
    localisedName: { zh: '路綫左端', en: 'LEFT END' },
    character_spacing: 75,
  }

  // ── Loop stations ──
  // Heuristic for loop_pivot: mark stations with >= 2 transfer lines as pivots
  for (let i = 0; i < loopIds.length; i++) {
    const sid = loopIds[i]
    const station = stationById.get(sid)
    if (!station) continue

    const parents = i === 0 ? ['linestart'] : [loopRmgIds[i - 1]]
    const children = i < loopIds.length - 1 ? [loopRmgIds[i + 1]] : ['lineend']

    // loop_pivot heuristic: stations with >= 2 transfer lines
    const transferCount = (station.transferLineIds || []).filter(
      (lid) => lid && lid !== currentLineId,
    ).length
    const isLoopPivot = transferCount >= 2

    stnList[loopRmgIds[i]] = buildStationInfo(station, parents, children, {
      loopPivot: isLoopPivot,
      lineById,
      currentLineId,
    })
  }

  // ── lineend ──
  stnList['lineend'] = {
    parents: [loopRmgIds[loopRmgIds.length - 1]],
    children: [],
    transfer: { tick_direc: 'r', paid_area: true, groups: [{}] },
    services: ['local'],
    num: '00',
    loop_pivot: false,
    one_line: true,
    int_padding: 250,
    localisedName: { zh: '路綫右端', en: 'RIGHT END' },
    character_spacing: 75,
  }

  return { stnList, idMap }
}

// ─── Top-level RMG config builder ────────────────────────────────────────────

/**
 * Build a complete RMG configuration JSON object for a given line.
 *
 * Uses the first valid connected component from the topology analysis.
 * If no valid component exists, returns null.
 *
 * @param {import('../../stores/projectStore').RailProject} project
 * @param {string} lineId
 * @returns {object|null}  RMG configuration object, or null if not available
 */
export function buildRmgConfig(project, lineId) {
  const lines = project?.lines || []
  const stations = project?.stations || []

  const line = lines.find((l) => l.id === lineId)
  if (!line) return null

  const stationById = new Map(stations.map((s) => [s.id, s]))
  const lineById = new Map(lines.map((l) => [l.id, l]))

  const results = analyzeLineBranchTopology(project, lineId)
  // Use first valid component
  const result = results.find((r) => r.valid)
  if (!result) return null

  const isLoop = result.isLoop === true
  const { stnList } = isLoop
    ? buildLoopStnList(result, stationById, lineById, lineId)
    : buildNonLoopStnList(result, stationById, lineById, lineId)

  const theme = buildTheme(line)
  const lineNameZh = line.nameZh || ''
  const lineNameEn = line.nameEn || ''

  // Determine canvas width based on station count
  const stationCount = result.trunkStationIds.length
  const railmapWidth = Math.max(2400, Math.min(6000, stationCount * 100))

  // Pick the first real station as current station
  const firstRealStnId = Object.keys(stnList).find(
    (k) => k !== 'linestart' && k !== 'lineend',
  )

  const config = {
    style: 'shmetro',
    svg_height: isLoop ? 675 : 450,
    padding: isLoop ? 8.75 : 5,
    y_pc: 40,
    theme,
    direction: 'l',
    current_stn_idx: firstRealStnId || 'linestart',
    platform_num: '',
    stn_list: stnList,
    line_name: [lineNameZh, lineNameEn],
    psd_num: '1',
    line_num: '',
    info_panel_type: 'sh2020',
    direction_gz_x: 50,
    direction_gz_y: 70,
    customiseMTRDest: { isLegacy: false, terminal: false },
    svgWidth: {
      destination: 1500,
      runin: 1500,
      railmap: railmapWidth,
      indoor: Math.round(railmapWidth * 1.25),
      platform: 1200,
    },
    namePosMTR: { isStagger: true, isFlip: true },
    coline: {},
    loop: isLoop,
    loop_info: {
      bank: true,
      left_and_right_factor: isLoop ? 1 : 0,
      bottom_factor: isLoop ? Math.max(1, Math.round(stationCount / 3)) : 1,
    },
    branchSpacingPct: isLoop ? 4 : 41,
    version: '5.21.1',
    psdLabel: 'screen',
  }

  return config
}

/**
 * Serialize a RMG configuration to a formatted JSON string.
 *
 * @param {import('../../stores/projectStore').RailProject} project
 * @param {string} lineId
 * @returns {string|null}  JSON string, or null if not possible
 */
export function serializeRmgConfigJson(project, lineId) {
  const config = buildRmgConfig(project, lineId)
  if (!config) return null
  return JSON.stringify(config, null, 2)
}
