/**
 * Branch Topology Analysis for Metro Line Schematic Export
 *
 * Analyzes each connected component of a line graph and determines whether it
 * conforms to the "trunk + branch" model:
 *
 *   [LeftBranch] --- trunk_start - ... - trunk_end --- [RightBranch]
 *                                  |           |
 *                              [BranchInterval stations]
 *
 * Rules:
 *  - Exactly one "trunk" (main spine), a simple path from one end to another.
 *  - At most one left-end hanging branch (attached to trunk start, degree-1 tip).
 *  - At most one right-end hanging branch (attached to trunk end, degree-1 tip).
 *  - Zero or more mid-trunk "interval branches": a path that diverges from a
 *    trunk node and re-joins at a later trunk node.  The intervals [p,q] must be
 *    non-overlapping and non-nested (interiors disjoint).
 *  - Every node/edge that belongs to an interval branch must belong to that
 *    branch ONLY — it must not appear in any other part of the structure.
 *
 * Degree-3 junction disambiguation:
 *  For a degree-3 node, two of the three edges form the "straight-through" pair
 *  (continuation of the trunk or branch), and one is the "spur" (branch tip or
 *  interval branch start/end).  The straight-through pair is identified by the
 *  requirement that the angle between the spur edge and each of the two other
 *  edges is > BRANCH_ANGLE_THRESHOLD_DEG (default 120°).  I.e. the spur is the
 *  edge that "turns away sharply" from the two main-line edges.
 *
 * @module branchTopology
 */

// ─── Constants ──────────────────────────────────────────────────────────────

/** Minimum angle (degrees) between spur and each trunk edge at a degree-3 node */
const BRANCH_ANGLE_THRESHOLD_DEG = 115

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Return a human-readable station label: "站名(id)" if name is available, else just "id".
 * @param {string} id
 * @param {Map<string, StationLike>|null|undefined} stationById
 * @returns {string}
 */
function stnLabel(id, stationById) {
  const name = stationById?.get(id)?.nameZh
  return name ? `"${name}"(${id})` : id
}

// ─── Types (JSDoc) ──────────────────────────────────────────────────────────

/**
 * @typedef {Object} AdjEntry
 * @property {string} to
 * @property {string} edgeId
 * @property {number} weight
 */

/**
 * @typedef {Map<string, AdjEntry[]>} UndirAdjacency
 * Undirected adjacency list: nodeId -> [{to, edgeId, weight}]
 */

/**
 * @typedef {Object} DirectedEntry
 * @property {string} to
 * @property {string} edgeId
 */

/**
 * @typedef {Map<string, DirectedEntry[]>} DirAdjacency
 * Directed adjacency list: nodeId -> [{to, edgeId}]
 */

/**
 * @typedef {Object} StationLike
 * @property {string} id
 * @property {[number, number]} lngLat   [lng, lat]
 * @property {string} [nameZh]
 * @property {string} [nameEn]
 */

/**
 * @typedef {Object} EdgeLike
 * @property {string} id
 * @property {string} fromStationId
 * @property {string} toStationId
 * @property {[number,number][]} waypoints
 */

/**
 * @typedef {Object} BranchInterval
 * @property {string|null} fromStationId
 *   Trunk node where the branch diverges, or null for a left open-end branch
 *   (the branch precedes the trunk start).
 * @property {string|null} toStationId
 *   Trunk node where the branch rejoins, or null for a right open-end branch
 *   (the branch follows the trunk end).
 * @property {number} fromIndex
 *   Index of fromStationId in trunkStationIds, or -1 for a left open-end branch.
 * @property {number} toIndex
 *   Index of toStationId in trunkStationIds, or Infinity for a right open-end branch.
 * @property {string[]} stationIds    ordered station ids on the branch (NOT including trunk endpoints)
 * @property {string[]} edgeIds       all edge ids that belong to this branch path
 */

/**
 * A blind-end branch that diverges from a mid-trunk node and does NOT rejoin.
 * (The tip station has degree 1 in the component.)
 * @typedef {Object} MidHangingBranch
 * @property {string} attachToStationId  trunk node where the branch diverges
 * @property {string[]} stationIds       ordered station ids (NOT including attachTo)
 * @property {string[]} edgeIds
 */

/**
 * @typedef {Object} BranchTopologyResult
 * @property {boolean} valid
 * @property {string} [reason]          set when valid=false
 * @property {boolean} [isLoop]         true when the component is a simple loop (cycle)
 * @property {string[]} trunkStationIds ordered trunk station ids (start -> end)
 * @property {string[]} trunkEdgeIds    ordered edge ids on the trunk
 * @property {BranchInterval[]} intervals
 *   All branch intervals, including open-end ones (fromIndex=-1 or toIndex=Infinity).
 *   Sorted by fromIndex ascending.
 * @property {MidHangingBranch[]} midBranches  blind-end branches attached to mid-trunk nodes
 */

// ─── Geometry helpers ────────────────────────────────────────────────────────

/**
 * Compute the angle in degrees between two 2D vectors.
 * Returns a value in [0, 180].
 * @param {[number,number]} a
 * @param {[number,number]} b
 * @returns {number}
 */
function angleBetweenDeg(a, b) {
  const dot = a[0] * b[0] + a[1] * b[1]
  const magA = Math.hypot(a[0], a[1])
  const magB = Math.hypot(b[0], b[1])
  if (magA < 1e-12 || magB < 1e-12) return 0
  const cosVal = Math.max(-1, Math.min(1, dot / (magA * magB)))
  return (Math.acos(cosVal) * 180) / Math.PI
}

/**
 * Estimate the tangent direction of an edge at a given endpoint station.
 * Uses the first (or last) waypoint segment direction so curves are respected.
 *
 * @param {EdgeLike} edge
 * @param {string} atStationId  - which endpoint to measure tangent from
 * @param {Map<string, StationLike>} stationById
 * @returns {[number, number]}  unit-ish direction vector pointing away from atStationId
 */
function edgeTangentAt(edge, atStationId, stationById) {
  const label = `edgeTangentAt(edge=${edge?.id}, at=${atStationId})`

  const waypoints = Array.isArray(edge.waypoints) && edge.waypoints.length >= 2
    ? edge.waypoints
    : null

  const fromStation = stationById.get(edge.fromStationId)
  const toStation = stationById.get(edge.toStationId)

  // Fall back to straight-line direction if waypoints are unavailable
  if (!waypoints) {
    if (!fromStation || !toStation) {
      console.debug(`[branchTopology] ${label}: no waypoints, missing station data → fallback [1,0]`)
      return [1, 0]
    }
    const dx = toStation.lngLat[0] - fromStation.lngLat[0]
    const dy = toStation.lngLat[1] - fromStation.lngLat[1]
    const sign = atStationId === edge.fromStationId ? 1 : -1
    const result = [dx * sign, dy * sign]
    console.debug(`[branchTopology] ${label}: no waypoints, straight-line fallback → [${result[0].toFixed(6)}, ${result[1].toFixed(6)}]`)
    return result
  }

  // Ideally waypoints[0] is the fromStation coordinate and waypoints[last] is the toStation
  // coordinate. However OSM imports sometimes store waypoints in the opposite direction.
  // We detect the actual orientation by comparing the distance from waypoints[0] to each
  // endpoint station: if wp[0] is closer to toStation than to fromStation, the array is
  // reversed relative to the from/to labelling.
  const wp0 = waypoints[0]
  const wpLast = waypoints[waypoints.length - 1]

  let waypointsReversed = false
  if (fromStation && toStation) {
    const d0from = Math.hypot(wp0[0] - fromStation.lngLat[0], wp0[1] - fromStation.lngLat[1])
    const d0to   = Math.hypot(wp0[0] - toStation.lngLat[0],   wp0[1] - toStation.lngLat[1])
    waypointsReversed = d0to < d0from  // wp[0] is actually closer to toStation
    if (waypointsReversed) {
      console.debug(`[branchTopology] ${label}: waypoints appear reversed (wp[0] closer to toStation) — flipping`)
    }
  }

  // Determine which end of the waypoints array corresponds to atStationId
  const atFromLogical = atStationId === edge.fromStationId
  const atHead = waypointsReversed ? !atFromLogical : atFromLogical

  let p0, p1
  let endUsed
  if (atHead) {
    // atStation is at the head of the waypoints array → tangent: [0] → [1]
    p0 = waypoints[0]
    p1 = waypoints[1]
    endUsed = 'head'
  } else {
    // atStation is at the tail of the waypoints array → tangent: [last] → [last-1]
    p0 = waypoints[waypoints.length - 1]
    p1 = waypoints[waypoints.length - 2]
    endUsed = 'tail'
  }

  const dx = p1[0] - p0[0]
  const dy = p1[1] - p0[1]
  console.debug(
    `[branchTopology] ${label}: waypoints(${waypoints.length}), end=${endUsed}`,
    `→ tangent=[${dx.toFixed(6)}, ${dy.toFixed(6)}]`,
  )
  return [dx, dy]
}

// ─── Connected components ───────────────────────────────────────────────────

/**
 * Find ALL connected components in an undirected adjacency list.
 * @param {UndirAdjacency} adjacency
 * @returns {string[][]}  array of components, each is an array of node ids
 */
export function findAllConnectedComponents(adjacency) {
  const visited = new Set()
  const components = []

  for (const nodeId of adjacency.keys()) {
    if (visited.has(nodeId)) continue
    const queue = [nodeId]
    let head = 0
    visited.add(nodeId)
    const component = []
    while (head < queue.length) {
      const current = queue[head++]
      component.push(current)
      for (const neighbor of adjacency.get(current) || []) {
        if (visited.has(neighbor.to)) continue
        visited.add(neighbor.to)
        queue.push(neighbor.to)
      }
    }
    components.push(component)
  }

  return components
}

// ─── Directed graph construction ─────────────────────────────────────────────

/**
 * At a degree-3 node, determine which of the three adjacent edges is the "spur"
 * (branch direction) and which two are the "trunk" continuation.
 *
 * Strategy:
 *  1) Compute the 3 pairwise angles among the three outward tangents.
 *  2) Sort them descending; require BOTH top-1 and top-2 angles > threshold.
 *  3) The edge that appears in BOTH top-1 and top-2 pairs is treated as the
 *     "pre-fork trunk" edge (legacy field name: spurEdgeId).
 *  4) The other two edges are returned as trunkEdgeIds.
 *
 * This correctly handles the "two edges same direction + one opposite" case:
 * the opposite edge is NOT the spur — it is one half of the trunk pair.  The
 * spur is the one that diverges from the straight-through axis.
 *
 * @param {string} nodeId
 * @param {AdjEntry[]} neighbors  exactly 3 entries
 * @param {Map<string, EdgeLike>} edgeById
 * @param {Map<string, StationLike>} stationById
 * @returns {{ spurEdgeId: string, trunkEdgeIds: [string, string] } | null}
 */
function resolveSpurAtDeg3Node(nodeId, neighbors, edgeById, stationById) {
  // Compute outward tangent vectors for each of the 3 edges
  const entries = neighbors.map(({ to, edgeId }) => {
    const edge = edgeById.get(edgeId)
    if (!edge) return null
    const tangent = edgeTangentAt(edge, nodeId, stationById)
    return { to, edgeId, tangent }
  })

  if (entries.some((e) => e === null)) return null

  /** @type {Array<{aIdx:number,bIdx:number,aEdgeId:string,bEdgeId:string,angle:number}>} */
  const pairs = [
    {
      aIdx: 0,
      bIdx: 1,
      aEdgeId: entries[0].edgeId,
      bEdgeId: entries[1].edgeId,
      angle: angleBetweenDeg(entries[0].tangent, entries[1].tangent),
    },
    {
      aIdx: 0,
      bIdx: 2,
      aEdgeId: entries[0].edgeId,
      bEdgeId: entries[2].edgeId,
      angle: angleBetweenDeg(entries[0].tangent, entries[2].tangent),
    },
    {
      aIdx: 1,
      bIdx: 2,
      aEdgeId: entries[1].edgeId,
      bEdgeId: entries[2].edgeId,
      angle: angleBetweenDeg(entries[1].tangent, entries[2].tangent),
    },
  ]

  for (const p of pairs) {
    console.debug(
      `[branchTopology] resolveSpurAtDeg3Node node=${nodeId}`,
      `pair (${p.aEdgeId}, ${p.bEdgeId}): angle=${p.angle.toFixed(1)}°`,
    )
  }

  pairs.sort((x, y) => y.angle - x.angle)
  const top1 = pairs[0]
  const top2 = pairs[1]

  console.debug(
    `[branchTopology] resolveSpurAtDeg3Node node=${nodeId}`,
    `top1=${top1.angle.toFixed(1)}°, top2=${top2.angle.toFixed(1)}°, threshold=${BRANCH_ANGLE_THRESHOLD_DEG}°`,
  )

  if (!(top1.angle > BRANCH_ANGLE_THRESHOLD_DEG && top2.angle > BRANCH_ANGLE_THRESHOLD_DEG)) {
    return null
  }

  // Common edge across top-1 and top-2 pairs → pre-fork trunk edge (legacy spurEdgeId)
  const top1Edges = [top1.aEdgeId, top1.bEdgeId]
  const top2Edges = [top2.aEdgeId, top2.bEdgeId]
  const commonEdgeId = top1Edges.find((id) => top2Edges.includes(id))
  if (!commonEdgeId) return null

  const trunkEdgeIds = entries.map((e) => e.edgeId).filter((id) => id !== commonEdgeId)
  if (trunkEdgeIds.length !== 2) return null

  console.debug(
    `[branchTopology] resolveSpurAtDeg3Node node=${nodeId}`,
    `common(pre-fork) edge=${commonEdgeId}, other edges=${trunkEdgeIds[0]}, ${trunkEdgeIds[1]}`,
  )

  return {
    spurEdgeId: commonEdgeId,
    trunkEdgeIds: /** @type {[string,string]} */ (trunkEdgeIds),
  }
}

/**
 * Build a directed graph from an undirected component adjacency list.
 *
 * Orientation rules per node degree:
 *  - Degree 1 (terminal): the single edge is oriented away from it if it's a
 *    source, or toward it if it's a sink.  Orientation is determined by
 *    propagation from already-decided neighbors.
 *  - Degree 2 (pass-through): one in, one out.
 *  - Degree 3 (junction): one spur edge (determined geometrically), two trunk
 *    edges.  The junction either: (a) receives from both trunk edges and emits
 *    the spur → invalid (two ins, zero outs on trunk = Y-merge), or more
 *    commonly: (b) receives on one trunk edge, emits on the other trunk edge,
 *    and emits (or receives) the spur.
 *
 * Strategy: BFS-orient starting from a degree-1 node (if any), propagating
 * directions edge-by-edge.  At each step:
 *  - If we arrive at a degree-2 node, the outgoing edge is the other edge.
 *  - If we arrive at a degree-3 node, use the spur determination to decide
 *    which of the remaining unoriented edges to continue on.
 *
 * @param {UndirAdjacency} componentAdjacency  adjacency restricted to this component
 * @param {Map<string, EdgeLike>} edgeById
 * @param {Map<string, StationLike>} stationById
 * @returns {{ valid: boolean, reason?: string, directed?: DirAdjacency, inDeg?: Map<string,number>, outDeg?: Map<string,number> }}
 */
export function buildDirectedGraph(componentAdjacency, edgeById, stationById) {
  const nodeIds = [...componentAdjacency.keys()]

  // Reject nodes with degree >= 4
  for (const nodeId of nodeIds) {
    const deg = (componentAdjacency.get(nodeId) || []).length
    if (deg >= 4) {
      return { valid: false, reason: `节点 ${stnLabel(nodeId, stationById)} 度数为 ${deg}，超出支持范围（最大3）` }
    }
  }

  // Pre-compute spur info for all degree-3 nodes
  /** @type {Map<string, { spurEdgeId: string, trunkEdgeIds: [string,string] }>} */
  const spurByNode = new Map()
  for (const nodeId of nodeIds) {
    const neighbors = componentAdjacency.get(nodeId) || []
    if (neighbors.length !== 3) continue
    const spur = resolveSpurAtDeg3Node(nodeId, neighbors, edgeById, stationById)
    console.debug(`[branchTopology] resolveSpurAtDeg3Node for node ${nodeId}:`, spur)
    if (!spur) {
      return {
        valid: false,
        reason: `节点 ${stnLabel(nodeId, stationById)} 度数为3，但无法从几何角度判断支线方向（三条边夹角不满足条件）`,
      }
    }
    spurByNode.set(nodeId, spur)
  }

  // Directed adjacency and degree tracking
  /** @type {DirAdjacency} */
  const directed = new Map()
  /** @type {Map<string, number>} */
  const inDeg = new Map()
  /** @type {Map<string, number>} */
  const outDeg = new Map()
  for (const nodeId of nodeIds) {
    directed.set(nodeId, [])
    inDeg.set(nodeId, 0)
    outDeg.set(nodeId, 0)
  }

  // Track which edges have been oriented
  /** @type {Set<string>} edgeId → oriented */
  const oriented = new Set()

  /**
   * Orient a single (undirected) edge from `fromId` to `toId`.
   * Returns false if the edge was already oriented in the opposite direction.
   */
  function orientEdge(fromId, toId, edgeId) {
    if (oriented.has(edgeId)) return true // already done (same direction is fine)
    oriented.add(edgeId)
    directed.get(fromId).push({ to: toId, edgeId })
    inDeg.set(toId, (inDeg.get(toId) || 0) + 1)
    outDeg.set(fromId, (outDeg.get(fromId) || 0) + 1)
    return true
  }

  /**
   * BFS propagation starting from `startNode`.
   * `arrivedEdgeIntoNode` means whether the edge used to reach `startNode`
   * is oriented toward `startNode`.
   */
  function propagate(startNode, arrivedFrom, arrivedEdgeId, arrivedEdgeIntoNode = true) {
    // Queue entries: { node, arrivedFrom, arrivedEdgeId, arrivedEdgeIntoNode }
    const queue = [{ node: startNode, arrivedFrom, arrivedEdgeId, arrivedEdgeIntoNode }]
    let head = 0

    while (head < queue.length) {
      const { node, arrivedFrom: from, arrivedEdgeId: fromEdgeId, arrivedEdgeIntoNode } = queue[head++]
      const neighbors = componentAdjacency.get(node) || []
      const deg = neighbors.length

      if (deg === 1) {
        // Terminal — no further propagation (we've just arrived)
        continue
      }

      if (deg === 2) {
        // Pass-through: choose direction based on whether we arrived on an
        // incoming edge (toward this node) or an outgoing edge (away from this node).
        const outNeighbor = neighbors.find((n) => n.edgeId !== fromEdgeId)
        if (!outNeighbor) continue
        if (oriented.has(outNeighbor.edgeId)) continue
        if (arrivedEdgeIntoNode) {
          // classic forward propagation
          orientEdge(node, outNeighbor.to, outNeighbor.edgeId)
          queue.push({ node: outNeighbor.to, arrivedFrom: node, arrivedEdgeId: outNeighbor.edgeId, arrivedEdgeIntoNode: true })
        } else {
          // reverse propagation (edge arrows point back toward where we came from)
          orientEdge(outNeighbor.to, node, outNeighbor.edgeId)
          queue.push({ node: outNeighbor.to, arrivedFrom: node, arrivedEdgeId: outNeighbor.edgeId, arrivedEdgeIntoNode: false })
        }
        continue
      }

      if (deg === 3) {
        const spur = spurByNode.get(node)
        // Determine which edges are unoriented and need to be decided
        const unoriented = neighbors.filter((n) => !oriented.has(n.edgeId))
        for (const n of unoriented) {
          // In current deg-3 semantics:
          // - spur.spurEdgeId is the pre-fork trunk edge
          // - spur.trunkEdgeIds are the two post-fork branch edges
          const isPreFork = n.edgeId === spur.spurEdgeId
          if (fromEdgeId === null) {
            // Fresh start at this node (it was a degree-3 source)
            // Conservative default: orient outward from this node.
            orientEdge(node, n.to, n.edgeId)
            queue.push({ node: n.to, arrivedFrom: node, arrivedEdgeId: n.edgeId, arrivedEdgeIntoNode: true })
          } else {
            const arrivedOnPreFork = fromEdgeId === spur.spurEdgeId
            if (arrivedOnPreFork) {
              // Came in via pre-fork edge: split to both post-fork branches (1 in, 2 out).
              if (!isPreFork) {
                orientEdge(node, n.to, n.edgeId)
                queue.push({ node: n.to, arrivedFrom: node, arrivedEdgeId: n.edgeId, arrivedEdgeIntoNode: true })
              }
            } else {
              // Came in via a post-fork branch edge:
              // - pre-fork edge goes OUT from node
              // - the other post-fork branch goes IN to node
              if (isPreFork) {
                orientEdge(node, n.to, n.edgeId)
                queue.push({ node: n.to, arrivedFrom: node, arrivedEdgeId: n.edgeId, arrivedEdgeIntoNode: true })
              } else {
                orientEdge(n.to, node, n.edgeId)
                queue.push({ node: n.to, arrivedFrom: node, arrivedEdgeId: n.edgeId, arrivedEdgeIntoNode: false })
              }
            }
          }
        }
      }
    }
  }

  // Pick exactly ONE degree-1 node as the BFS root.
  // A single propagation from here will orient every reachable edge.
  // Other degree-1 nodes are either reached by that propagation (and become
  // natural sinks) or belong to a disconnected sub-part handled below.
  // We must NOT launch a second independent BFS from another degree-1 node,
  // because that would assign it as a source too and create direction conflicts.
  const deg1Nodes = nodeIds.filter((n) => (componentAdjacency.get(n) || []).length === 1)
  const firstDeg1 = deg1Nodes[0]
  if (firstDeg1 !== undefined) {
    const singleNeighbor = (componentAdjacency.get(firstDeg1) || [])[0]
    if (singleNeighbor) {
      orientEdge(firstDeg1, singleNeighbor.to, singleNeighbor.edgeId)
      propagate(singleNeighbor.to, firstDeg1, singleNeighbor.edgeId, true)
    }
  }

  // Handle any remaining unoriented edges (disconnected sub-parts or odd topologies)
  for (const nodeId of nodeIds) {
    const neighbors = componentAdjacency.get(nodeId) || []
    const unoriented = neighbors.filter((n) => !oriented.has(n.edgeId))
    if (unoriented.length === 0) continue
    // Start fresh propagation
    for (const n of unoriented) {
      if (oriented.has(n.edgeId)) continue
      orientEdge(nodeId, n.to, n.edgeId)
      propagate(n.to, nodeId, n.edgeId, true)
    }
  }

  // Pathological orientation checks
  // 1) Degree-2 node cannot have both edges incoming or both outgoing.
  // 2) Degree-3 node must match the heuristic relation:
  //    - either in=1(out via two branches) with pre-fork as incoming,
  //    - or in=2(out via pre-fork) with both branches incoming.
  const incomingByNode = new Map()
  for (const nodeId of nodeIds) incomingByNode.set(nodeId, [])
  for (const [fromId, edges] of directed.entries()) {
    for (const e of edges) {
      if (!incomingByNode.has(e.to)) incomingByNode.set(e.to, [])
      incomingByNode.get(e.to).push({ from: fromId, edgeId: e.edgeId })
    }
  }

  function edgeNeighborLabelAt(nodeId, edgeId) {
    const edge = edgeById.get(edgeId)
    if (!edge) return edgeId
    const otherId = edge.fromStationId === nodeId ? edge.toStationId : edge.fromStationId
    return stnLabel(otherId, stationById)
  }

  for (const nodeId of nodeIds) {
    const deg = (componentAdjacency.get(nodeId) || []).length
    const ind = inDeg.get(nodeId) || 0
    const outd = outDeg.get(nodeId) || 0

    if (deg === 2 && (ind === 2 || outd === 2)) {
      return {
        valid: false,
        reason: `病态拓扑：度2节点 ${stnLabel(nodeId, stationById)} 出现同向双边（入=${ind}, 出=${outd}）`,
      }
    }

    if (deg === 3) {
      const spur = spurByNode.get(nodeId)
      if (!spur) continue
      const inEdges = new Set((incomingByNode.get(nodeId) || []).map((e) => e.edgeId))
      const outEdges = new Set((directed.get(nodeId) || []).map((e) => e.edgeId))

      const preFork = spur.spurEdgeId
      const [branchA, branchB] = spur.trunkEdgeIds

      const patternSplit =
        ind === 1
        && outd === 2
        && inEdges.has(preFork)
        && outEdges.has(branchA)
        && outEdges.has(branchB)

      const patternMerge =
        ind === 2
        && outd === 1
        && outEdges.has(preFork)
        && inEdges.has(branchA)
        && inEdges.has(branchB)

      if (!patternSplit && !patternMerge) {
        const inDesc = [...inEdges].map((eid) => edgeNeighborLabelAt(nodeId, eid)).join('、') || '无'
        const outDesc = [...outEdges].map((eid) => edgeNeighborLabelAt(nodeId, eid)).join('、') || '无'
        return {
          valid: false,
          reason: `病态拓扑：度3节点 ${stnLabel(nodeId, stationById)} 的入出关系与启发式主支线不一致（入=${ind}[${inDesc}]，出=${outd}[${outDesc}]）`,
        }
      }
    }
  }

  return { valid: true, directed, inDeg, outDeg }
}

// ─── Directed graph validation ───────────────────────────────────────────────

/**
 * Validate that the directed graph satisfies:
 *  - At most 2 nodes with inDeg=0 (sources)
 *  - At most 2 nodes with outDeg=0 (sinks)
 *  - No node has inDeg + outDeg > 3, inDeg > 2, or outDeg > 2
 *
 * @param {DirAdjacency} directed
 * @param {Map<string,number>} inDeg
 * @param {Map<string,number>} outDeg
 * @param {Map<string, StationLike>} [stationById]
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateDirectedGraph(directed, inDeg, outDeg, stationById) {
  const sources = []
  const sinks = []
  for (const nodeId of directed.keys()) {
    const ind = inDeg.get(nodeId) || 0
    const outd = outDeg.get(nodeId) || 0
    if (ind + outd > 3) return { valid: false, reason: `节点 ${stnLabel(nodeId, stationById)} 总度数（入${ind}+出${outd}）超过3，超出支持范围` }
    if (ind > 2) return { valid: false, reason: `节点 ${stnLabel(nodeId, stationById)} 入度为 ${ind}，超出支持范围` }
    if (outd > 2) return { valid: false, reason: `节点 ${stnLabel(nodeId, stationById)} 出度为 ${outd}，超出支持范围` }
    if (ind === 0) sources.push(nodeId)
    if (outd === 0) sinks.push(nodeId)
  }
  if (sources.length > 2) {
    return { valid: false, reason: `入度为0的节点有 ${sources.length} 个，最多允许2个` }
  }
  if (sinks.length > 2) {
    return { valid: false, reason: `出度为0的节点有 ${sinks.length} 个，最多允许2个` }
  }
  return { valid: true, sources, sinks }
}

// ─── Trunk extraction ────────────────────────────────────────────────────────

/**
 * Walk the directed graph from a source node to produce the trunk path.
 *
 * In a valid graph, at a degree-3 junction there are exactly 2 outgoing directed
 * edges.  There is no need to distinguish which one is the "real" trunk — either
 * choice yields a valid topology result.  If the result does not match the user's
 * intent (i.e. the branch and trunk are swapped), the user can swap them in the
 * downstream tool after import.  We simply take the first unvisited outgoing edge.
 *
 * @param {DirAdjacency} directed
 * @param {string} startNode
 * @returns {{ stationIds: string[], edgeIds: string[] }}
 */
function walkTrunk(directed, startNode) {
  const stationIds = [startNode]
  const edgeIds = []
  const visited = new Set([startNode])
  let current = startNode

  while (true) {
    const outs = directed.get(current) || []
    // Pick the first outgoing edge whose target hasn't been visited yet
    const chosen = outs.find((e) => !visited.has(e.to))
    if (!chosen) break

    visited.add(chosen.to)
    stationIds.push(chosen.to)
    edgeIds.push(chosen.edgeId)
    current = chosen.to
  }

  return { stationIds, edgeIds }
}

// ─── Branch extraction ───────────────────────────────────────────────────────

/**
 * Given a directed graph and a known trunk path, extract:
 *  - left/right hanging end-branches
 *  - interval branches between trunk nodes
 *
 * An interval branch is identified as follows:
 *  - A trunk node P has out-degree 2 in the directed graph → one out-edge goes
 *    along the trunk, the other is the start of an interval branch.
 *  - Follow the branch path (all nodes must have degree <= 2 within the branch,
 *    i.e. no further junctions) until arriving at a trunk node Q that has
 *    in-degree 2.
 *
 * "Every node/edge on an interval branch must ONLY appear in that branch."
 * This is enforced by checking that every intermediate node on the branch path
 * has degree exactly 2 in the original undirected adjacency AND is not part of
 * the trunk.
 *
 * @param {DirAdjacency} directed
 * @param {string[]} trunkStationIds
 * @param {string[]} trunkEdgeIds
 * @param {UndirAdjacency} componentAdjacency
 * @param {Map<string, EdgeLike>} edgeById
 * @param {Map<string, StationLike>} stationById
 * @param {string[]} sources  inDeg=0 nodes from validateDirectedGraph
 * @param {string[]} sinks    outDeg=0 nodes from validateDirectedGraph
 * @returns {{ valid: boolean, reason?: string, leftBranch, rightBranch, intervals: BranchInterval[], midBranches: MidHangingBranch[] }}
 */
function extractBranches(
  directed,
  trunkStationIds,
  trunkEdgeIds,
  componentAdjacency,
  edgeById,
  stationById,
  sources,
  sinks,
) {
  const trunkSet = new Set(trunkStationIds)
  const trunkEdgeSet = new Set(trunkEdgeIds)
  const trunkIndexOf = new Map(trunkStationIds.map((id, i) => [id, i]))

  const trunkStart = trunkStationIds[0]
  const trunkEnd = trunkStationIds[trunkStationIds.length - 1]

  // --- Left / Right hanging branches ---
  //
  // A hanging branch tip is either:
  //   (a) a non-trunk SOURCE (inDeg=0) → walk FORWARD to trunk
  //   (b) a non-trunk SINK   (outDeg=0) → walk BACKWARD to trunk
  //
  // After walking, the attach node tells us whether it is a LEFT branch
  // (attaches to trunkStart, i.e. index 0) or a RIGHT branch (attaches to
  // trunkEnd, i.e. the last trunk index).  The attachment index must be
  // either 0 or the last index — otherwise it would be a mid-branch spur,
  // which is handled separately below.
  //
  // Note: because the DAG orientation of a spur can go either way depending
  // on which degree-1 node BFS processed first, we try both sources and sinks.

  let leftBranch = null
  let rightBranch = null

  const seenTips = new Set()
  const hangingCandidates = [
    ...sources.filter((s) => s !== trunkStart && s !== trunkEnd).map((s) => ({ tip: s, mode: /** @type {'forward'} */ ('forward') })),
    ...sinks.filter((s) => s !== trunkStart && s !== trunkEnd).map((s) => ({ tip: s, mode: /** @type {'backward'} */ ('backward') })),
  ].filter(({ tip }) => {
    if (seenTips.has(tip)) return false
    seenTips.add(tip)
    return true
  })

  for (const { tip, mode } of hangingCandidates) {
    const result = walkHangingBranch(tip, directed, trunkSet, mode, stationById)
    if (!result.valid) {
      return { valid: false, reason: `端部支线（${mode}，尖端 ${stnLabel(tip, stationById)}）无效: ${result.reason}` }
    }

    const attachNode = result.attachNode
    const attachIdx = trunkIndexOf.get(attachNode)

    // A source tip walking forward attaches "before" the trunk node (left open-end).
    // A sink tip walking backward attaches "after" the trunk node (right open-end).
    // The attachment point can be anywhere on the trunk — not restricted to the ends.
    if (mode === 'forward') {
      // Left open-end branch: fromIndex = -1 (open), toIndex = attachIdx
      if (leftBranch) return { valid: false, reason: `存在多条左端开放支线` }
      leftBranch = {
        fromStationId: null,
        toStationId: attachNode,
        fromIndex: -1,
        toIndex: attachIdx,
        stationIds: result.stationIds,
        edgeIds: result.edgeIds,
      }
    } else {
      // Right open-end branch: fromIndex = attachIdx, toIndex = Infinity (open)
      if (rightBranch) return { valid: false, reason: `存在多条右端开放支线` }
      rightBranch = {
        fromStationId: attachNode,
        toStationId: null,
        fromIndex: attachIdx,
        toIndex: Infinity,
        stationIds: result.stationIds,
        edgeIds: result.edgeIds,
      }
    }
  }

  // Collect all nodes that are exclusively in left/right branches
  const hangingNodes = new Set([
    ...(leftBranch?.stationIds || []),
    ...(rightBranch?.stationIds || []),
  ])
  const hangingEdges = new Set([
    ...(leftBranch?.edgeIds || []),
    ...(rightBranch?.edgeIds || []),
  ])

  // --- Interval branches & mid hanging branches ---
  // Find all trunk nodes P where outDeg(P) = 2 (fork points)
  const intervals = []
  /** @type {MidHangingBranch[]} */
  const midBranches = []
  const intervalNodesClaimed = new Set() // nodes claimed by an interval branch or mid branch
  const intervalEdgesClaimed = new Set()

  for (let pi = 0; pi < trunkStationIds.length - 1; pi++) {
    const pId = trunkStationIds[pi]
    const dirOuts = directed.get(pId) || []
    // The fork is the outgoing edge NOT on the trunk
    const trunkOutEdge = trunkEdgeIds[pi] // edge from trunkStationIds[pi] to [pi+1]
    const forkEdges = dirOuts.filter((e) => e.edgeId !== trunkOutEdge && !trunkEdgeSet.has(e.edgeId))

    if (forkEdges.length === 0) continue
    if (forkEdges.length > 1) {
      return { valid: false, reason: `主干节点 ${stnLabel(pId, stationById)} 有多条分叉支线边，不合法` }
    }

    const forkEntry = forkEdges[0]
    // If this outgoing edge belongs to a left/right hanging branch (e.g. a spur
    // that was oriented as trunk→tip rather than tip→trunk), skip it — it has
    // already been accounted for as a hanging branch.
    if (hangingEdges.has(forkEntry.edgeId)) continue

    // The first node on the interval branch must not be on trunk or hanging branches
    if (trunkSet.has(forkEntry.to) || hangingNodes.has(forkEntry.to)) {
      return { valid: false, reason: `区间支线从 ${stnLabel(pId, stationById)} 出发后立即进入已使用节点 ${stnLabel(forkEntry.to, stationById)}` }
    }

    // Walk the branch path until reaching a trunk node Q
    const branchResult = walkIntervalBranch(
      forkEntry.to,
      forkEntry.edgeId,
      pId,
      directed,
      trunkSet,
      componentAdjacency,
      intervalNodesClaimed,
      intervalEdgesClaimed,
      hangingNodes,
      hangingEdges,
      stationById,
    )

    if (!branchResult.valid) {
      return { valid: false, reason: `主干节点 ${stnLabel(pId, stationById)} 出发的区间支线无效: ${branchResult.reason}` }
    }

    // Dead-end fork → treat as a mid-trunk hanging branch (blind spur)
    if (branchResult.deadEnd) {
      for (const nId of branchResult.stationIds) intervalNodesClaimed.add(nId)
      for (const eId of branchResult.edgeIds) intervalEdgesClaimed.add(eId)
      midBranches.push({
        attachToStationId: pId,
        stationIds: branchResult.stationIds,
        edgeIds: branchResult.edgeIds,
      })
      continue
    }

    const qi = trunkIndexOf.get(branchResult.rejoinsAt)
    if (qi === undefined || qi <= pi) {
      return {
        valid: false,
        reason: `区间支线从主干位置 ${pi} 出发，但汇入点 ${stnLabel(branchResult.rejoinsAt, stationById)} 不在其后方`,
      }
    }

    // Mark nodes and edges as claimed
    for (const nId of branchResult.stationIds) intervalNodesClaimed.add(nId)
    for (const eId of branchResult.edgeIds) intervalEdgesClaimed.add(eId)

    intervals.push({
      fromStationId: pId,
      toStationId: branchResult.rejoinsAt,
      fromIndex: pi,
      toIndex: qi,
      stationIds: branchResult.stationIds,
      edgeIds: branchResult.edgeIds,
    })
  }

  // Verify no unclaimed non-trunk, non-hanging edges remain
  for (const [nodeId, edges] of directed.entries()) {
    if (trunkSet.has(nodeId) || hangingNodes.has(nodeId)) continue
    if (intervalNodesClaimed.has(nodeId)) continue
    return {
      valid: false,
      reason: `节点 ${stnLabel(nodeId, stationById)} 不属于主干、端部支线或任何区间支线，图结构非法`,
    }
  }

  // Merge open-end branches into the intervals array and sort by fromIndex
  if (leftBranch) intervals.push(leftBranch)
  if (rightBranch) intervals.push(rightBranch)
  intervals.sort((a, b) => (a.fromIndex === b.fromIndex ? 0 : a.fromIndex < b.fromIndex ? -1 : 1))

  return { valid: true, intervals, midBranches }
}

/**
 * Walk a hanging (end) branch starting from its tip node.
 *
 * - mode='forward'  (LEFT branch):  tip has inDeg=0; follow directed edges until
 *   reaching a trunk node.  Collects nodes/edges EXCLUDING the trunk attach node.
 * - mode='backward' (RIGHT branch): tip has outDeg=0; follow REVERSE directed edges
 *   until reaching a trunk node.  Collects nodes/edges EXCLUDING the trunk attach node.
 *
 * @param {string} tipNode
 * @param {DirAdjacency} directed
 * @param {Set<string>} trunkSet
 * @param {'forward'|'backward'} [mode='forward']
 * @param {Map<string, StationLike>} [stationById]
 * @returns {{ valid: boolean, reason?: string, stationIds: string[], edgeIds: string[] }}
 */
function walkHangingBranch(tipNode, directed, trunkSet, mode = 'forward', stationById) {
  const stationIds = []
  const edgeIds = []
  const visited = new Set()

  if (mode === 'forward') {
    // Walk from tip along directed edges until we hit a trunk node (excluded)
    let current = tipNode
    while (true) {
      if (visited.has(current)) return { valid: false, reason: `岔入支线出现环路，节点 ${stnLabel(current, stationById)}` }
      visited.add(current)
      if (trunkSet.has(current)) return { valid: true, stationIds, edgeIds, attachNode: current }
      stationIds.push(current)
      const outs = directed.get(current) || []
      if (outs.length === 0) return { valid: false, reason: `岔入支线在 ${stnLabel(current, stationById)} 处断路，未到达主干` }
      if (outs.length > 1) return { valid: false, reason: `岔入支线节点 ${stnLabel(current, stationById)} 有多条出边，不合法` }
      edgeIds.push(outs[0].edgeId)
      current = outs[0].to
    }
  }

  // mode === 'backward': walk from tip along REVERSE directed edges until trunk node
  /** @type {Map<string, {from: string, edgeId: string}[]>} */
  const reverseAdj = new Map()
  for (const [fromId, edges] of directed.entries()) {
    for (const e of edges) {
      if (!reverseAdj.has(e.to)) reverseAdj.set(e.to, [])
      reverseAdj.get(e.to).push({ from: fromId, edgeId: e.edgeId })
    }
  }

  // Collect from tip backward, stop before (excluding) the trunk attach node
  let current = tipNode
  while (true) {
    if (visited.has(current)) return { valid: false, reason: `岔出支线出现环路，节点 ${stnLabel(current, stationById)}` }
    visited.add(current)
    if (trunkSet.has(current)) {
      // stationIds collected from tip → attach-side; reverse to get attach-side → tip order
      stationIds.reverse()
      edgeIds.reverse()
      return { valid: true, stationIds, edgeIds, attachNode: current }
    }
    stationIds.push(current)
    const ins = reverseAdj.get(current) || []
    if (ins.length === 0) return { valid: false, reason: `岔出支线在 ${stnLabel(current, stationById)} 处断路，未到达主干` }
    if (ins.length > 1) return { valid: false, reason: `岔出支线节点 ${stnLabel(current, stationById)} 有多条入边，不合法` }
    edgeIds.push(ins[0].edgeId)
    current = ins[0].from
  }
}

/**
 * Walk an interval branch from `startNode` (first node after the fork edge)
 * until a trunk node is reached (the rejoin point Q).
 *
 * Validation: every intermediate (non-trunk) node must:
 *  1. Have degree exactly 2 in componentAdjacency (it's a simple pass-through).
 *  2. Not already be claimed by another interval branch.
 *  3. Not be a hanging branch node.
 *
 * @returns {{ valid, reason?, stationIds, edgeIds, rejoinsAt }}
 */
function walkIntervalBranch(
  startNode,
  startEdgeId,
  forkNode,
  directed,
  trunkSet,
  componentAdjacency,
  claimedNodes,
  claimedEdges,
  hangingNodes,
  hangingEdges,
  stationById,
) {
  const stationIds = [] // intermediate nodes only (not trunk endpoints)
  const edgeIds = [startEdgeId]
  const visited = new Set([forkNode, startNode])
  let current = startNode

  while (true) {
    // Degree check: must be exactly 2 in undirected adjacency if not on trunk
    const deg = (componentAdjacency.get(current) || []).length
    if (!trunkSet.has(current)) {
      if (deg !== 2) {
        return {
          valid: false,
          reason: `区间支线中间节点 ${stnLabel(current, stationById)} 度数为 ${deg}（期望2），不能有进一步分叉`,
        }
      }
      if (claimedNodes.has(current)) {
        return {
          valid: false,
          reason: `区间支线中间节点 ${stnLabel(current, stationById)} 已被另一区间支线占用`,
        }
      }
      if (hangingNodes.has(current)) {
        return {
          valid: false,
          reason: `区间支线中间节点 ${stnLabel(current, stationById)} 已属于端部支线`,
        }
      }
      stationIds.push(current)
    }

    // Follow directed outgoing edge
    const outs = directed.get(current) || []
    // Filter to edges not yet in path
    const nextEdges = outs.filter((e) => !visited.has(e.to) || trunkSet.has(e.to))

    if (nextEdges.length === 0) {
      // Dead end (degree-1 tip) — signal caller to treat this as a mid hanging branch
      return { valid: true, deadEnd: true, stationIds, edgeIds }
    }
    if (nextEdges.length > 1 && !trunkSet.has(current)) {
      return {
        valid: false,
        reason: `区间支线节点 ${stnLabel(current, stationById)} 有多条出边，区间支线内部不允许再分叉`,
      }
    }

    const next = nextEdges[0]

    if (claimedEdges.has(next.edgeId) || hangingEdges.has(next.edgeId)) {
      return { valid: false, reason: `区间支线边 ${next.edgeId} 已被其他结构占用` }
    }

    if (trunkSet.has(next.to)) {
      // Arrived at a trunk node — this is the rejoin point Q
      edgeIds.push(next.edgeId)
      return { valid: true, stationIds, edgeIds, rejoinsAt: next.to }
    }

    if (visited.has(next.to)) {
      return { valid: false, reason: `区间支线出现环路，节点 ${stnLabel(next.to, stationById)}` }
    }

    visited.add(next.to)
    edgeIds.push(next.edgeId)
    current = next.to
  }
}

// ─── Interval overlap validation ─────────────────────────────────────────────

/**
 * Validate that interval branches do not overlap or nest.
 * Two intervals [p1,q1] and [p2,q2] (by trunk index) are valid iff their
 * open interiors are disjoint: (p1,q1) ∩ (p2,q2) = ∅.
 * Equivalently: q1 <= p2 or q2 <= p1 (after sorting).
 *
 * @param {Array<{fromIndex:number, toIndex:number}>} intervals
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateIntervalOverlap(intervals) {
  // Already sorted by fromIndex from extractBranches, but sort defensively.
  // -1 (left open-end) always comes first; Infinity (right open-end) always comes last.
  const sorted = [...intervals].sort((a, b) => {
    if (a.fromIndex !== b.fromIndex) return a.fromIndex < b.fromIndex ? -1 : 1
    return a.toIndex < b.toIndex ? -1 : a.toIndex > b.toIndex ? 1 : 0
  })
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    // Two intervals [p1,q1] and [p2,q2] overlap/nest iff b.fromIndex < a.toIndex.
    // Works for -1 and Infinity: e.g. [-1, 3] and [2, 5]: 2 < 3 → overlap ✗
    //                                 [-1, 3] and [3, 7]: 3 < 3 is false → ok ✓
    if (b.fromIndex < a.toIndex) {
      return {
        valid: false,
        reason: `区间支线 [${a.fromIndex}–${a.toIndex}] 与 [${b.fromIndex}–${b.toIndex}] 重叠或嵌套`,
      }
    }
  }
  return { valid: true }
}

// ─── Simple loop (cycle) detection ───────────────────────────────────────────

/**
 * Detect whether a connected component is a simple loop (cycle).
 *
 * A simple loop satisfies:
 *  - Every node has degree exactly 2 in the component adjacency.
 *  - The number of edges equals the number of nodes (single cycle).
 *
 * If it is a loop, walk it starting from an arbitrary node and return the
 * ordered station/edge lists.  The walk follows edges in order, stopping
 * when it returns to the start node.
 *
 * @param {string[]} componentIds
 * @param {UndirAdjacency} componentAdjacency  already restricted to this component
 * @returns {{ isLoop: boolean, stationIds?: string[], edgeIds?: string[] }}
 */
function detectSimpleLoop(componentIds, componentAdjacency) {
  // All nodes must have degree exactly 2
  for (const nodeId of componentIds) {
    const deg = (componentAdjacency.get(nodeId) || []).length
    if (deg !== 2) return { isLoop: false }
  }

  // Count unique edges
  const edgeSet = new Set()
  for (const [, neighbors] of componentAdjacency) {
    for (const n of neighbors) edgeSet.add(n.edgeId)
  }
  // For a simple cycle: edges === nodes
  if (edgeSet.size !== componentIds.length) return { isLoop: false }

  // Walk the loop starting from the first node
  const startNode = componentIds[0]
  const stationIds = [startNode]
  const edgeIds = []
  const visited = new Set([startNode])
  let current = startNode

  while (true) {
    const neighbors = componentAdjacency.get(current) || []
    // Pick the next unvisited neighbor (or, if all visited, check if we can close the loop)
    const next = neighbors.find((n) => !visited.has(n.to))
    if (!next) {
      // Try to close the loop back to startNode
      const closing = neighbors.find((n) => n.to === startNode && !edgeIds.includes(n.edgeId))
      if (closing) {
        edgeIds.push(closing.edgeId)
      }
      break
    }
    visited.add(next.to)
    stationIds.push(next.to)
    edgeIds.push(next.edgeId)
    current = next.to
  }

  // Verify we got all nodes
  if (stationIds.length !== componentIds.length || edgeIds.length !== componentIds.length) {
    return { isLoop: false }
  }

  return { isLoop: true, stationIds, edgeIds }
}

// ─── Top-level per-component analysis ────────────────────────────────────────

/**
 * Analyze a single connected component and return its branch topology structure.
 *
 * @param {string[]} componentIds  node ids in this component
 * @param {UndirAdjacency} fullAdjacency  full adjacency (will be restricted)
 * @param {Map<string, EdgeLike>} edgeById
 * @param {Map<string, StationLike>} stationById
 * @returns {BranchTopologyResult}
 */
export function analyzeComponent(componentIds, fullAdjacency, edgeById, stationById) {
  // Build component-restricted adjacency
  const componentSet = new Set(componentIds)
  /** @type {UndirAdjacency} */
  const componentAdjacency = new Map()
  for (const nodeId of componentIds) {
    const neighbors = (fullAdjacency.get(nodeId) || []).filter((e) => componentSet.has(e.to))
    componentAdjacency.set(nodeId, neighbors)
  }

  // Step 1: Build directed graph
  const dirResult = buildDirectedGraph(componentAdjacency, edgeById, stationById)
  if (!dirResult.valid) return { valid: false, reason: dirResult.reason }
  const { directed, inDeg, outDeg } = dirResult

  // Step 2: Validate degree constraints
  const valResult = validateDirectedGraph(directed, inDeg, outDeg, stationById)
  if (!valResult.valid) return { valid: false, reason: valResult.reason }

  // Step 3: Find trunk start.
  // For a valid graph the exact choice among sources doesn't matter for correctness —
  // left/right branch detection is done purely from the source/sink sets afterward.
  const sources = valResult.sources
  const sinks = valResult.sinks
  if (sources.length === 0) {
    // No source nodes → might be a simple loop (all degree-2 cycle)
    const loopResult = detectSimpleLoop(componentIds, componentAdjacency)
    if (loopResult.isLoop) {
      return {
        valid: true,
        isLoop: true,
        trunkStationIds: loopResult.stationIds,
        trunkEdgeIds: loopResult.edgeIds,
        intervals: [],
        midBranches: [],
      }
    }
    return { valid: false, reason: '有向图中无入度为0的节点，且不是简单环线，无法确定起点' }
  }
  const trunkStart = sources[0]

  // Step 4: Walk the trunk
  const { stationIds: trunkStationIds, edgeIds: trunkEdgeIds } = walkTrunk(directed, trunkStart)

  if (trunkStationIds.length < 2) {
    return { valid: false, reason: '主干路径长度不足，无法构成有效线路' }
  }

  // Step 5: Extract branches
  const branchResult = extractBranches(
    directed,
    trunkStationIds,
    trunkEdgeIds,
    componentAdjacency,
    edgeById,
    stationById,
    sources,
    sinks,
  )
  if (!branchResult.valid) return { valid: false, reason: branchResult.reason }

  const { intervals, midBranches } = branchResult

  // Step 6: Validate interval non-overlap
  const overlapResult = validateIntervalOverlap(intervals)
  if (!overlapResult.valid) return { valid: false, reason: overlapResult.reason }

  return {
    valid: true,
    trunkStationIds,
    trunkEdgeIds,
    intervals,
    midBranches,
  }
}

// ─── Project-level entry point ────────────────────────────────────────────────

/**
 * Analyze ALL connected components for a given line in a RailProject.
 *
 * @param {import('../projectModel').RailProject} project
 * @param {string} lineId
 * @returns {Array<{ componentIndex: number } & BranchTopologyResult>}
 */
export function analyzeLineBranchTopology(project, lineId) {
  const lines = project?.lines || []
  const edges = project?.edges || []
  const stations = project?.stations || []

  const line = lines.find((l) => l.id === lineId)
  if (!line) return [{ componentIndex: 0, valid: false, reason: '线路不存在' }]

  const stationById = new Map(stations.map((s) => [s.id, s]))
  const edgeById = new Map(edges.map((e) => [e.id, e]))

  // Build undirected adjacency for this line's edges only
  /** @type {UndirAdjacency} */
  const adjacency = new Map()

  const lineEdgeIds = new Set(line.edgeIds || [])
  for (const edgeId of lineEdgeIds) {
    const edge = edgeById.get(edgeId)
    if (!edge) continue
    if (!Array.isArray(edge.sharedByLineIds) || !edge.sharedByLineIds.includes(lineId)) continue
    if (!stationById.has(edge.fromStationId) || !stationById.has(edge.toStationId)) continue

    const { fromStationId: from, toStationId: to } = edge
    const weight = Number.isFinite(edge.lengthMeters) && edge.lengthMeters > 0 ? edge.lengthMeters : 1

    if (!adjacency.has(from)) adjacency.set(from, [])
    if (!adjacency.has(to)) adjacency.set(to, [])
    adjacency.get(from).push({ to, edgeId, weight })
    adjacency.get(to).push({ to: from, edgeId, weight })
  }

  if (!adjacency.size) {
    return [{ componentIndex: 0, valid: false, reason: '线路无有效线段' }]
  }

  const components = findAllConnectedComponents(adjacency)

  return components.map((componentIds, index) => ({
    componentIndex: index,
    ...analyzeComponent(componentIds, adjacency, edgeById, stationById),
  }))
}
