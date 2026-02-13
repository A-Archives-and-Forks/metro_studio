import { pickLineColor } from './colors'
import { createId } from './ids'

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
 */

/**
 * @typedef {Object} RailEdge
 * @property {string} id
 * @property {string} fromStationId
 * @property {string} toStationId
 * @property {[number, number][]} waypoints
 * @property {string[]} sharedByLineIds
 * @property {number} lengthMeters
 */

/**
 * @typedef {Object} RailLine
 * @property {string} id
 * @property {string} key
 * @property {string} nameZh
 * @property {string} nameEn
 * @property {string} color
 * @property {('open'|'construction'|'proposed')} status
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
 * @property {RailEdge[]} edges
 * @property {RailLine[]} lines
 * @property {Array<{createdAt: string, score: number, breakdown: Record<string, number>}>} snapshots
 * @property {{stationLabels: Record<string, {dx:number,dy:number,anchor:string}>, edgeDirections: Record<string, number>}} layoutMeta
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
    edges: [],
    lines: [
      {
        id: createId('line'),
        key: 'manual-line-1',
        nameZh: '手工线路 1',
        nameEn: 'Manual Line 1',
        color: pickLineColor(0),
        status: 'open',
        edgeIds: [],
      },
    ],
    snapshots: [],
    layoutMeta: {
      stationLabels: {},
      edgeDirections: {},
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
  }))

  merged.edges = merged.edges.map((edge) => ({
    id: edge.id || createId('edge'),
    fromStationId: edge.fromStationId,
    toStationId: edge.toStationId,
    waypoints: Array.isArray(edge.waypoints) ? edge.waypoints : [],
    sharedByLineIds: Array.isArray(edge.sharedByLineIds) ? edge.sharedByLineIds : [],
    lengthMeters: Number(edge.lengthMeters || 0),
  }))

  merged.lines = merged.lines.map((line, index) => ({
    id: line.id || createId('line'),
    key: line.key || line.ref || `line_${index + 1}`,
    nameZh: line.nameZh || line.name || `线路 ${index + 1}`,
    nameEn: line.nameEn || line.nameZh || line.name || '',
    color: line.color || pickLineColor(index),
    status: line.status || 'open',
    edgeIds: Array.isArray(line.edgeIds) ? line.edgeIds : [],
  }))

  return merged
}
