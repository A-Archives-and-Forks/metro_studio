import { openDB } from 'idb'
import { normalizeProject } from '../projectModel'

const DB_NAME = 'metro-studio-db'
const DB_VERSION = 1
const PROJECT_STORE = 'projects'
const META_STORE = 'meta'
const LATEST_PROJECT_KEY = 'latest-project-id'

let dbPromise

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(PROJECT_STORE)) {
          db.createObjectStore(PROJECT_STORE, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: 'key' })
        }
      },
    })
  }
  return dbPromise
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toPoint(value, fallback = [0, 0]) {
  if (!Array.isArray(value) || value.length < 2) {
    return [toFiniteNumber(fallback[0], 0), toFiniteNumber(fallback[1], 0)]
  }
  return [toFiniteNumber(value[0], fallback[0]), toFiniteNumber(value[1], fallback[1])]
}

function toStringArray(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item))
}

function toSerializableBreakdown(breakdown) {
  if (!breakdown || typeof breakdown !== 'object') return {}
  const result = {}
  for (const [key, value] of Object.entries(breakdown)) {
    result[String(key)] = toFiniteNumber(value, 0)
  }
  return result
}

function toSerializableProject(project) {
  const normalized = normalizeProject(project)

  return {
    id: String(normalized.id),
    projectVersion: String(normalized.projectVersion || ''),
    name: String(normalized.name || ''),
    region: {
      id: String(normalized.region?.id || ''),
      name: String(normalized.region?.name || ''),
      relationId: toFiniteNumber(normalized.region?.relationId, 0),
    },
    regionBoundary: normalized.regionBoundary ? JSON.parse(JSON.stringify(normalized.regionBoundary)) : null,
    stations: (normalized.stations || []).map((station) => {
      const lngLat = toPoint(station.lngLat, [117, 36.65])
      const displayPos = toPoint(station.displayPos, lngLat)
      const serializableStation = {
        id: String(station.id || ''),
        nameZh: String(station.nameZh || ''),
        nameEn: String(station.nameEn || ''),
        lngLat,
        displayPos,
        isInterchange: Boolean(station.isInterchange),
        underConstruction: Boolean(station.underConstruction),
        proposed: Boolean(station.proposed),
        lineIds: toStringArray(station.lineIds),
      }
      if (station.osmNodeId != null) {
        serializableStation.osmNodeId = toFiniteNumber(station.osmNodeId, 0)
      }
      return serializableStation
    }),
    manualTransfers: (normalized.manualTransfers || []).map((transfer) => ({
      id: String(transfer.id || ''),
      stationAId: String(transfer.stationAId || ''),
      stationBId: String(transfer.stationBId || ''),
    })),
    edges: (normalized.edges || []).map((edge) => ({
      id: String(edge.id || ''),
      fromStationId: String(edge.fromStationId || ''),
      toStationId: String(edge.toStationId || ''),
      waypoints: (Array.isArray(edge.waypoints) ? edge.waypoints : []).map((point) => toPoint(point)),
      sharedByLineIds: toStringArray(edge.sharedByLineIds),
      lineStyleOverride: edge.lineStyleOverride != null ? String(edge.lineStyleOverride) : null,
      lengthMeters: toFiniteNumber(edge.lengthMeters, 0),
      isCurved: Boolean(edge.isCurved),
      openingYear: edge.openingYear != null ? Number(edge.openingYear) : null,
      phase: edge.phase || '',
    })),
    lines: (normalized.lines || []).map((line) => ({
      id: String(line.id || ''),
      key: String(line.key || ''),
      nameZh: String(line.nameZh || ''),
      nameEn: String(line.nameEn || ''),
      color: String(line.color || ''),
      status: String(line.status || 'open'),
      style: String(line.style || 'solid'),
      isLoop: Boolean(line.isLoop),
      edgeIds: toStringArray(line.edgeIds),
    })),
    snapshots: (normalized.snapshots || []).map((snapshot) => ({
      createdAt: String(snapshot.createdAt || new Date().toISOString()),
      score: toFiniteNumber(snapshot.score, 0),
      breakdown: toSerializableBreakdown(snapshot.breakdown),
    })),
    layoutMeta: {
      stationLabels:
        normalized.layoutMeta && typeof normalized.layoutMeta.stationLabels === 'object'
          ? JSON.parse(JSON.stringify(normalized.layoutMeta.stationLabels))
          : {},
      edgeDirections:
        normalized.layoutMeta && typeof normalized.layoutMeta.edgeDirections === 'object'
          ? JSON.parse(JSON.stringify(normalized.layoutMeta.edgeDirections))
          : {},
    },
    layoutConfig: {
      geoSeedScale: toFiniteNumber(normalized.layoutConfig?.geoSeedScale, 6),
    },
    meta: {
      createdAt: String(normalized.meta?.createdAt || new Date().toISOString()),
      updatedAt: String(normalized.meta?.updatedAt || new Date().toISOString()),
    },
  }
}

export async function saveProjectToDb(project) {
  const db = await getDb()
  const serializable = toSerializableProject(project)
  await db.put(PROJECT_STORE, serializable)
  await db.put(META_STORE, { key: LATEST_PROJECT_KEY, value: serializable.id })
  return serializable
}

export async function loadProjectFromDb(projectId) {
  const db = await getDb()
  const result = await db.get(PROJECT_STORE, projectId)
  return result ? normalizeProject(result) : null
}

export async function listProjectsFromDb() {
  const db = await getDb()
  const projects = await db.getAll(PROJECT_STORE)
  return projects
    .map((project) => normalizeProject(project))
    .sort((a, b) => (a.meta.updatedAt < b.meta.updatedAt ? 1 : -1))
}

export async function loadLatestProjectFromDb() {
  const db = await getDb()
  const latest = await db.get(META_STORE, LATEST_PROJECT_KEY)
  if (!latest?.value) {
    return null
  }
  return loadProjectFromDb(latest.value)
}

export async function setLatestProject(projectId) {
  const db = await getDb()
  await db.put(META_STORE, { key: LATEST_PROJECT_KEY, value: projectId })
}

export async function clearLatestProject() {
  const db = await getDb()
  await db.delete(META_STORE, LATEST_PROJECT_KEY)
}

export async function deleteProjectFromDb(projectId) {
  const db = await getDb()
  await db.delete(PROJECT_STORE, projectId)
  const latest = await db.get(META_STORE, LATEST_PROJECT_KEY)
  if (latest?.value === projectId) {
    await db.delete(META_STORE, LATEST_PROJECT_KEY)
  }
}
