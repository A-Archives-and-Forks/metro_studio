import { reverseGeocode } from './nominatimClient'

import {
  clamp,
  toFiniteNumber,
  DEFAULT_RADIUS_METERS,
  MIN_RADIUS_METERS,
  MAX_RADIUS_METERS,
  ROAD_IMPORTANCE,
  ROAD_LABEL,
} from './nearbyStationNamingParser'

import {
  assertLngLat,
  sortAndProjectRecords,
} from './nearbyStationNamingScorer'

function makeRecord({ entryType, nameZh, nameEn, distanceMeters, importance, type, osmType, osmId, meta }) {
  const distScore = clamp(1 - distanceMeters / (MAX_RADIUS_METERS * 1.2), 0, 1)
  const score = entryType === 'road'
    ? importance * 0.82 + distScore * 0.18
    : importance * 0.72 + distScore * 0.28
  return {
    nameZh: nameZh || '',
    nameEn: nameEn || '',
    type: type || '',
    distanceMeters: Math.round(distanceMeters),
    importance: Math.round(importance * 1000) / 1000,
    score: Math.round(score * 1000) / 1000,
    source: `${osmType || ''}/${osmId || ''}`,
    meta: meta || null,
  }
}

const AREA_ADDRESS_KEYS = [
  { key: 'neighbourhood', type: '地域:neighbourhood', importance: 0.8 },
  { key: 'quarter', type: '地域:quarter', importance: 0.78 },
  { key: 'suburb', type: '地域:suburb', importance: 0.86 },
  { key: 'city_district', type: '行政区:city_district', importance: 0.88 },
  { key: 'town', type: '地域:town', importance: 0.92 },
  { key: 'village', type: '地域:village', importance: 0.76 },
]

const FACILITY_CATEGORIES = ['amenity', 'tourism', 'leisure', 'public_transport', 'railway', 'shop', 'office']

function parseNominatimRoad(data) {
  const addr = data?.address || {}
  const roadName = addr.road || ''
  if (!roadName) return null
  const highway = data?.extratags?.highway || ''
  const roadType = ROAD_IMPORTANCE[highway] != null ? highway : 'unclassified'
  return makeRecord({
    entryType: 'road',
    nameZh: roadName,
    nameEn: data?.namedetails?.['name:en'] || '',
    distanceMeters: 0,
    importance: ROAD_IMPORTANCE[roadType] ?? 0.76,
    type: ROAD_LABEL[roadType] || '道路',
    osmType: data?.osm_type || '',
    osmId: data?.osm_id || '',
    meta: { roadClass: roadType, roadClassLabel: ROAD_LABEL[roadType] || '道路' },
  })
}

function parseNominatimAreas(data) {
  const addr = data?.address || {}
  const records = []
  for (const { key, type, importance } of AREA_ADDRESS_KEYS) {
    const name = addr[key]
    if (!name) continue
    records.push(makeRecord({
      entryType: 'area',
      nameZh: name,
      nameEn: '',
      distanceMeters: 0,
      importance,
      type,
      osmType: '',
      osmId: '',
      meta: { areaKind: key },
    }))
  }
  return records
}

function parseNominatimFacility(data) {
  const extratags = data?.extratags || {}
  const category = data?.category || ''
  const type = data?.type || ''
  const name = data?.namedetails?.name || data?.name || ''
  if (!name) return null

  if (FACILITY_CATEGORIES.includes(category) || category === 'building') {
    return makeRecord({
      entryType: category === 'building' ? 'building' : 'facility',
      nameZh: name,
      nameEn: data?.namedetails?.['name:en'] || '',
      distanceMeters: 0,
      importance: 0.82,
      type: `${category}:${type}`,
      osmType: data?.osm_type || '',
      osmId: data?.osm_id || '',
      meta: { [category]: type },
    })
  }
  return null
}

export async function fetchNearbyStationNamingContext(lngLat, options = {}) {
  const center = assertLngLat(lngLat)
  const radiusMeters = clamp(
    Math.round(toFiniteNumber(options.radiusMeters, DEFAULT_RADIUS_METERS)),
    MIN_RADIUS_METERS,
    MAX_RADIUS_METERS,
  )
  const [lng, lat] = center

  const data = await reverseGeocode(lat, lng, { zoom: 18, signal: options.signal })

  const roads = []
  const areas = []
  const facilities = []
  const buildings = []

  const road = parseNominatimRoad(data)
  if (road) roads.push(road)

  areas.push(...parseNominatimAreas(data))

  const poi = parseNominatimFacility(data)
  if (poi) {
    if (poi.meta && Object.keys(poi.meta).some((k) => k === 'building')) {
      buildings.push(poi)
    } else {
      facilities.push(poi)
    }
  }

  return {
    center,
    radiusMeters,
    rawFeatureCount: 1,
    intersections: [],
    roads: sortAndProjectRecords(roads),
    areas: sortAndProjectRecords(areas),
    facilities: sortAndProjectRecords(facilities),
    buildings: sortAndProjectRecords(buildings),
  }
}

export { DEFAULT_RADIUS_METERS as STATION_NAMING_RADIUS_METERS }

export * from './nearbyStationNamingParser'
export * from './nearbyStationNamingScorer'
