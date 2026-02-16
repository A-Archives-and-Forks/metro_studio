import {
  LAYER_EDGE_ANCHORS,
  LAYER_EDGE_ANCHORS_HIT,
  LAYER_EDGES,
  LAYER_EDGES_SQUARE,
  LAYER_EDGES_HIT,
  LAYER_EDGES_SELECTED,
  LAYER_STATIONS,
  SOURCE_EDGE_ANCHORS,
  SOURCE_EDGES,
  SOURCE_STATIONS,
} from './constants'
import {
  buildBoundaryGeoJson,
  buildEdgeAnchorsGeoJson,
  buildEdgesGeoJson,
  buildStationsGeoJson,
} from './dataBuilders'
import { LINE_STYLE_OPTIONS, getLineStyleMap } from '../../lib/lineStyles'

const lineStyleIds = LINE_STYLE_OPTIONS.map((item) => item.id)
const doubleLineStyleIds = lineStyleIds.filter((styleId) => getLineStyleMap(styleId).lineGapWidth > 0)
const edgeLayerCaps = {
  nonSquare: 'butt',
  square: 'square',
}

export function buildLineStyleNumericExpression(field) {
  const expression = ['case']
  for (const styleId of lineStyleIds) {
    expression.push(['==', ['get', 'lineStyle'], styleId], getLineStyleMap(styleId)[field])
  }
  expression.push(getLineStyleMap('solid')[field])
  return expression
}

export function buildLineDasharrayExpression() {
  const expression = ['case']
  for (const styleId of lineStyleIds) {
    expression.push(['==', ['get', 'lineStyle'], styleId], ['literal', getLineStyleMap(styleId).dasharray])
  }
  expression.push(['literal', getLineStyleMap('solid').dasharray])
  return expression
}

export function ensureSources(map, store) {
  if (!map) return

  if (!map.getSource(SOURCE_STATIONS)) {
    map.addSource(SOURCE_STATIONS, {
      type: 'geojson',
      data: buildStationsGeoJson(store.project, store.selectedStationIds),
    })
  }

  if (!map.getSource(SOURCE_EDGES)) {
    map.addSource(SOURCE_EDGES, {
      type: 'geojson',
      data: buildEdgesGeoJson(store.project),
    })
  }

  if (!map.getSource(SOURCE_EDGE_ANCHORS)) {
    map.addSource(SOURCE_EDGE_ANCHORS, {
      type: 'geojson',
      data: buildEdgeAnchorsGeoJson(store.project, store.selectedEdgeId, store.selectedEdgeAnchor),
    })
  }

  if (!map.getSource('region-boundary')) {
    map.addSource('region-boundary', {
      type: 'geojson',
      data: buildBoundaryGeoJson(store.regionBoundary),
    })
  } else {
    map.getSource('region-boundary').setData(buildBoundaryGeoJson(store.regionBoundary))
  }

  if (!map.getLayer('region-boundary-line')) {
    map.addLayer({
      id: 'region-boundary-line',
      type: 'line',
      source: 'region-boundary',
      paint: {
        'line-color': '#0EA5E9',
        'line-width': 1.5,
        'line-dasharray': [1.2, 1.2],
      },
    })
  }
}

function updateSelectedEdgeFilter(map, store) {
  if (!map || !map.getLayer(LAYER_EDGES_SELECTED)) return
  const selectedIds = Array.isArray(store.selectedEdgeIds) ? store.selectedEdgeIds : []
  if (!selectedIds.length) {
    map.setFilter(LAYER_EDGES_SELECTED, ['==', ['get', 'id'], '__none__'])
    return
  }
  map.setFilter(LAYER_EDGES_SELECTED, ['in', ['get', 'id'], ['literal', selectedIds]])
}

function getStationIdsForSelectedEdges(store) {
  const stationIds = new Set()
  for (const edgeId of store.selectedEdgeIds) {
    const edge = store.project?.edges?.find(e => e.id === edgeId)
    if (edge) {
      stationIds.add(edge.fromStationId)
      stationIds.add(edge.toStationId)
    }
  }
  return [...stationIds]
}

function updateStationVisibilityFilter(map, store) {
  if (!map || !map.getLayer(LAYER_STATIONS)) return
  const hasSelectedEdges = store.selectedEdgeIds && store.selectedEdgeIds.length > 0
  if (!hasSelectedEdges) {
    map.setFilter(LAYER_STATIONS, ['==', ['get', 'isInterchange'], true])
    return
  }
  const visibleStationIds = getStationIdsForSelectedEdges(store)
  map.setFilter(LAYER_STATIONS, [
    'any',
    ['==', ['get', 'isInterchange'], true],
    ['in', ['get', 'id'], ['literal', visibleStationIds]]
  ])
}

export function updateMapData(map, store) {
  if (!map) return
  const stationSource = map.getSource(SOURCE_STATIONS)
  const edgeSource = map.getSource(SOURCE_EDGES)
  const anchorSource = map.getSource(SOURCE_EDGE_ANCHORS)
  const filterYear = store.timelineFilterYear
  if (stationSource) {
    stationSource.setData(buildStationsGeoJson(store.project, store.selectedStationIds, filterYear))
  }
  if (edgeSource) {
    edgeSource.setData(buildEdgesGeoJson(store.project, filterYear))
  }
  if (anchorSource) {
    anchorSource.setData(buildEdgeAnchorsGeoJson(store.project, store.selectedEdgeId, store.selectedEdgeAnchor))
  }
  updateSelectedEdgeFilter(map, store)
  updateStationVisibilityFilter(map, store)
}

export function ensureMapLayers(map, store) {
  if (!map || !map.getSource(SOURCE_STATIONS)) return

  if (!map.getLayer(LAYER_EDGES_HIT)) {
    map.addLayer({
      id: LAYER_EDGES_HIT,
      type: 'line',
      source: SOURCE_EDGES,
      paint: {
        'line-color': '#000000',
        'line-width': 22,
        'line-opacity': 0.001,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    })
  }

  if (!map.getLayer(LAYER_EDGES_SELECTED)) {
    const selectedLayerConfig = {
      id: LAYER_EDGES_SELECTED,
      type: 'line',
      source: SOURCE_EDGES,
      filter: ['==', ['get', 'id'], ''],
      paint: {
        'line-color': '#F8FAFC',
        'line-width': [
          'case',
          ['in', ['get', 'lineStyle'], ['literal', doubleLineStyleIds]],
          11,
          8.5,
        ],
        'line-opacity': 0.96,
      },
      layout: {
        'line-cap': 'butt',
        'line-join': 'round',
      },
    }
    if (map.getLayer(LAYER_EDGES)) {
      map.addLayer(selectedLayerConfig, LAYER_EDGES)
    } else {
      map.addLayer(selectedLayerConfig)
    }
  }

  const edgePaint = {
    'line-color': ['coalesce', ['get', 'color'], '#2563EB'],
    'line-width': buildLineStyleNumericExpression('lineWidth'),
    'line-gap-width': buildLineStyleNumericExpression('lineGapWidth'),
    'line-opacity': 0.88,
    'line-dasharray': buildLineDasharrayExpression(),
  }

  if (!map.getLayer(LAYER_EDGES)) {
    map.addLayer({
      id: LAYER_EDGES,
      type: 'line',
      source: SOURCE_EDGES,
      filter: ['!=', ['get', 'lineStyle'], 'double-dotted-square'],
      paint: edgePaint,
      layout: {
        'line-cap': edgeLayerCaps.nonSquare,
        'line-join': 'round',
      },
    })
  }

  if (!map.getLayer(LAYER_EDGES_SQUARE)) {
    map.addLayer({
      id: LAYER_EDGES_SQUARE,
      type: 'line',
      source: SOURCE_EDGES,
      filter: ['==', ['get', 'lineStyle'], 'double-dotted-square'],
      paint: edgePaint,
      layout: {
        'line-cap': edgeLayerCaps.square,
        'line-join': 'round',
      },
    })
  }

  updateSelectedEdgeFilter(map, store)

  if (!map.getLayer(LAYER_EDGE_ANCHORS_HIT)) {
    map.addLayer({
      id: LAYER_EDGE_ANCHORS_HIT,
      type: 'circle',
      source: SOURCE_EDGE_ANCHORS,
      paint: {
        'circle-radius': 12,
        'circle-color': '#000000',
        'circle-opacity': 0.001,
      },
    })
  }

  if (!map.getLayer(LAYER_EDGE_ANCHORS)) {
    map.addLayer({
      id: LAYER_EDGE_ANCHORS,
      type: 'circle',
      source: SOURCE_EDGE_ANCHORS,
      paint: {
        'circle-radius': ['case', ['==', ['get', 'isSelected'], true], 6, 5],
        'circle-color': ['case', ['==', ['get', 'isSelected'], true], '#F97316', '#38BDF8'],
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#082F49',
        'circle-opacity': 0.95,
      },
    })
  }

  if (!map.getLayer(LAYER_STATIONS)) {
    map.addLayer({
      id: LAYER_STATIONS,
      type: 'circle',
      source: SOURCE_STATIONS,
      paint: {
        'circle-radius': [
          'case',
          ['==', ['get', 'isSelected'], true],
          7,
          ['==', ['get', 'isInterchange'], true],
          6,
          4.8,
        ],
        'circle-color': [
          'case',
          ['==', ['get', 'proposed'], true],
          '#9CA3AF',
          ['==', ['get', 'underConstruction'], true],
          '#F59E0B',
          '#FFFFFF',
        ],
        'circle-stroke-width': ['case', ['==', ['get', 'isSelected'], true], 3, 2],
        'circle-stroke-color': '#0F172A',
      },
    })
    updateStationVisibilityFilter(map, store)
  }

  if (!map.getLayer('railmap-stations-label')) {
    map.addLayer({
      id: 'railmap-stations-label',
      type: 'symbol',
      source: SOURCE_STATIONS,
      layout: {
        'text-field': [
          'case',
          ['>', ['length', ['coalesce', ['get', 'nameEn'], '']], 0],
          [
            'format',
            ['coalesce', ['get', 'nameZh'], ''],
            {},
            '\n',
            {},
            ['get', 'nameEn'],
            { 'font-scale': 0.8 },
          ],
          ['coalesce', ['get', 'nameZh'], ''],
        ],
        'text-font': ['Noto Sans CJK SC Regular', 'Noto Sans Regular'],
        'text-size': 12,
        'text-offset': [0.8, 0.2],
        'text-anchor': 'left',
      },
      paint: {
        'text-color': '#111827',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.4,
      },
    })
  }
}
