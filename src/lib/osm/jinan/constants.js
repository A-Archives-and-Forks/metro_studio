import bbox from '@turf/bbox'
import { multiPolygon, polygon } from '@turf/helpers'
import jinanBoundaryGeoJson from '../../../data/jinan-boundary.json'
import { JINAN_RELATION_ID } from '../../projectModel'

const AREA_ID = 3600000000 + JINAN_RELATION_ID

const OPEN_ROUTE_QUERY = `
[out:json][timeout:120];
area(${AREA_ID})->.a;
relation(area.a)["type"="route"]["route"~"subway|light_rail"];
out body;
>;
out body qt;
`.trim()

const CONSTRUCTION_ROUTE_QUERY = `
[out:json][timeout:120];
area(${AREA_ID})->.a;
(
  relation(area.a)["type"="route"]["route"="construction"];
  relation(area.a)["type"="route"]["construction"~"subway|light_rail"];
  relation(area.a)["type"="route"]["state"="construction"];
);
out body;
>;
out body qt;
`.trim()

const PROPOSED_ROUTE_QUERY = `
[out:json][timeout:120];
area(${AREA_ID})->.a;
(
  relation(area.a)["type"="route"]["state"="proposed"];
  relation(area.a)["type"="route"]["proposed"~"subway|light_rail"];
);
out body;
>;
out body qt;
`.trim()

function buildStandaloneStationQuery(includeConstruction, includeProposed) {
  const clauses = []

  if (includeConstruction) {
    clauses.push('node(area.a)["construction:railway"~"station|subway|light_rail"];')
    clauses.push('node(area.a)["railway"="construction"]["station"~"subway|light_rail"];')
    clauses.push('node(area.a)["railway"="station"]["station"~"subway|light_rail"]["state"="construction"];')
    clauses.push('node(area.a)["railway"="station"]["station"~"subway|light_rail"]["construction"];')
  }

  if (includeProposed) {
    clauses.push('node(area.a)["proposed:railway"~"station|subway|light_rail"];')
    clauses.push('node(area.a)["railway"="proposed"]["station"~"subway|light_rail"];')
    clauses.push('node(area.a)["railway"="station"]["station"~"subway|light_rail"]["state"="proposed"];')
    clauses.push('node(area.a)["railway"="station"]["station"~"subway|light_rail"]["proposed"];')
  }

  if (!clauses.length) return null

  return `
[out:json][timeout:120];
area(${AREA_ID})->.a;
(
  ${clauses.join('\n  ')}
);
out body;
`.trim()
}

const boundaryFeature =
  jinanBoundaryGeoJson.type === 'Polygon'
    ? polygon(jinanBoundaryGeoJson.coordinates)
    : multiPolygon(jinanBoundaryGeoJson.coordinates)

const boundaryBbox = bbox(boundaryFeature)

const STOP_ROLE_REGEX = /(stop|platform|station)/i
const SAME_LINE_MERGE_DISTANCE_METERS = 520
const CROSS_LINE_MERGE_DISTANCE_METERS = 320
const VERY_CLOSE_FORCE_MERGE_METERS = 28
const ZH_DIRECTION_SUFFIX_PATTERN = /\s*(?:[-—–~～→↔⇄⟷]|至|到)\s*.+$/u
const EN_DIRECTION_SUFFIX_PATTERN = /\s*(?:[-—–~～→↔⇄⟷]|\bto\b)\s*.+$/iu

export {
  AREA_ID,
  OPEN_ROUTE_QUERY,
  CONSTRUCTION_ROUTE_QUERY,
  PROPOSED_ROUTE_QUERY,
  buildStandaloneStationQuery,
  boundaryFeature,
  boundaryBbox,
  STOP_ROLE_REGEX,
  SAME_LINE_MERGE_DISTANCE_METERS,
  CROSS_LINE_MERGE_DISTANCE_METERS,
  VERY_CLOSE_FORCE_MERGE_METERS,
  ZH_DIRECTION_SUFFIX_PATTERN,
  EN_DIRECTION_SUFFIX_PATTERN,
}
