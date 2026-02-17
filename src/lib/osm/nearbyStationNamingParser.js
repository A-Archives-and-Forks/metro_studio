export const DEFAULT_RADIUS_METERS = 200
export const MIN_RADIUS_METERS = 60
export const MAX_RADIUS_METERS = 800

export const ROAD_IMPORTANCE = {
  motorway: 1,
  trunk: 0.98,
  primary: 0.95,
  secondary: 0.9,
  tertiary: 0.84,
  unclassified: 0.76,
  residential: 0.68,
  living_street: 0.64,
  service: 0.56,
  pedestrian: 0.52,
  road: 0.5,
}

export const ROAD_LABEL = {
  motorway: '高速/快速路',
  trunk: '主干路',
  primary: '主干路',
  secondary: '次干路',
  tertiary: '支路',
  unclassified: '一般道路',
  residential: '居住区道路',
  living_street: '生活街道',
  service: '服务道路',
  pedestrian: '步行街',
  road: '道路',
}

export const PLACE_IMPORTANCE = {
  city: 1,
  town: 0.92,
  suburb: 0.86,
  borough: 0.84,
  neighbourhood: 0.8,
  quarter: 0.78,
  village: 0.76,
  hamlet: 0.7,
  locality: 0.68,
}

export const FACILITY_IMPORTANCE = {
  university: 1,
  college: 0.96,
  hospital: 0.95,
  clinic: 0.84,
  school: 0.86,
  government: 0.88,
  courthouse: 0.88,
  townhall: 0.86,
  library: 0.82,
  theatre: 0.83,
  arts_centre: 0.82,
  museum: 0.84,
  station: 0.92,
  bus_station: 0.83,
  public_transport: 0.78,
  shopping_centre: 0.87,
  marketplace: 0.8,
  park: 0.76,
  stadium: 0.82,
  sports_centre: 0.78,
}

export const LANDUSE_IMPORTANCE = {
  commercial: 0.82,
  retail: 0.8,
  residential: 0.72,
  industrial: 0.7,
  civic: 0.78,
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

export function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function normalizeNameKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-_()\[\]{}<>.,，。·•'"`]/g, '')
}

export function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value || '').trim()
    if (text) return text
  }
  return ''
}

export function round(value, digits = 0) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function buildNearbyContextQuery([lng, lat], radiusMeters) {
  const radius = clamp(Math.round(toFiniteNumber(radiusMeters, DEFAULT_RADIUS_METERS)), MIN_RADIUS_METERS, MAX_RADIUS_METERS)
  const safeLng = toFiniteNumber(lng).toFixed(6)
  const safeLat = toFiniteNumber(lat).toFixed(6)

  return `[out:json][timeout:35];
(
  node(around:${radius},${safeLat},${safeLng})["place"]["name"];
  way(around:${radius},${safeLat},${safeLng})["place"]["name"];
  relation(around:${radius},${safeLat},${safeLng})["place"]["name"];
  relation(around:${radius},${safeLat},${safeLng})["boundary"="administrative"]["name"];
  way(around:${radius},${safeLat},${safeLng})["landuse"]["name"];

  node(around:${radius},${safeLat},${safeLng})["amenity"]["name"];
  way(around:${radius},${safeLat},${safeLng})["amenity"]["name"];
  relation(around:${radius},${safeLat},${safeLng})["amenity"]["name"];
  node(around:${radius},${safeLat},${safeLng})["tourism"]["name"];
  way(around:${radius},${safeLat},${safeLng})["tourism"]["name"];
  node(around:${radius},${safeLat},${safeLng})["leisure"]["name"];
  way(around:${radius},${safeLat},${safeLng})["leisure"]["name"];
  node(around:${radius},${safeLat},${safeLng})["public_transport"]["name"];
  way(around:${radius},${safeLat},${safeLng})["public_transport"]["name"];
  node(around:${radius},${safeLat},${safeLng})["shop"]["name"];
  way(around:${radius},${safeLat},${safeLng})["shop"]["name"];
  node(around:${radius},${safeLat},${safeLng})["office"]["name"];
  way(around:${radius},${safeLat},${safeLng})["office"]["name"];
  node(around:${radius},${safeLat},${safeLng})["railway"~"station|halt"]["name"];
  way(around:${radius},${safeLat},${safeLng})["railway"~"station|halt"]["name"];

  node(around:${radius},${safeLat},${safeLng})["building"]["name"];
  way(around:${radius},${safeLat},${safeLng})["building"]["name"];
);
out center tags qt;`
}

export function buildNearbyRoadGeometryQuery([lng, lat], radiusMeters) {
  const radius = clamp(Math.round(toFiniteNumber(radiusMeters, DEFAULT_RADIUS_METERS)), MIN_RADIUS_METERS, MAX_RADIUS_METERS)
  const safeLng = toFiniteNumber(lng).toFixed(6)
  const safeLat = toFiniteNumber(lat).toFixed(6)

  return `[out:json][timeout:35];
(
  way(around:${radius},${safeLat},${safeLng})["highway"~"motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian|road"]["name"];
);
out tags geom qt;`
}

export function resolveElementLngLat(element) {
  if (!element || typeof element !== 'object') return null
  if (element.type === 'node') {
    const lng = toFiniteNumber(element.lon, Number.NaN)
    const lat = toFiniteNumber(element.lat, Number.NaN)
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null
  }
  const centerLng = toFiniteNumber(element.center?.lon, Number.NaN)
  const centerLat = toFiniteNumber(element.center?.lat, Number.NaN)
  if (Number.isFinite(centerLng) && Number.isFinite(centerLat)) {
    return [centerLng, centerLat]
  }
  return null
}

export function resolveElementNames(tags) {
  return {
    nameZh: firstNonEmpty(tags?.['name:zh'], tags?.name, tags?.['official_name:zh'], tags?.official_name),
    nameEn: firstNonEmpty(tags?.['name:en'], tags?.int_name, tags?.['name:latin'], tags?.['official_name:en']),
  }
}

export function resolveRoadType(tags) {
  const highway = String(tags?.highway || '').trim().toLowerCase()
  return ROAD_IMPORTANCE[highway] != null ? highway : ''
}

export function resolveAreaType(tags) {
  const place = String(tags?.place || '').trim().toLowerCase()
  if (PLACE_IMPORTANCE[place] != null) {
    return {
      type: `地域:${place}`,
      importance: PLACE_IMPORTANCE[place],
      meta: {
        areaKind: 'place',
        place,
      },
    }
  }
  const boundary = String(tags?.boundary || '').trim().toLowerCase()
  if (boundary === 'administrative') {
    const adminLevel = toFiniteNumber(tags?.admin_level, 10)
    const importance = clamp(1 - (Math.max(2, adminLevel) - 2) * 0.06, 0.6, 0.95)
    return {
      type: `行政区:${Math.round(adminLevel)}`,
      importance,
      meta: {
        areaKind: 'administrative',
        boundary,
        adminLevel: Math.round(adminLevel),
      },
    }
  }
  const landuse = String(tags?.landuse || '').trim().toLowerCase()
  if (LANDUSE_IMPORTANCE[landuse] != null) {
    return {
      type: `片区:${landuse}`,
      importance: LANDUSE_IMPORTANCE[landuse],
      meta: {
        areaKind: 'landuse',
        landuse,
      },
    }
  }
  return null
}

export function resolveFacilityType(tags) {
  const amenity = String(tags?.amenity || '').trim().toLowerCase()
  if (amenity) {
    return {
      type: `公共设施:${amenity}`,
      importance: FACILITY_IMPORTANCE[amenity] ?? 0.76,
      meta: {
        facilityKind: 'amenity',
        amenity,
      },
    }
  }
  const tourism = String(tags?.tourism || '').trim().toLowerCase()
  if (tourism) {
    return {
      type: `公共设施:${tourism}`,
      importance: FACILITY_IMPORTANCE[tourism] ?? 0.75,
      meta: {
        facilityKind: 'tourism',
        tourism,
      },
    }
  }
  const leisure = String(tags?.leisure || '').trim().toLowerCase()
  if (leisure) {
    return {
      type: `公共设施:${leisure}`,
      importance: FACILITY_IMPORTANCE[leisure] ?? 0.74,
      meta: {
        facilityKind: 'leisure',
        leisure,
      },
    }
  }
  const publicTransport = String(tags?.public_transport || '').trim().toLowerCase()
  if (publicTransport) {
    return {
      type: `交通设施:${publicTransport}`,
      importance: FACILITY_IMPORTANCE[publicTransport] ?? 0.78,
      meta: {
        facilityKind: 'public_transport',
        publicTransport,
      },
    }
  }
  const railway = String(tags?.railway || '').trim().toLowerCase()
  if (railway === 'station' || railway === 'halt') {
    return {
      type: `交通设施:${railway}`,
      importance: FACILITY_IMPORTANCE.station,
      meta: {
        facilityKind: 'railway',
        railway,
      },
    }
  }
  const shop = String(tags?.shop || '').trim().toLowerCase()
  if (shop) {
    return {
      type: `商业设施:${shop}`,
      importance: FACILITY_IMPORTANCE.shopping_centre ?? 0.72,
      meta: {
        facilityKind: 'shop',
        shop,
      },
    }
  }
  const office = String(tags?.office || '').trim().toLowerCase()
  if (office) {
    return {
      type: `机构:${office}`,
      importance: FACILITY_IMPORTANCE[office] ?? 0.72,
      meta: {
        facilityKind: 'office',
        office,
      },
    }
  }
  return null
}

export function resolveBuildingType(tags) {
  const building = String(tags?.building || '').trim().toLowerCase()
  if (!building) return null
  let importance = 0.66
  if (building === 'transportation' || building === 'station') importance = 0.84
  if (building === 'commercial' || building === 'retail') importance = 0.78
  if (building === 'hospital' || building === 'university' || building === 'civic') importance = 0.88
  return {
    type: `建筑:${building}`,
    importance,
    meta: {
      building,
    },
  }
}
