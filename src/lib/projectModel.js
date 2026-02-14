import { pickLineColor } from './colors'
import { createId } from './ids'
import { normalizeLineStyle } from './lineStyles'
import { normalizeLineNamesForLoop } from './lineNaming'

export const PROJECT_SCHEMA_VERSION = '1.0.0'
export const JINAN_REGION_ID = 'jinan_admin'
export const JINAN_RELATION_ID = 3486449

/**
 * @typedef {Object} RailStation
 * @property {string} id
 * @property {string} nameZh
 * @property {string} nameEn
 * @property {[number, number]} lngLat
 * @property {[number, number]} displayPos
 * @property {boolean} isInterchange
 * @property {boolean} underConstruction
 * @property {boolean} proposed
 * @property {string[]} lineIds
 * @property {string[]} transferLineIds
 */

/**
 * @typedef {Object} RailEdge
 * @property {string} id
 * @property {string} fromStationId
 * @property {string} toStationId
 * @property {[number, number][]} waypoints
 * @property {string[]} sharedByLineIds
 * @property {number} lengthMeters
 * @property {boolean} isCurved
 */

/**
 * @typedef {Object} RailLine
 * @property {string} id
 * @property {string} key
 * @property {string} nameZh
 * @property {string} nameEn
 * @property {string} color
 * @property {('open'|'construction'|'proposed')} status
 * @property {('solid'|'dashed'|'dotted'|'double-solid'|'double-dashed'|'double-dotted-square')} style
 * @property {boolean} isLoop
 * @property {string[]} edgeIds
 */

/**
 * @typedef {Object} RailProject
 * @property {string} id
 * @property {string} projectVersion
 * @property {string} name
 * @property {{id: string, name: string, relationId: number}} region
 * @property {{includeConstruction: boolean, includeProposed: boolean}} importConfig
 * @property {RailStation[]} stations
 * @property {Array<{id: string, stationAId: string, stationBId: string}>} manualTransfers
 * @property {RailEdge[]} edges
 * @property {RailLine[]} lines
 * @property {Array<{createdAt: string, score: number, breakdown: Record<string, number>}>} snapshots
 * @property {{stationLabels: Record<string, {dx:number,dy:number,anchor:string}>, edgeDirections: Record<string, number>}} layoutMeta
 * @property {{geoSeedScale: number}} layoutConfig
 * @property {{createdAt: string, updatedAt: string}} meta
 */

export function createEmptyProject(name = '新建工程') {
  const now = new Date().toISOString()
  return {
    id: createId('project'),
    projectVersion: PROJECT_SCHEMA_VERSION,
    name,
    region: {
      id: JINAN_REGION_ID,
      name: '济南市',
      relationId: JINAN_RELATION_ID,
    },
    regionBoundary: null,
    importConfig: {
      includeConstruction: false,
      includeProposed: false,
    },
    stations: [],
    manualTransfers: [],
    edges: [],
    lines: [
      {
        id: createId('line'),
        key: 'manual-line-1',
        nameZh: '手工线路 1',
        nameEn: 'Manual Line 1',
        color: pickLineColor(0),
        status: 'open',
        style: normalizeLineStyle('solid'),
        isLoop: false,
        edgeIds: [],
      },
    ],
    snapshots: [],
    layoutMeta: {
      stationLabels: {},
      edgeDirections: {},
    },
    layoutConfig: {
      geoSeedScale: 6,
    },
    meta: {
      createdAt: now,
      updatedAt: now,
    },
  }
}

export function normalizeProject(raw) {
  const base = createEmptyProject(raw?.name || '导入工程')
  const merged = {
    ...base,
    ...raw,
    region: {
      ...base.region,
      ...(raw?.region || {}),
    },
    regionBoundary: raw?.regionBoundary || base.regionBoundary,
    importConfig: {
      ...base.importConfig,
      ...(raw?.importConfig || {}),
    },
    stations: Array.isArray(raw?.stations) ? raw.stations : [],
    manualTransfers: Array.isArray(raw?.manualTransfers) ? raw.manualTransfers : [],
    edges: Array.isArray(raw?.edges) ? raw.edges : [],
    lines: Array.isArray(raw?.lines) && raw.lines.length ? raw.lines : base.lines,
    snapshots: Array.isArray(raw?.snapshots) ? raw.snapshots : [],
    layoutMeta:
      raw?.layoutMeta && typeof raw.layoutMeta === 'object'
        ? {
            stationLabels:
              raw.layoutMeta.stationLabels && typeof raw.layoutMeta.stationLabels === 'object'
                ? raw.layoutMeta.stationLabels
                : {},
            edgeDirections:
              raw.layoutMeta.edgeDirections && typeof raw.layoutMeta.edgeDirections === 'object'
                ? raw.layoutMeta.edgeDirections
                : {},
          }
        : base.layoutMeta,
    layoutConfig:
      raw?.layoutConfig && typeof raw.layoutConfig === 'object'
        ? {
            geoSeedScale: Number.isFinite(Number(raw.layoutConfig.geoSeedScale))
              ? Math.max(0.1, Number(raw.layoutConfig.geoSeedScale))
              : base.layoutConfig.geoSeedScale,
          }
        : base.layoutConfig,
    meta: {
      ...base.meta,
      ...(raw?.meta || {}),
      updatedAt: new Date().toISOString(),
    },
  }

  merged.stations = merged.stations.map((station) => ({
    id: station.id || createId('station'),
    nameZh: station.nameZh || station.name || '未命名站',
    nameEn: station.nameEn || station.nameZh || station.name || '',
    lngLat: station.lngLat || [117.0, 36.65],
    displayPos: station.displayPos || station.lngLat || [117.0, 36.65],
    isInterchange: Boolean(station.isInterchange),
    underConstruction: Boolean(station.underConstruction),
    proposed: Boolean(station.proposed),
    lineIds: Array.isArray(station.lineIds) ? station.lineIds : [],
    transferLineIds: Array.isArray(station.transferLineIds) ? station.transferLineIds : [],
  }))

  const stationIdSet = new Set(merged.stations.map((station) => String(station.id)))
  const manualTransferSeen = new Set()
  merged.manualTransfers = merged.manualTransfers
    .map((transfer) => {
      const rawA = String(transfer?.stationAId || '')
      const rawB = String(transfer?.stationBId || '')
      if (!rawA || !rawB || rawA === rawB) return null
      if (!stationIdSet.has(rawA) || !stationIdSet.has(rawB)) return null
      const [stationAId, stationBId] = rawA < rawB ? [rawA, rawB] : [rawB, rawA]
      const key = `${stationAId}__${stationBId}`
      if (manualTransferSeen.has(key)) return null
      manualTransferSeen.add(key)
      return {
        id: transfer?.id ? String(transfer.id) : createId('transfer'),
        stationAId,
        stationBId,
      }
    })
    .filter(Boolean)

  merged.edges = merged.edges.map((edge) => ({
    id: edge.id || createId('edge'),
    fromStationId: edge.fromStationId,
    toStationId: edge.toStationId,
    waypoints: Array.isArray(edge.waypoints) ? edge.waypoints : [],
    sharedByLineIds: Array.isArray(edge.sharedByLineIds) ? edge.sharedByLineIds : [],
    lengthMeters: Number(edge.lengthMeters || 0),
    isCurved: Boolean(edge.isCurved),
  }))

  merged.lines = merged.lines.map((line, index) => {
    const isLoop = Boolean(line.isLoop)
    const normalizedNames = normalizeLineNamesForLoop({
      nameZh: line.nameZh || line.name || `线路 ${index + 1}`,
      nameEn: line.nameEn || line.nameZh || line.name || '',
      isLoop,
    })
    return {
      id: line.id || createId('line'),
      key: line.key || line.ref || `line_${index + 1}`,
      nameZh: normalizedNames.nameZh || `线路 ${index + 1}`,
      nameEn: normalizedNames.nameEn,
      color: line.color || pickLineColor(index),
      status: line.status || 'open',
      style: normalizeLineStyle(line.style),
      isLoop,
      edgeIds: Array.isArray(line.edgeIds) ? line.edgeIds : [],
    }
  })

  return merged
}
