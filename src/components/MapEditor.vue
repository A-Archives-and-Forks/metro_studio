<script setup>
import maplibregl from 'maplibre-gl'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useProjectStore } from '../stores/projectStore'
import { haversineDistanceMeters } from '../lib/geo'
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
} from './map-editor/constants'
import {
  buildBoundaryGeoJson,
  buildEdgeAnchorsGeoJson,
  buildEdgesGeoJson,
  buildStationsGeoJson,
  collectProjectBounds,
  sanitizeFileName,
} from './map-editor/dataBuilders'
import { buildMapStyle } from './map-editor/mapStyle'
import { LINE_STYLE_OPTIONS, getLineStyleMap } from '../lib/lineStyles'
import { generateStationNameCandidates } from '../lib/ai/stationNaming'
import { fetchNearbyStationNamingContext, STATION_NAMING_RADIUS_METERS } from '../lib/osm/nearbyStationNamingContext'
import { useDialog } from '../composables/useDialog.js'
import TimelineSlider from './TimelineSlider.vue'
import { createTimelinePlayer } from '../lib/timeline/timelinePlayer.js'

const store = useProjectStore()
const { confirm, prompt } = useDialog()
const mapContainer = ref(null)
const contextMenuRef = ref(null)
const aiStationMenuRef = ref(null)
let map = null
let dragState = null
let anchorDragState = null
let suppressNextMapClick = false
let scaleControl = null
let aiNamingAbortController = null
let isMapReadyForBoundary = false
const ROUTE_DRAW_SHORT_DISTANCE_METERS = 500
const ROUTE_DRAW_LONG_DISTANCE_METERS = 2000
const ROUTE_DRAW_SHORT_COLOR = '#EF4444'
const ROUTE_DRAW_LONG_COLOR = '#A855F7'

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function easeInOutQuart(t) {
  return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2
}

function easeInOutQuint(t) {
  return t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2
}

// Timeline player
let timelinePlayer = null
function ensureTimelinePlayer() {
  if (timelinePlayer) return timelinePlayer
  timelinePlayer = createTimelinePlayer({
    onYearChange(year) {
      store.setTimelineFilterYear(year)
    },
    onStateChange(state) {
      store.setTimelinePlaybackState(state)
    },
    onPlaybackEnd() {
      store.setTimelinePlaybackState('idle')
    },
  })
  return timelinePlayer
}

function onTimelineYearChange(year) {
  store.setTimelineFilterYear(year)
  if (timelinePlayer) timelinePlayer.seekTo(year)
}

function onTimelinePlay() {
  const player = ensureTimelinePlayer()
  player.setYears(store.timelineYears)
  player.setSpeed(store.timelinePlayback.speed)
  player.play(store.timelinePlayback.state === 'idle')
}

function onTimelinePause() {
  timelinePlayer?.pause()
}

function onTimelineStop() {
  timelinePlayer?.stop()
  store.setTimelineFilterYear(null)
}

function onTimelineSpeedChange(speed) {
  store.setTimelinePlaybackSpeed(speed)
  if (timelinePlayer) timelinePlayer.setSpeed(speed)
}

const selectionBox = reactive({
  active: false,
  append: false,
  startX: 0,
  startY: 0,
  endX: 0,
  endY: 0,
})

const lineStyleIds = LINE_STYLE_OPTIONS.map((item) => item.id)
const doubleLineStyleIds = lineStyleIds.filter((styleId) => getLineStyleMap(styleId).lineGapWidth > 0)
const edgeLayerCaps = {
  nonSquare: 'butt',
  square: 'square',
}

function buildLineStyleNumericExpression(field) {
  const expression = ['case']
  for (const styleId of lineStyleIds) {
    expression.push(['==', ['get', 'lineStyle'], styleId], getLineStyleMap(styleId)[field])
  }
  expression.push(getLineStyleMap('solid')[field])
  return expression
}

function buildLineDasharrayExpression() {
  const expression = ['case']
  for (const styleId of lineStyleIds) {
    expression.push(['==', ['get', 'lineStyle'], styleId], ['literal', getLineStyleMap(styleId).dasharray])
  }
  expression.push(['literal', getLineStyleMap('solid').dasharray])
  return expression
}

const contextMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  targetType: 'map',
  lngLat: null,
  stationId: null,
  edgeId: null,
  anchorIndex: null,
})

const aiStationMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  lngLat: null,
  stationId: null,
  loading: false,
  error: '',
  candidates: [],
  requestVersion: 0,
})

const lineSelectionMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  lineOptions: [],
})

const stationCount = computed(() => store.project?.stations.length || 0)
const edgeCount = computed(() => store.project?.edges.length || 0)
const selectedEdgeLabel = computed(() => String(store.selectedEdgeIds?.length || 0))
const contextMenuStyle = computed(() => ({
  left: `${contextMenu.x}px`,
  top: `${contextMenu.y}px`,
}))
const aiStationMenuStyle = computed(() => ({
  left: `${aiStationMenu.x}px`,
  top: `${aiStationMenu.y}px`,
}))
const lineSelectionMenuStyle = computed(() => ({
  left: `${lineSelectionMenu.x}px`,
  top: `${lineSelectionMenu.y}px`,
}))
const hasSelection = computed(
  () => store.selectedStationIds.length > 0 || (store.selectedEdgeIds?.length || 0) > 0 || Boolean(store.selectedEdgeAnchor),
)
const contextStation = computed(() => {
  if (!store.project || !contextMenu.stationId) return null
  return store.project.stations.find((station) => station.id === contextMenu.stationId) || null
})
const contextTargetLabel = computed(() => {
  if (contextMenu.targetType === 'anchor') return '锚点'
  if (contextMenu.targetType === 'station') return '站点'
  if (contextMenu.targetType === 'edge') return '线段'
  return '地图空白'
})
const selectionBoxStyle = computed(() => {
  const left = Math.min(selectionBox.startX, selectionBox.endX)
  const top = Math.min(selectionBox.startY, selectionBox.endY)
  const width = Math.abs(selectionBox.endX - selectionBox.startX)
  const height = Math.abs(selectionBox.endY - selectionBox.startY)
  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
  }
})
const routeDrawPreview = reactive({
  visible: false,
  startLngLat: null,
  endLngLat: null,
  startX: 0,
  startY: 0,
  endX: 0,
  endY: 0,
  pointerX: 0,
  pointerY: 0,
  distanceMeters: 0,
  lineColor: '#2563EB',
})
const routeDrawDistanceLabel = computed(() =>
  Number.isFinite(routeDrawPreview.distanceMeters) ? `${Math.round(routeDrawPreview.distanceMeters)} m` : '',
)
const routeDrawDistanceStyle = computed(() => ({
  left: `${routeDrawPreview.pointerX + 14}px`,
  top: `${routeDrawPreview.pointerY + 14}px`,
}))

function isTextInputTarget(target) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select'
}

function closeContextMenu() {
  contextMenu.visible = false
  contextMenu.targetType = 'map'
  contextMenu.stationId = null
  contextMenu.edgeId = null
  contextMenu.anchorIndex = null
  contextMenu.lngLat = null
}

function abortAiNamingRequest() {
  if (!aiNamingAbortController) return
  aiNamingAbortController.abort(new Error('aborted'))
  aiNamingAbortController = null
}

function closeAiStationMenu(options = {}) {
  const shouldAbort = options.abort !== false
  if (shouldAbort) {
    abortAiNamingRequest()
  }
  aiStationMenu.visible = false
  aiStationMenu.loading = false
  aiStationMenu.error = ''
  aiStationMenu.candidates = []
  aiStationMenu.lngLat = null
  aiStationMenu.stationId = null
}

function closeLineSelectionMenu() {
  lineSelectionMenu.visible = false
  lineSelectionMenu.lineOptions = []
}

async function adjustContextMenuPosition() {
  await nextTick()
  if (!mapContainer.value || !contextMenuRef.value || !contextMenu.visible) return
  const containerRect = mapContainer.value.getBoundingClientRect()
  const menuRect = contextMenuRef.value.getBoundingClientRect()
  const padding = 8
  const maxX = Math.max(padding, containerRect.width - menuRect.width - padding)
  const maxY = Math.max(padding, containerRect.height - menuRect.height - padding)
  contextMenu.x = Math.max(padding, Math.min(contextMenu.x, maxX))
  contextMenu.y = Math.max(padding, Math.min(contextMenu.y, maxY))
}

async function adjustAiStationMenuPosition() {
  await nextTick()
  if (!mapContainer.value || !aiStationMenuRef.value || !aiStationMenu.visible) return
  const containerRect = mapContainer.value.getBoundingClientRect()
  const menuRect = aiStationMenuRef.value.getBoundingClientRect()
  const padding = 8
  const maxX = Math.max(padding, containerRect.width - menuRect.width - padding)
  const maxY = Math.max(padding, containerRect.height - menuRect.height - padding)
  aiStationMenu.x = Math.max(padding, Math.min(aiStationMenu.x, maxX))
  aiStationMenu.y = Math.max(padding, Math.min(aiStationMenu.y, maxY))
}

function openAiStationMenu({ x, y, lngLat, stationId }) {
  abortAiNamingRequest()
  aiStationMenu.visible = true
  aiStationMenu.x = Number.isFinite(x) ? x : 0
  aiStationMenu.y = Number.isFinite(y) ? y : 0
  aiStationMenu.lngLat = Array.isArray(lngLat) ? [...lngLat] : null
  aiStationMenu.stationId = stationId || null
  aiStationMenu.loading = true
  aiStationMenu.error = ''
  aiStationMenu.candidates = []
  aiStationMenu.requestVersion += 1
  adjustAiStationMenuPosition()
}

function openLineSelectionMenu({ x, y, lineOptions }) {
  closeContextMenu()
  closeAiStationMenu()
  lineSelectionMenu.visible = true
  lineSelectionMenu.x = Number.isFinite(x) ? x : 0
  lineSelectionMenu.y = Number.isFinite(y) ? y : 0
  lineSelectionMenu.lineOptions = Array.isArray(lineOptions) ? lineOptions : []
  adjustLineSelectionMenuPosition()
}

async function adjustLineSelectionMenuPosition() {
  await nextTick()
  if (!mapContainer.value || !lineSelectionMenu.visible) return
  const menuWidth = 268
  const menuHeight = Math.min(lineSelectionMenu.lineOptions.length * 60 + 80, 400)
  const containerRect = mapContainer.value.getBoundingClientRect()
  const padding = 8
  const maxX = Math.max(padding, containerRect.width - menuWidth - padding)
  const maxY = Math.max(padding, containerRect.height - menuHeight - padding)
  lineSelectionMenu.x = Math.max(padding, Math.min(lineSelectionMenu.x, maxX))
  lineSelectionMenu.y = Math.max(padding, Math.min(lineSelectionMenu.y, maxY))
}

function selectLineFromMenu(lineId) {
  store.selectLine(lineId)
  closeLineSelectionMenu()
}

function openContextMenu(event) {
  if (!mapContainer.value) return
  closeAiStationMenu()
  const point = event.point || { x: 0, y: 0 }
  const anchors = map.queryRenderedFeatures(point, { layers: [LAYER_EDGE_ANCHORS_HIT] })
  const stations = map.queryRenderedFeatures(point, { layers: [LAYER_STATIONS] })
  const edges = map.queryRenderedFeatures(point, { layers: [LAYER_EDGES_HIT] })

  const anchorEdgeId = anchors[0]?.properties?.edgeId || null
  const anchorIndexRaw = anchors[0]?.properties?.anchorIndex
  const anchorIndex = Number.isInteger(Number(anchorIndexRaw)) ? Number(anchorIndexRaw) : null
  const stationId = stations[0]?.properties?.id || null
  const edgeId = anchorEdgeId || edges[0]?.properties?.id || null
  const targetType = anchorEdgeId && anchorIndex != null ? 'anchor' : stationId ? 'station' : edgeId ? 'edge' : 'map'

  if (anchorEdgeId && anchorIndex != null) {
    store.selectEdgeAnchor(anchorEdgeId, anchorIndex)
  } else if (stationId) {
    store.setSelectedStations([stationId])
  } else if (edgeId) {
    store.selectEdge(edgeId)
  }

  contextMenu.x = point.x
  contextMenu.y = point.y
  contextMenu.targetType = targetType
  contextMenu.stationId = stationId
  contextMenu.edgeId = edgeId
  contextMenu.anchorIndex = anchorIndex
  contextMenu.lngLat = [event.lngLat.lng, event.lngLat.lat]
  contextMenu.visible = true
  adjustContextMenuPosition()
}

function onContextOverlayMouseDown(event) {
  if (event.button !== 0 && event.button !== 2) return
  closeContextMenu()
}

function onAiMenuOverlayMouseDown(event) {
  if (event.button !== 0 && event.button !== 2) return
  closeAiStationMenu()
}

function onLineSelectionMenuOverlayMouseDown(event) {
  if (event.button !== 0 && event.button !== 2) return
  closeLineSelectionMenu()
}

function clearRouteDrawPreview() {
  routeDrawPreview.visible = false
  routeDrawPreview.startLngLat = null
  routeDrawPreview.endLngLat = null
  routeDrawPreview.distanceMeters = 0
}

function findStationById(stationId) {
  if (!store.project || !stationId) return null
  return store.project.stations.find((station) => station.id === stationId) || null
}

function getActiveLineBaseColor() {
  if (!store.project) return '#2563EB'
  const activeLine = store.project.lines.find((line) => line.id === store.activeLineId)
  return activeLine?.color || '#2563EB'
}

function resolveRouteDrawColorByDistance(distanceMeters) {
  if (distanceMeters < ROUTE_DRAW_SHORT_DISTANCE_METERS) return ROUTE_DRAW_SHORT_COLOR
  if (distanceMeters > ROUTE_DRAW_LONG_DISTANCE_METERS) return ROUTE_DRAW_LONG_COLOR
  return getActiveLineBaseColor()
}

function refreshRouteDrawPreviewProjectedPoints() {
  if (!map || !routeDrawPreview.visible || !routeDrawPreview.startLngLat || !routeDrawPreview.endLngLat) return
  const startPoint = map.project(routeDrawPreview.startLngLat)
  const endPoint = map.project(routeDrawPreview.endLngLat)
  routeDrawPreview.startX = startPoint.x
  routeDrawPreview.startY = startPoint.y
  routeDrawPreview.endX = endPoint.x
  routeDrawPreview.endY = endPoint.y
}

function updateRouteDrawPreview(event) {
  if (!map || store.mode !== 'route-draw' || !store.pendingEdgeStartStationId) {
    clearRouteDrawPreview()
    return
  }
  const startStation = findStationById(store.pendingEdgeStartStationId)
  if (!startStation?.lngLat) {
    clearRouteDrawPreview()
    return
  }

  const hitStations = map.queryRenderedFeatures(event.point, { layers: [LAYER_STATIONS] })
  const hoveredStationId = hitStations[0]?.properties?.id || null
  const hoveredStation = hoveredStationId ? findStationById(hoveredStationId) : null
  const endLngLat = hoveredStation?.lngLat || [event.lngLat.lng, event.lngLat.lat]
  const distanceMeters = haversineDistanceMeters(startStation.lngLat, endLngLat)

  routeDrawPreview.visible = true
  routeDrawPreview.startLngLat = [...startStation.lngLat]
  routeDrawPreview.endLngLat = [...endLngLat]
  routeDrawPreview.pointerX = event.point.x
  routeDrawPreview.pointerY = event.point.y
  routeDrawPreview.distanceMeters = distanceMeters
  routeDrawPreview.lineColor = resolveRouteDrawColorByDistance(distanceMeters)
  refreshRouteDrawPreviewProjectedPoints()
}

function setModeFromContext(mode) {
  store.setMode(mode)
  closeContextMenu()
}

function addStationAtContext() {
  if (!contextMenu.lngLat) return
  store.addStationAt([...contextMenu.lngLat])
  closeContextMenu()
}

async function requestAiCandidatesForStation({ lngLat, stationId, screenPoint } = {}) {
  if (!Array.isArray(lngLat) || lngLat.length !== 2 || !stationId) return

  store.setSelectedStations([stationId])
  const projected = map ? map.project(lngLat) : { x: 0, y: 0 }
  const x = Number.isFinite(screenPoint?.x) ? screenPoint.x : projected.x
  const y = Number.isFinite(screenPoint?.y) ? screenPoint.y : projected.y

  openAiStationMenu({ x, y, lngLat, stationId })
  const requestVersion = aiStationMenu.requestVersion
  const controller = new AbortController()
  aiNamingAbortController = controller

  try {
    store.statusText = `AI点站：正在采集周边 ${STATION_NAMING_RADIUS_METERS}m OSM 要素...`
    const namingContext = await fetchNearbyStationNamingContext(lngLat, {
      radiusMeters: STATION_NAMING_RADIUS_METERS,
      signal: controller.signal,
    })

    if (controller.signal.aborted || requestVersion !== aiStationMenu.requestVersion) return

    store.statusText = 'AI点站：正在调用 LLM 生成候选站名...'
    const candidates = await generateStationNameCandidates({
      context: namingContext,
      lngLat,
      signal: controller.signal,
    })

    if (controller.signal.aborted || requestVersion !== aiStationMenu.requestVersion) return

    aiStationMenu.loading = false
    aiStationMenu.error = ''
    aiStationMenu.candidates = candidates
    store.statusText = `AI点站：已生成 ${candidates.length} 个候选，请在菜单中选择`
    adjustAiStationMenuPosition()
  } catch (error) {
    if (controller.signal.aborted || requestVersion !== aiStationMenu.requestVersion) return
    const message = String(error?.message || '未知错误')
    aiStationMenu.loading = false
    aiStationMenu.candidates = []
    aiStationMenu.error = message
    store.statusText = `AI点站失败: ${message}`
    adjustAiStationMenuPosition()
  } finally {
    if (aiNamingAbortController === controller) {
      aiNamingAbortController = null
    }
  }
}

async function addAiStationAt(lngLat, screenPoint) {
  if (!Array.isArray(lngLat) || lngLat.length !== 2) return
  const station = store.addStationAt([...lngLat])
  if (!station?.id) return
  await requestAiCandidatesForStation({
    lngLat: [...lngLat],
    stationId: station.id,
    screenPoint,
  })
}

function addAiStationAtContext() {
  if (!contextMenu.lngLat) return
  const lngLat = [...contextMenu.lngLat]
  const screenPoint = { x: contextMenu.x, y: contextMenu.y }
  closeContextMenu()
  void addAiStationAt(lngLat, screenPoint)
}

function applyAiStationCandidate(candidate) {
  if (!aiStationMenu.stationId || !candidate) return
  store.updateStationName(aiStationMenu.stationId, {
    nameZh: candidate.nameZh,
    nameEn: candidate.nameEn,
  })
  store.setSelectedStations([aiStationMenu.stationId])
  store.statusText = `AI点站命名已应用: ${candidate.nameZh}`
  closeAiStationMenu({ abort: false })
}

function retryAiStationNamingFromMenu() {
  if (!aiStationMenu.stationId || !aiStationMenu.lngLat) return
  void requestAiCandidatesForStation({
    lngLat: [...aiStationMenu.lngLat],
    stationId: aiStationMenu.stationId,
    screenPoint: { x: aiStationMenu.x, y: aiStationMenu.y },
  })
}

function aiRenameContextStationFromContext() {
  if (!contextStation.value?.id || !Array.isArray(contextStation.value.lngLat)) return
  const stationId = contextStation.value.id
  const lngLat = [...contextStation.value.lngLat]
  const screenPoint = { x: contextMenu.x, y: contextMenu.y }
  closeContextMenu()
  void requestAiCandidatesForStation({
    lngLat,
    stationId,
    screenPoint,
  })
}

async function aiTranslateContextStationEnglishFromContext() {
  if (!contextStation.value?.id) return
  const stationId = contextStation.value.id
  closeContextMenu()
  try {
    await store.retranslateStationEnglishNamesByIdsWithAi([stationId])
  } catch (error) {
    const message = String(error?.message || '翻译失败')
    store.statusText = `站点英文翻译失败: ${message}`
  }
}

function clearSelectionFromContext() {
  store.clearSelection()
  closeContextMenu()
}

function addEdgeAnchorFromContext() {
  if (!contextMenu.edgeId || !contextMenu.lngLat) return
  store.addEdgeAnchor(contextMenu.edgeId, [...contextMenu.lngLat])
  closeContextMenu()
}

function removeEdgeAnchorFromContext() {
  if (!contextMenu.edgeId || contextMenu.anchorIndex == null) return
  store.removeEdgeAnchor(contextMenu.edgeId, contextMenu.anchorIndex)
  closeContextMenu()
}

async function clearContextEdgeAnchorsFromContext() {
  if (!contextMenu.edgeId) return
  const ok = await confirm({ title: '清空锚点', message: '确认清空该线段全部锚点吗？' })
  if (!ok) return
  store.clearEdgeAnchors(contextMenu.edgeId)
  closeContextMenu()
}

async function renameContextStationFromContext() {
  if (!contextStation.value) return
  const nameZh = await prompt({ title: '站点中文名', message: '输入站点中文名', defaultValue: contextStation.value.nameZh || '', placeholder: '中文名' })
  if (nameZh == null) return
  const nameEn = await prompt({ title: '站点英文名', message: '输入站点英文名', defaultValue: contextStation.value.nameEn || '', placeholder: '英文名' })
  if (nameEn == null) return
  store.updateStationName(contextStation.value.id, {
    nameZh,
    nameEn,
  })
  closeContextMenu()
}

async function deleteContextStationFromContext() {
  if (!contextMenu.stationId) return
  const ok = await confirm({ title: '删除站点', message: '确认删除该站点吗？', confirmText: '删除', danger: true })
  if (!ok) return
  store.setSelectedStations([contextMenu.stationId])
  store.deleteSelectedStations()
  closeContextMenu()
}

async function deleteContextEdgeFromContext() {
  if (!contextMenu.edgeId) return
  const ok = await confirm({ title: '删除线段', message: '确认删除该线段吗？', confirmText: '删除', danger: true })
  if (!ok) return
  store.selectEdge(contextMenu.edgeId)
  store.deleteSelectedEdge()
  closeContextMenu()
}

function splitEdgeAtContext() {
  if (!contextMenu.edgeId || !contextMenu.lngLat) return
  store.splitEdgeAtPoint(contextMenu.edgeId, [...contextMenu.lngLat])
  closeContextMenu()
}

function mergeEdgesAtContextStation() {
  if (!contextMenu.stationId) return
  store.mergeEdgesAtStation(contextMenu.stationId)
  closeContextMenu()
}

const canMergeAtContextStation = computed(() => {
  if (!contextMenu.stationId) return false
  return store.canMergeEdgesAtStation(contextMenu.stationId)
})

function traceActualExport(step, payload) {
  const suffix = payload == null ? '' : ` ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`
  const message = `[实际走向图导出] ${step}${suffix}`
  console.info(message)
  store.statusText = message
}

function waitForMapIdle() {
  if (!map) return Promise.reject(new Error('真实地图未初始化'))
  if (map.loaded() && !map.isMoving()) return Promise.resolve()
  return new Promise((resolve) => {
    map.once('idle', resolve)
  })
}

function waitForMapRenderFrame() {
  if (!map) return Promise.reject(new Error('真实地图未初始化'))
  return new Promise((resolve) => {
    map.once('render', resolve)
    map.triggerRepaint()
  })
}


async function fitMapToProjectForExport(project) {
  const bounds = collectProjectBounds(project)
  if (!bounds) return

  const lngSpan = Math.abs(bounds.maxLng - bounds.minLng)
  const latSpan = Math.abs(bounds.maxLat - bounds.minLat)
  if (lngSpan < 1e-6 && latSpan < 1e-6) {
    map.jumpTo({
      center: [bounds.minLng, bounds.minLat],
      zoom: Math.max(map.getZoom(), 13.5),
      bearing: 0,
      pitch: 0,
    })
    await waitForMapRenderFrame()
    return
  }

  map.fitBounds(
    [
      [bounds.minLng, bounds.minLat],
      [bounds.maxLng, bounds.maxLat],
    ],
    {
      padding: { top: 52, bottom: 52, left: 52, right: 52 },
      maxZoom: 16,
      bearing: 0,
      pitch: 0,
      duration: 0,
    },
  )
  await waitForMapIdle()
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
        return
      }
      reject(new Error('实际走向图导出失败'))
    }, 'image/png')
  })
}

async function blobHasVisualContent(blob) {
  try {
    const probe = document.createElement('canvas')
    probe.width = 32
    probe.height = 32
    const context = probe.getContext('2d', { willReadFrequently: true })
    if (!context) return true

    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(blob)
      try {
        context.drawImage(bitmap, 0, 0, probe.width, probe.height)
      } finally {
        bitmap.close?.()
      }
    } else {
      const image = await loadBlobAsImage(blob)
      context.drawImage(image, 0, 0, probe.width, probe.height)
    }

    const { data } = context.getImageData(0, 0, probe.width, probe.height)
    let nonTransparent = 0
    let minLum = 255
    let maxLum = 0

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3]
      if (alpha <= 8) continue
      nonTransparent += 1
      const lum = Math.round((data[i] + data[i + 1] + data[i + 2]) / 3)
      if (lum < minLum) minLum = lum
      if (lum > maxLum) maxLum = lum
    }

    if (nonTransparent < 40) return false
    return maxLum - minLum > 18
  } catch {
    // If content probing is unsupported in current runtime, do not block export.
    return true
  }
}

function loadBlobAsImage(blob) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const objectUrl = URL.createObjectURL(blob)
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('无法读取导出图像'))
    }
    image.src = objectUrl
  })
}

async function captureMapFrameBlob(maxAttempts = 6, stageName = '主流程') {
  traceActualExport('开始抓帧', { stageName, maxAttempts })
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    traceActualExport('抓帧尝试', { stageName, attempt: attempt + 1 })
    await waitForMapRenderFrame()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const sourceCanvas = map.getCanvas()
    const exportCanvas = document.createElement('canvas')
    exportCanvas.width = sourceCanvas.width
    exportCanvas.height = sourceCanvas.height
    const context = exportCanvas.getContext('2d', { alpha: false })
    if (!context) {
      throw new Error('实际走向图导出失败: 无法创建画布上下文')
    }
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, exportCanvas.width, exportCanvas.height)
    context.drawImage(sourceCanvas, 0, 0)

    const blob = await canvasToPngBlob(exportCanvas)
    if (await blobHasVisualContent(blob)) {
      traceActualExport('抓帧成功', { stageName, attempt: attempt + 1, size: blob.size })
      return blob
    }
    traceActualExport('抓帧结果无有效内容，准备重试', { stageName, attempt: attempt + 1 })
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  traceActualExport('抓帧失败', { stageName })
  return null
}

async function exportActualRoutePngFromMap({ project, stationVisibilityMode = 'all' } = {}) {
  if (!map) {
    throw new Error('真实地图未初始化')
  }

  traceActualExport('开始导出')
  const normalizedStationVisibilityMode = ['all', 'interchange', 'none'].includes(stationVisibilityMode)
    ? stationVisibilityMode
    : 'all'
  traceActualExport('应用导出站点模式', normalizedStationVisibilityMode)
  const cameraState = {
    center: map.getCenter(),
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  }
  const labelLayerId = 'railmap-stations-label'
  const stationLayerId = LAYER_STATIONS
  const hasLabelLayer = Boolean(map.getLayer(labelLayerId))
  const hasStationLayer = Boolean(map.getLayer(stationLayerId))
  const previousLabelVisibility = hasLabelLayer ? map.getLayoutProperty(labelLayerId, 'visibility') || 'visible' : 'visible'
  const previousStationVisibility = hasStationLayer ? map.getLayoutProperty(stationLayerId, 'visibility') || 'visible' : 'visible'
  const previousStationFilter = hasStationLayer ? map.getFilter(stationLayerId) : null

  let pngBlob = null
  try {
    traceActualExport('等待地图空闲')
    await waitForMapIdle()
    if (hasLabelLayer) {
      map.setLayoutProperty(labelLayerId, 'visibility', 'none')
      traceActualExport('隐藏站名图层')
    }
    if (hasStationLayer) {
      if (normalizedStationVisibilityMode === 'none') {
        map.setLayoutProperty(stationLayerId, 'visibility', 'none')
        traceActualExport('隐藏车站图层')
      } else if (normalizedStationVisibilityMode === 'interchange') {
        map.setLayoutProperty(stationLayerId, 'visibility', 'visible')
        map.setFilter(stationLayerId, ['==', ['get', 'isInterchange'], true])
        traceActualExport('车站图层仅保留换乘站')
      } else {
        map.setLayoutProperty(stationLayerId, 'visibility', 'visible')
        map.setFilter(stationLayerId, null)
        traceActualExport('显示全部车站')
      }
    }
    traceActualExport('定位全网范围')
    await fitMapToProjectForExport(project || store.project)
    pngBlob = await captureMapFrameBlob(6, '主流程')
    if (!pngBlob && map.getLayer('osm-base')) {
      traceActualExport('主流程抓帧失败，尝试隐藏底图回退')
      const previousVisibility = map.getLayoutProperty('osm-base', 'visibility') || 'visible'
      try {
        map.setLayoutProperty('osm-base', 'visibility', 'none')
        pngBlob = await captureMapFrameBlob(4, '隐藏底图回退')
      } finally {
        map.setLayoutProperty('osm-base', 'visibility', previousVisibility)
        await waitForMapRenderFrame()
        traceActualExport('恢复底图可见性')
      }
    }
  } finally {
    try {
      if (hasLabelLayer && map.getLayer(labelLayerId)) {
        map.setLayoutProperty(labelLayerId, 'visibility', previousLabelVisibility)
      }
      if (hasStationLayer && map.getLayer(stationLayerId)) {
        map.setLayoutProperty(stationLayerId, 'visibility', previousStationVisibility)
        map.setFilter(stationLayerId, previousStationFilter || null)
      }
      map.jumpTo({
        center: cameraState.center,
        zoom: cameraState.zoom,
        bearing: cameraState.bearing,
        pitch: cameraState.pitch,
      })
      await waitForMapRenderFrame()
      traceActualExport('恢复原视角完成')
    } catch (restoreError) {
      traceActualExport('恢复阶段异常（不影响下载）', restoreError?.message || String(restoreError))
    }
  }

  if (!pngBlob) {
    traceActualExport('导出失败：未获取到有效图像')
    throw new Error('实际走向图导出失败: 底图帧不可读，请稍后重试')
  }

  const fileName = `${sanitizeFileName(project?.name || store.project?.name, 'railmap')}_实际走向图.png`
  const url = URL.createObjectURL(pngBlob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  traceActualExport('下载已触发', { fileName, size: pngBlob.size })
}

function lockMapNorthUp() {
  if (!map) return
  map.dragRotate?.disable()
  map.touchZoomRotate?.disableRotation()
  map.setBearing(0)
  map.setPitch(0)
}

function ensureMapLayers() {
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

  updateSelectedEdgeFilter()

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

function ensureSources() {
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

  if (!map.getSource('jinan-boundary')) {
    map.addSource('jinan-boundary', {
      type: 'geojson',
      data: buildBoundaryGeoJson(store.regionBoundary),
    })
  } else {
    map.getSource('jinan-boundary').setData(buildBoundaryGeoJson(store.regionBoundary))
  }

  if (!map.getLayer('jinan-boundary-line')) {
    map.addLayer({
      id: 'jinan-boundary-line',
      type: 'line',
      source: 'jinan-boundary',
      paint: {
        'line-color': '#0EA5E9',
        'line-width': 1.5,
        'line-dasharray': [1.2, 1.2],
      },
    })
  }
}

function updateSelectedEdgeFilter() {
  if (!map || !map.getLayer(LAYER_EDGES_SELECTED)) return
  const selectedIds = Array.isArray(store.selectedEdgeIds) ? store.selectedEdgeIds : []
  if (!selectedIds.length) {
    map.setFilter(LAYER_EDGES_SELECTED, ['==', ['get', 'id'], '__none__'])
    return
  }
  map.setFilter(LAYER_EDGES_SELECTED, ['in', ['get', 'id'], ['literal', selectedIds]])
}

function updateMapData() {
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
  updateSelectedEdgeFilter()
}

function handleWindowResize() {
  if (map) {
    map.resize()
  }
  if (contextMenu.visible) {
    adjustContextMenuPosition()
  }
  if (aiStationMenu.visible) {
    adjustAiStationMenuPosition()
  }
}

/**
 * BFS to find the shortest edge path between two stations.
 * Tries same-line-only first; falls back to unrestricted BFS.
 */
function findEdgePathBetweenStations(fromStationId, toStationId) {
  const edges = store.project?.edges
  if (!edges?.length) return []

  const adj = new Map()
  for (const edge of edges) {
    const a = edge.fromStationId
    const b = edge.toStationId
    if (!a || !b) continue
    if (!adj.has(a)) adj.set(a, [])
    if (!adj.has(b)) adj.set(b, [])
    adj.get(a).push({ neighbor: b, edgeId: edge.id, lineIds: edge.sharedByLineIds || [] })
    adj.get(b).push({ neighbor: a, edgeId: edge.id, lineIds: edge.sharedByLineIds || [] })
  }

  if (!adj.has(fromStationId) || !adj.has(toStationId)) return []

  // Find shared lines between the two stations' connected edges
  const fromLineIds = new Set(adj.get(fromStationId).flatMap(l => l.lineIds))
  const toLineIds = new Set(adj.get(toStationId).flatMap(l => l.lineIds))
  const sharedLineIds = [...fromLineIds].filter(lid => toLineIds.has(lid))

  // Try line-restricted BFS for each shared line
  for (const lineId of sharedLineIds) {
    const result = bfsOnLine(adj, fromStationId, toStationId, lineId)
    if (result.length) return result
  }

  // Fallback: unrestricted BFS
  return bfsUnrestricted(adj, fromStationId, toStationId)
}

function bfsOnLine(adj, fromId, toId, lineId) {
  const visited = new Set([fromId])
  const queue = [{ stationId: fromId, edgePath: [] }]
  let head = 0
  while (head < queue.length) {
    const cur = queue[head++]
    for (const link of adj.get(cur.stationId) || []) {
      if (visited.has(link.neighbor)) continue
      if (!link.lineIds.includes(lineId)) continue
      const newPath = [...cur.edgePath, link.edgeId]
      if (link.neighbor === toId) return newPath
      visited.add(link.neighbor)
      queue.push({ stationId: link.neighbor, edgePath: newPath })
    }
  }
  return []
}

function bfsUnrestricted(adj, fromId, toId) {
  const visited = new Set([fromId])
  const queue = [{ stationId: fromId, edgePath: [] }]
  let head = 0
  while (head < queue.length) {
    const cur = queue[head++]
    for (const link of adj.get(cur.stationId) || []) {
      if (visited.has(link.neighbor)) continue
      const newPath = [...cur.edgePath, link.edgeId]
      if (link.neighbor === toId) return newPath
      visited.add(link.neighbor)
      queue.push({ stationId: link.neighbor, edgePath: newPath })
    }
  }
  return []
}

function handleStationClick(event) {
  closeContextMenu()
  closeAiStationMenu()
  suppressNextMapClick = true
  const stationId = event.features?.[0]?.properties?.id
  if (!stationId) return
  if (store.mode === 'ai-add-station') {
    const station = store.project?.stations?.find((item) => item.id === stationId)
    if (!station?.lngLat) return
    void requestAiCandidatesForStation({
      lngLat: [...station.lngLat],
      stationId: station.id,
      screenPoint: event.point,
    })
    return
  }
  if (store.mode === 'route-draw') {
    store.selectStation(stationId)
    return
  }
  const mouseEvent = event.originalEvent
  const isShift = Boolean(mouseEvent?.shiftKey)
  const isMultiModifier = Boolean(isShift || mouseEvent?.ctrlKey || mouseEvent?.metaKey)

  // Shift+click two stations → select all edges on the path between them
  if (isShift && store.mode === 'select' && store.selectedStationIds.length === 1 && store.selectedStationIds[0] !== stationId) {
    const fromId = store.selectedStationIds[0]
    const pathEdgeIds = findEdgePathBetweenStations(fromId, stationId)
    if (pathEdgeIds.length) {
      store.setSelectedEdges(pathEdgeIds, { keepStations: false })
      store.setSelectedStations([fromId, stationId], { keepEdges: true })
      store.statusText = `已选中路径上 ${pathEdgeIds.length} 条线段`
      return
    }
  }

  store.selectStation(stationId, {
    multi: isMultiModifier && store.mode === 'select',
    toggle: isMultiModifier && store.mode === 'select',
  })
}

function isLineDrawMode() {
  return store.mode === 'add-edge' || store.mode === 'route-draw'
}

function handleEdgeClick(event) {
  closeContextMenu()
  suppressNextMapClick = true
  if (!map) return
  if (isLineDrawMode()) return
  const overlappingStations = map.queryRenderedFeatures(event.point, { layers: [LAYER_STATIONS] })
  if (overlappingStations.length) return
  const edgeId = event.features?.[0]?.properties?.id
  if (!edgeId) return
  const mouseEvent = event.originalEvent
  if (mouseEvent?.altKey) {
    const edge = store.project?.edges?.find((e) => e.id === edgeId)
    if (!edge?.sharedByLineIds?.length) return
    if (edge.sharedByLineIds.length === 1) {
      store.selectLine(edge.sharedByLineIds[0])
    } else {
      const lineOptions = edge.sharedByLineIds
        .map((lineId) => {
          const line = store.project.lines.find((l) => l.id === lineId)
          if (!line) return null
          return {
            id: line.id,
            nameZh: line.nameZh,
            nameEn: line.nameEn,
            color: line.color,
          }
        })
        .filter(Boolean)
      if (lineOptions.length) {
        openLineSelectionMenu({ x: event.point.x, y: event.point.y, lineOptions })
      }
    }
    return
  }
  if (store.mode !== 'select') {
    store.setMode('select')
  }
  const isMultiModifier = Boolean(mouseEvent?.shiftKey || mouseEvent?.ctrlKey || mouseEvent?.metaKey)
  store.selectEdge(edgeId, {
    multi: isMultiModifier,
    toggle: isMultiModifier,
    keepStationSelection: isMultiModifier,
  })
  const selectedCount = store.selectedEdgeIds?.length || 0
  store.statusText = selectedCount > 1 ? `已选中线段 ${selectedCount} 条` : `已选中线段: ${edgeId}`
}

function handleEdgeAnchorClick(event) {
  closeContextMenu()
  suppressNextMapClick = true
  if (isLineDrawMode()) return
  const edgeId = event.features?.[0]?.properties?.edgeId
  const anchorIndexRaw = event.features?.[0]?.properties?.anchorIndex
  const anchorIndex = Number(anchorIndexRaw)
  if (!edgeId || !Number.isInteger(anchorIndex)) return
  if (store.mode !== 'select') {
    store.setMode('select')
  }
  store.selectEdgeAnchor(edgeId, anchorIndex)
  store.statusText = `已选中锚点: ${edgeId} #${anchorIndex}`
}

function handleMapClick(event) {
  closeContextMenu()
  closeAiStationMenu()
  if (!map) return
  if (suppressNextMapClick) {
    suppressNextMapClick = false
    return
  }
  const hitAnchors = map.queryRenderedFeatures(event.point, { layers: [LAYER_EDGE_ANCHORS_HIT] })
  const hitStations = map.queryRenderedFeatures(event.point, { layers: [LAYER_STATIONS] })
  const hitEdges = map.queryRenderedFeatures(event.point, { layers: [LAYER_EDGES_HIT] })
  if (hitAnchors.length) return
  if (hitStations.length) return
  if (hitEdges.length) return
  if (store.mode === 'add-station') {
    store.addStationAt([event.lngLat.lng, event.lngLat.lat])
    return
  }
  if (store.mode === 'ai-add-station') {
    void addAiStationAt([event.lngLat.lng, event.lngLat.lat], event.point)
    return
  }
  if (store.mode === 'route-draw') {
    const station = store.addStationAt([event.lngLat.lng, event.lngLat.lat])
    if (station?.id) {
      store.selectStation(station.id)
    }
    return
  }
  if (store.mode === 'select') {
    const mouseEvent = event.originalEvent
    const keepSelection = Boolean(mouseEvent?.shiftKey || mouseEvent?.ctrlKey || mouseEvent?.metaKey)
    if (!keepSelection) {
      store.clearSelection()
    }
  }
}

function handleMapContextMenu(event) {
  if (!map) return
  event.originalEvent?.preventDefault()
  openContextMenu(event)
}

function startStationDrag(event) {
  closeContextMenu()
  closeAiStationMenu()
  if (store.mode !== 'select') return
  const stationId = event.features?.[0]?.properties?.id
  if (!stationId) return
  const mouseEvent = event.originalEvent
  if (mouseEvent?.shiftKey || mouseEvent?.ctrlKey || mouseEvent?.metaKey) {
    return
  }

  if (!store.selectedStationIds.includes(stationId)) {
    store.selectStation(stationId)
  }
  const stationIds = store.selectedStationIds.includes(stationId) ? [...store.selectedStationIds] : [stationId]
  dragState = {
    stationIds,
    lastLngLat: [event.lngLat.lng, event.lngLat.lat],
  }
  map.getCanvas().style.cursor = 'grabbing'
  map.dragPan.disable()
}

function startEdgeAnchorDrag(event) {
  closeContextMenu()
  closeAiStationMenu()
  if (store.mode !== 'select') return
  const edgeId = event.features?.[0]?.properties?.edgeId
  const anchorIndexRaw = event.features?.[0]?.properties?.anchorIndex
  const anchorIndex = Number(anchorIndexRaw)
  if (!edgeId || !Number.isInteger(anchorIndex)) return

  store.selectEdgeAnchor(edgeId, anchorIndex)
  anchorDragState = {
    edgeId,
    anchorIndex,
  }
  map.getCanvas().style.cursor = 'grabbing'
  map.dragPan.disable()
  suppressNextMapClick = true
}

function onMouseMove(event) {
  if (store.mode === 'route-draw' && !selectionBox.active && !dragState && !anchorDragState) {
    updateRouteDrawPreview(event)
  } else {
    clearRouteDrawPreview()
  }

  if (selectionBox.active) {
    selectionBox.endX = event.point.x
    selectionBox.endY = event.point.y
  }

  if (anchorDragState) {
    store.updateEdgeAnchor(anchorDragState.edgeId, anchorDragState.anchorIndex, [event.lngLat.lng, event.lngLat.lat])
    return
  }

  if (!dragState) return
  const delta = [event.lngLat.lng - dragState.lastLngLat[0], event.lngLat.lat - dragState.lastLngLat[1]]
  dragState.lastLngLat = [event.lngLat.lng, event.lngLat.lat]
  store.moveStationsByDelta(dragState.stationIds, delta)
}

function stopStationDrag() {
  if (selectionBox.active) {
    const minX = Math.min(selectionBox.startX, selectionBox.endX)
    const maxX = Math.max(selectionBox.startX, selectionBox.endX)
    const minY = Math.min(selectionBox.startY, selectionBox.endY)
    const maxY = Math.max(selectionBox.startY, selectionBox.endY)

    const selectionBounds = [
      [minX, minY],
      [maxX, maxY],
    ]
    const pickedStationIds = [
      ...new Set(
        map
          .queryRenderedFeatures(selectionBounds, { layers: [LAYER_STATIONS] })
          .map((feature) => String(feature?.properties?.id || '').trim())
          .filter(Boolean),
      ),
    ]
    const pickedEdgeIds = [
      ...new Set(
        map
          .queryRenderedFeatures(selectionBounds, { layers: [LAYER_EDGES_HIT] })
          .map((feature) => String(feature?.properties?.id || '').trim())
          .filter(Boolean),
      ),
    ]

    if (pickedStationIds.length || pickedEdgeIds.length) {
      if (selectionBox.append) {
        if (pickedStationIds.length) {
          store.selectStations(pickedStationIds, { replace: false, keepEdges: true })
        }
        if (pickedEdgeIds.length) {
          store.selectEdges(pickedEdgeIds, { replace: false, keepStations: true })
        }
      } else if (pickedStationIds.length && pickedEdgeIds.length) {
        store.setSelectedStations(pickedStationIds, { keepEdges: true })
        store.setSelectedEdges(pickedEdgeIds, { keepStations: true })
      } else if (pickedStationIds.length) {
        store.setSelectedStations(pickedStationIds)
      } else {
        store.setSelectedEdges(pickedEdgeIds)
      }
    } else if (!selectionBox.append) {
      store.clearSelection()
    }
    suppressNextMapClick = true

    selectionBox.active = false
    map.getCanvas().style.cursor = ''
    map.dragPan.enable()
  }

  if (anchorDragState) {
    anchorDragState = null
    map.getCanvas().style.cursor = ''
    map.dragPan.enable()
  }

  if (dragState) {
    dragState = null
    map.getCanvas().style.cursor = ''
    map.dragPan.enable()
  }
}

function startBoxSelection(event) {
  closeContextMenu()
  closeAiStationMenu()
  if (store.mode !== 'select') return
  if (selectionBox.active) return
  const mouseEvent = event.originalEvent
  if (mouseEvent?.button !== 0) return
  const modifier = Boolean(mouseEvent?.shiftKey || mouseEvent?.ctrlKey || mouseEvent?.metaKey)
  if (!modifier) return

  const hitAnchors = map.queryRenderedFeatures(event.point, { layers: [LAYER_EDGE_ANCHORS_HIT] })
  const hitStations = map.queryRenderedFeatures(event.point, { layers: [LAYER_STATIONS] })
  const hitEdges = map.queryRenderedFeatures(event.point, { layers: [LAYER_EDGES_HIT] })
  if (hitAnchors.length) return
  if (hitStations.length) return
  if (hitEdges.length) return

  selectionBox.active = true
  selectionBox.append = modifier
  selectionBox.startX = event.point.x
  selectionBox.startY = event.point.y
  selectionBox.endX = event.point.x
  selectionBox.endY = event.point.y
  map.getCanvas().style.cursor = 'crosshair'
  map.dragPan.disable()
}

function onInteractiveFeatureEnter() {
  if (!map || selectionBox.active || dragState || anchorDragState) return
  map.getCanvas().style.cursor = 'pointer'
}

function onInteractiveFeatureLeave() {
  if (!map || selectionBox.active || dragState || anchorDragState) return
  map.getCanvas().style.cursor = ''
}

function handleWindowKeyDown(event) {
  if (isTextInputTarget(event.target)) return
  const key = String(event.key || '').toLowerCase()
  const hasModifier = Boolean(event.ctrlKey || event.metaKey)

  if (hasModifier && key === 'z') {
    event.preventDefault()
    if (event.shiftKey) {
      store.redo()
    } else {
      store.undo()
    }
    return
  }

  if (hasModifier && key === 'y') {
    event.preventDefault()
    store.redo()
    return
  }

  if (hasModifier && key === 'a') {
    event.preventDefault()
    store.selectAllStations()
    return
  }

  if (event.key === 'Escape') {
    if (aiStationMenu.visible) {
      closeAiStationMenu()
      return
    }
    if (contextMenu.visible) {
      closeContextMenu()
      return
    }
    store.cancelPendingEdgeStart()
    store.clearSelection()
    return
  }

  if (event.key !== 'Delete' && event.key !== 'Backspace') return

  if (store.selectedEdgeAnchor) {
    event.preventDefault()
    store.removeSelectedEdgeAnchor()
    return
  }

  if (store.selectedStationIds.length) {
    event.preventDefault()
    store.deleteSelectedStations()
    return
  }
  if ((store.selectedEdgeIds?.length || 0) > 0) {
    event.preventDefault()
    store.deleteSelectedEdge()
  }
}

onMounted(() => {
  store.registerActualRoutePngExporter(exportActualRoutePngFromMap)
  map = new maplibregl.Map({
    container: mapContainer.value,
    style: buildMapStyle(),
    center: [117.1138, 36.6519],
    zoom: 10.5,
    bearing: 0,
    pitch: 0,
    dragRotate: false,
    touchPitch: false,
    maxPitch: 0,
    boxZoom: false,
    preserveDrawingBuffer: true,
    attributionControl: true,
  })
  lockMapNorthUp()

  map.addControl(new maplibregl.NavigationControl(), 'top-right')
  scaleControl = new maplibregl.ScaleControl({
    maxWidth: 120,
    unit: 'metric',
  })
  map.addControl(scaleControl, 'bottom-left')

  map.on('load', () => {
    lockMapNorthUp()
    ensureSources()
    ensureMapLayers()
    updateMapData()
    map.resize()
    
    isMapReadyForBoundary = true
    
    if (store.regionBoundary) {
      console.log('[MapEditor on load] Found existing boundary, fitting to it')
      fitMapToBoundary(store.regionBoundary)
    }

    map.on('click', LAYER_STATIONS, handleStationClick)
    map.on('mousedown', LAYER_STATIONS, startStationDrag)
    map.on('click', LAYER_EDGES_HIT, handleEdgeClick)
    map.on('click', LAYER_EDGE_ANCHORS_HIT, handleEdgeAnchorClick)
    map.on('mousedown', LAYER_EDGE_ANCHORS_HIT, startEdgeAnchorDrag)
    map.on('mouseenter', LAYER_STATIONS, onInteractiveFeatureEnter)
    map.on('mouseleave', LAYER_STATIONS, onInteractiveFeatureLeave)
    map.on('mouseenter', LAYER_EDGES_HIT, onInteractiveFeatureEnter)
    map.on('mouseleave', LAYER_EDGES_HIT, onInteractiveFeatureLeave)
    map.on('mouseenter', LAYER_EDGE_ANCHORS_HIT, onInteractiveFeatureEnter)
    map.on('mouseleave', LAYER_EDGE_ANCHORS_HIT, onInteractiveFeatureLeave)
  })

  map.on('click', handleMapClick)
  map.on('contextmenu', handleMapContextMenu)
  map.on('mousedown', startBoxSelection)
  map.on('mousemove', onMouseMove)
  map.on('mouseup', stopStationDrag)
  map.on('mouseleave', stopStationDrag)
  map.on('move', refreshRouteDrawPreviewProjectedPoints)
  window.addEventListener('resize', handleWindowResize)
  window.addEventListener('keydown', handleWindowKeyDown)
})

onBeforeUnmount(() => {
  isMapReadyForBoundary = false
  store.unregisterActualRoutePngExporter(exportActualRoutePngFromMap)
  window.removeEventListener('resize', handleWindowResize)
  window.removeEventListener('keydown', handleWindowKeyDown)
  closeContextMenu()
  closeAiStationMenu()
  timelinePlayer?.destroy()
  timelinePlayer = null
  scaleControl = null
  if (map) {
    map.remove()
  }
})

watch(
  () => ({
    mode: store.mode,
    pendingEdgeStartStationId: store.pendingEdgeStartStationId,
  }),
  () => {
    if (store.mode !== 'route-draw' || !store.pendingEdgeStartStationId) {
      clearRouteDrawPreview()
    }
  },
  { deep: false },
)

watch(
  () => store.mode,
  () => {
    if (contextMenu.visible) closeContextMenu()
    if (aiStationMenu.visible) closeAiStationMenu()
  },
)

watch(
  () => ({
    project: store.project,
    selectedStationId: store.selectedStationId,
    selectedStationIds: store.selectedStationIds,
    selectedEdgeId: store.selectedEdgeId,
    selectedEdgeIds: store.selectedEdgeIds,
    selectedEdgeAnchor: store.selectedEdgeAnchor,
    boundary: store.regionBoundary,
    timelineFilterYear: store.timelineFilterYear,
  }),
  () => {
    if (!map || !map.isStyleLoaded()) return
    ensureSources()
    ensureMapLayers()
    updateMapData()
  },
  { deep: true },
)

let lastRegionBoundaryHash = null

function computeBoundaryHash(boundary) {
  try {
    if (!boundary || !boundary.type) return null
    
    const bbox = extractBboxFromGeoJson(boundary)
    if (!bbox) return null
    
    const hash = `${boundary.type}_${bbox.minLng.toFixed(6)}_${bbox.minLat.toFixed(6)}_${bbox.maxLng.toFixed(6)}_${bbox.maxLat.toFixed(6)}`
    console.log('[computeBoundaryHash] Generated hash:', hash)
    return hash
  } catch (error) {
    console.error('Error computing boundary hash:', error)
    return null
  }
}

function extractBboxFromGeoJson(geoJson) {
  try {
    if (!geoJson || !geoJson.type || !geoJson.coordinates) return null
    
    const coords = []
    const geometry = geoJson
    
    function flattenPolygon(rings) {
      if (!Array.isArray(rings)) return
      for (const ring of rings) {
        if (!Array.isArray(ring)) continue
        for (const coord of ring) {
          if (Array.isArray(coord) && coord.length >= 2) {
            const [lng, lat] = coord
            if (Number.isFinite(lng) && Number.isFinite(lat)) {
              coords.push([lng, lat])
            }
          }
        }
      }
    }
    
    if (geometry.type === 'Polygon') {
      flattenPolygon(geometry.coordinates)
    } else if (geometry.type === 'MultiPolygon') {
      if (!Array.isArray(geometry.coordinates)) return null
      for (const polygon of geometry.coordinates) {
        flattenPolygon(polygon)
      }
    } else {
      return null
    }
    
    if (!coords.length) return null
    
    let minLng = Infinity
    let minLat = Infinity
    let maxLng = -Infinity
    let maxLat = -Infinity
    
    for (const [lng, lat] of coords) {
      minLng = Math.min(minLng, lng)
      minLat = Math.min(minLat, lat)
      maxLng = Math.max(maxLng, lng)
      maxLat = Math.max(maxLat, lat)
    }
    
    if (!Number.isFinite(minLng) || !Number.isFinite(minLat) || 
        !Number.isFinite(maxLng) || !Number.isFinite(maxLat)) {
      return null
    }
    
    return { minLng, minLat, maxLng, maxLat }
  } catch (error) {
    console.error('Error extracting bbox from geojson:', error)
    return null
  }
}

function fitMapToBoundary(boundary) {
  try {
    console.log('[fitMapToBoundary] Called with boundary:', boundary)
    
    if (!map) {
      console.log('[fitMapToBoundary] Map is null, returning')
      return
    }
    
    if (!boundary) {
      console.log('[fitMapToBoundary] Boundary is null, returning')
      return
    }
    
    const bbox = extractBboxFromGeoJson(boundary)
    console.log('[fitMapToBoundary] Extracted bbox:', bbox)
    
    if (!bbox) {
      console.log('[fitMapToBoundary] Failed to extract bbox, returning')
      return
    }
    
    const lngSpan = Math.abs(bbox.maxLng - bbox.minLng)
    const latSpan = Math.abs(bbox.maxLat - bbox.minLat)
    console.log('[fitMapToBoundary] Span:', lngSpan, latSpan)
    
    if (lngSpan < 1e-6 && latSpan < 1e-6) {
      console.log('[fitMapToBoundary] Using easeTo (small span)')
      map.easeTo({
        center: [bbox.minLng, bbox.minLat],
        zoom: Math.max(map.getZoom(), 12),
        bearing: 0,
        pitch: 0,
        duration: 1000,
        easing: easeInOutCubic,
      })
    } else {
      console.log('[fitMapToBoundary] Using fitBounds')
      map.fitBounds(
        [
          [bbox.minLng, bbox.minLat],
          [bbox.maxLng, bbox.maxLat],
        ],
        {
          padding: { top: 80, bottom: 80, left: 80, right: 80 },
          maxZoom: 14,
          bearing: 0,
          pitch: 0,
          duration: 1200,
          easing: easeInOutCubic,
        },
      )
    }
    
    console.log('[fitMapToBoundary] Map fit completed')
  } catch (error) {
    console.error('[fitMapToBoundary] Failed to fit map to boundary:', error)
  }
}

watch(
  () => store.regionBoundary,
  async (newBoundary) => {
    console.log('[MapEditor watch] regionBoundary changed:', newBoundary)
    
    if (!isMapReadyForBoundary) {
      console.log('[MapEditor watch] Map not ready yet, skipping')
      return
    }
    
    if (!newBoundary) {
      console.log('[MapEditor watch] Boundary is null, skipping')
      return
    }
    
    const boundaryHash = computeBoundaryHash(newBoundary)
    console.log('[MapEditor watch] boundaryHash:', boundaryHash, 'lastHash:', lastRegionBoundaryHash)
    
    if (boundaryHash && boundaryHash !== lastRegionBoundaryHash) {
      lastRegionBoundaryHash = boundaryHash
      console.log('[MapEditor watch] Boundary hash changed, will fit map')
      
      await nextTick()
      
      if (!map.isStyleLoaded()) {
        console.log('[MapEditor watch] Waiting for map style to load...')
        await new Promise((resolve) => {
          const checkInterval = setInterval(() => {
            if (map.isStyleLoaded()) {
              clearInterval(checkInterval)
              resolve()
            }
          }, 50)
          
          setTimeout(() => {
            clearInterval(checkInterval)
            resolve()
          }, 5000)
        })
      }
      
      fitMapToBoundary(newBoundary)
    } else {
      console.log('[MapEditor watch] Boundary hash unchanged or null, skipping')
    }
  },
  { deep: false },
)
</script>

<template>
  <section class="map-editor">
    <div class="map-editor__container">
      <div ref="mapContainer" class="map-editor__map" @contextmenu.prevent></div>
      <div v-if="selectionBox.active" class="map-editor__selection-box" :style="selectionBoxStyle"></div>
      <svg v-if="routeDrawPreview.visible" class="map-editor__route-preview" aria-hidden="true">
        <line
          :x1="routeDrawPreview.startX"
          :y1="routeDrawPreview.startY"
          :x2="routeDrawPreview.endX"
          :y2="routeDrawPreview.endY"
          :stroke="routeDrawPreview.lineColor"
          stroke-width="4"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-dasharray="8 6"
        />
      </svg>
      <div v-if="routeDrawPreview.visible" class="map-editor__distance-badge" :style="routeDrawDistanceStyle">
        {{ routeDrawDistanceLabel }}
      </div>

      <div
        v-if="contextMenu.visible"
        class="map-editor__context-mask"
        @mousedown="onContextOverlayMouseDown"
        @contextmenu.prevent="onContextOverlayMouseDown"
      >
        <div
          ref="contextMenuRef"
          class="map-editor__context-menu"
          :style="contextMenuStyle"
          @mousedown.stop
          @contextmenu.prevent
        >
          <h3>{{ contextTargetLabel }}菜单</h3>
          <p class="map-editor__context-meta">模式: {{ store.mode }} | 已选: {{ hasSelection ? '是' : '否' }}</p>
          <p v-if="contextMenu.stationId" class="map-editor__context-meta">站点: {{ contextMenu.stationId }}</p>
          <p v-if="contextMenu.edgeId" class="map-editor__context-meta">线段: {{ contextMenu.edgeId }}</p>
          <p v-if="contextMenu.anchorIndex != null" class="map-editor__context-meta">锚点序号: {{ contextMenu.anchorIndex }}</p>
          <p v-if="contextMenu.lngLat" class="map-editor__context-meta">
            坐标: {{ contextMenu.lngLat[0].toFixed(6) }}, {{ contextMenu.lngLat[1].toFixed(6) }}
          </p>

          <div class="map-editor__context-section">
            <p>模式</p>
            <div class="map-editor__context-row">
              <button @click="setModeFromContext('select')">选择/拖拽</button>
              <button @click="setModeFromContext('add-station')">点站</button>
              <button @click="setModeFromContext('ai-add-station')">AI点站</button>
              <button @click="setModeFromContext('add-edge')">拉线</button>
              <button @click="setModeFromContext('route-draw')">连续布线</button>
            </div>
          </div>

          <div v-if="contextMenu.targetType === 'map'" class="map-editor__context-section">
            <p>空白处操作</p>
            <div class="map-editor__context-row">
              <button @click="addStationAtContext" :disabled="!contextMenu.lngLat">在此新增站点</button>
              <button @click="addAiStationAtContext" :disabled="!contextMenu.lngLat">AI 在此新增站点</button>
              <button @click="clearSelectionFromContext">清空选择</button>
            </div>
          </div>

          <div v-if="contextMenu.targetType === 'station'" class="map-editor__context-section">
            <p>站点操作</p>
            <div class="map-editor__context-row">
              <button @click="aiRenameContextStationFromContext" :disabled="!contextStation">AI命名该站点</button>
              <button
                @click="aiTranslateContextStationEnglishFromContext"
                :disabled="!contextStation || store.isStationEnglishRetranslating"
              >
                {{ store.isStationEnglishRetranslating ? '翻译中...' : 'AI翻译英文' }}
              </button>
              <button @click="renameContextStationFromContext" :disabled="!contextStation">重命名站点</button>
              <button @click="deleteContextStationFromContext" :disabled="!contextMenu.stationId">删除该站点</button>
            </div>
            <div class="map-editor__context-row">
              <button @click="mergeEdgesAtContextStation" :disabled="!canMergeAtContextStation">合并相邻线段</button>
            </div>
          </div>

          <div v-if="contextMenu.targetType === 'edge'" class="map-editor__context-section">
            <p>线段操作</p>
            <div class="map-editor__context-row">
              <button @click="splitEdgeAtContext" :disabled="!contextMenu.edgeId || !contextMenu.lngLat">在此处插入站点</button>
              <button @click="addEdgeAnchorFromContext" :disabled="!contextMenu.edgeId || !contextMenu.lngLat">在此加锚点</button>
              <button @click="deleteContextEdgeFromContext" :disabled="!contextMenu.edgeId">删除该线段</button>
            </div>
            <div class="map-editor__context-row">
              <button @click="clearContextEdgeAnchorsFromContext" :disabled="!contextMenu.edgeId">清空该线段锚点</button>
            </div>
          </div>

          <div v-if="contextMenu.targetType === 'anchor'" class="map-editor__context-section">
            <p>锚点操作</p>
            <div class="map-editor__context-row">
              <button @click="removeEdgeAnchorFromContext" :disabled="contextMenu.anchorIndex == null || !contextMenu.edgeId">
                删除该锚点
              </button>
              <button @click="addEdgeAnchorFromContext" :disabled="!contextMenu.edgeId || !contextMenu.lngLat">在此加锚点</button>
            </div>
            <div class="map-editor__context-row">
              <button @click="clearContextEdgeAnchorsFromContext" :disabled="!contextMenu.edgeId">清空该线段锚点</button>
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="aiStationMenu.visible"
        class="map-editor__context-mask"
        @mousedown="onAiMenuOverlayMouseDown"
        @contextmenu.prevent="onAiMenuOverlayMouseDown"
      >
        <div
          ref="aiStationMenuRef"
          class="map-editor__ai-menu"
          :style="aiStationMenuStyle"
          @mousedown.stop
          @contextmenu.prevent
        >
          <h3>AI点站候选</h3>
          <p v-if="aiStationMenu.lngLat" class="map-editor__context-meta">
            坐标: {{ aiStationMenu.lngLat[0].toFixed(6) }}, {{ aiStationMenu.lngLat[1].toFixed(6) }}
          </p>
          <p class="map-editor__context-meta">采样范围: {{ STATION_NAMING_RADIUS_METERS }}m</p>
          <p v-if="aiStationMenu.loading" class="map-editor__ai-loading">正在分析周边道路/地域/设施并生成候选...</p>
          <p v-if="!aiStationMenu.loading && aiStationMenu.error" class="map-editor__ai-error">{{ aiStationMenu.error }}</p>

          <div v-if="!aiStationMenu.loading && aiStationMenu.candidates.length" class="map-editor__ai-candidate-list">
            <button
              v-for="candidate in aiStationMenu.candidates"
              :key="`${candidate.nameZh}__${candidate.nameEn}`"
              class="map-editor__ai-candidate"
              @click="applyAiStationCandidate(candidate)"
            >
              <strong>{{ candidate.nameZh }}</strong>
              <span>{{ candidate.nameEn }}</span>
              <small>{{ candidate.basis }} · {{ candidate.reason }}</small>
            </button>
          </div>

          <div class="map-editor__context-row">
            <button @click="retryAiStationNamingFromMenu" :disabled="aiStationMenu.loading">重试生成</button>
            <button @click="closeAiStationMenu()">关闭</button>
          </div>
        </div>
      </div>

      <div
        v-if="lineSelectionMenu.visible"
        class="map-editor__context-mask"
        @mousedown="onLineSelectionMenuOverlayMouseDown"
        @contextmenu.prevent="onLineSelectionMenuOverlayMouseDown"
      >
        <div
          class="map-editor__line-selection-menu"
          :style="lineSelectionMenuStyle"
          @mousedown.stop
          @contextmenu.prevent
        >
          <h3>选择线路</h3>
          <p class="map-editor__context-meta">该线段被多条线路共享，请选择</p>
          <div class="map-editor__line-selection-list">
            <button
              v-for="option in lineSelectionMenu.lineOptions"
              :key="option.id"
              class="map-editor__line-selection-option"
              @click="selectLineFromMenu(option.id)"
            >
              <span class="map-editor__line-selection-color" :style="{ background: option.color }"></span>
              <span class="map-editor__line-selection-name">{{ option.nameZh }}</span>
              <span class="map-editor__line-selection-name-en">{{ option.nameEn }}</span>
            </button>
          </div>
          <div class="map-editor__context-row">
            <button @click="closeLineSelectionMenu()">取消</button>
          </div>
        </div>
      </div>

      <p class="map-editor__hint">
        Shift/Ctrl/⌘ + 拖拽框选站点/线段 | Alt + 点击线段选中整条线路 | Delete 删除站点/线段/锚点 | Ctrl/Cmd+A 全选站点 | Ctrl/Cmd+Z 撤销 |
        Ctrl/Cmd+Shift+Z 或 Ctrl/Cmd+Y 重做 | Esc 取消待连接起点/关闭菜单
      </p>
    </div>
    <TimelineSlider
      @year-change="onTimelineYearChange"
      @play="onTimelinePlay"
      @pause="onTimelinePause"
      @stop="onTimelineStop"
      @speed-change="onTimelineSpeedChange"
    />
  </section>
</template>

<style scoped>
.map-editor {
  border: 1px solid var(--workspace-panel-border);
  border-radius: 12px;
  background: var(--workspace-panel-bg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.map-editor__container {
  flex: 1;
  min-height: 0;
  position: relative;
}

.map-editor__map {
  position: absolute;
  inset: 0;
}

.map-editor__selection-box {
  position: absolute;
  border: 1px solid #0ea5e9;
  background: rgba(14, 165, 233, 0.14);
  pointer-events: none;
  z-index: 10;
}

.map-editor__route-preview {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 12;
}

.map-editor__distance-badge {
  position: absolute;
  transform: translate(0, -100%);
  margin-top: -8px;
  padding: 3px 7px;
  border-radius: 999px;
  border: 1px solid var(--toolbar-border);
  background: var(--toolbar-card-bg);
  color: var(--toolbar-text);
  font-size: 11px;
  line-height: 1;
  pointer-events: none;
  z-index: 13;
}

.map-editor__context-mask {
  position: absolute;
  inset: 0;
  z-index: 30;
}

.map-editor__context-menu {
  position: absolute;
  width: 268px;
  max-height: calc(100% - 16px);
  overflow: auto;
  border: 1px solid var(--toolbar-border);
  border-radius: 12px;
  background: var(--toolbar-card-bg);
  color: var(--toolbar-text);
  padding: 10px;
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.35);
}

.map-editor__ai-menu {
  position: absolute;
  width: 356px;
  max-height: calc(100% - 16px);
  overflow: auto;
  border: 1px solid var(--toolbar-border);
  border-radius: 12px;
  background: var(--toolbar-card-bg);
  color: var(--toolbar-text);
  padding: 10px;
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.38);
}

.map-editor__context-menu h3 {
  margin: 0 0 6px;
  font-size: 14px;
}

.map-editor__ai-menu h3 {
  margin: 0 0 6px;
  font-size: 14px;
}

.map-editor__context-meta {
  margin: 0;
  font-size: 11px;
  color: var(--toolbar-hint);
  line-height: 1.35;
}

.map-editor__context-section {
  margin-top: 10px;
  border-top: 1px solid var(--toolbar-divider);
  padding-top: 8px;
}

.map-editor__context-section > p {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--toolbar-muted);
}

.map-editor__context-row {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}

.map-editor__context-row button,
.map-editor__context-row button {
  border: 1px solid var(--toolbar-button-border);
  border-radius: 7px;
  background: var(--toolbar-button-bg);
  color: var(--toolbar-button-text);
  font-size: 11px;
  padding: 5px 7px;
  cursor: pointer;
  transition: border-color 0.15s ease;
}

.map-editor__context-row button:hover:not(:disabled) {
  border-color: var(--toolbar-button-hover-border);
}

.map-editor__context-row button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.map-editor__ai-loading {
  margin: 8px 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--toolbar-muted);
}

.map-editor__ai-error {
  margin: 8px 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--toolbar-danger-border);
}

.map-editor__ai-candidate-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 8px 0;
}

.map-editor__ai-candidate {
  border: 1px solid var(--toolbar-input-border);
  border-radius: 8px;
  background: var(--toolbar-input-bg);
  color: var(--toolbar-text);
  text-align: left;
  padding: 8px 9px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 3px;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.map-editor__ai-candidate:hover {
  border-color: var(--toolbar-button-hover-border);
  background: var(--toolbar-button-bg);
}

.map-editor__ai-candidate strong {
  font-size: 13px;
}

.map-editor__ai-candidate span {
  font-size: 12px;
  color: var(--toolbar-muted);
}

.map-editor__ai-candidate small {
  font-size: 11px;
  line-height: 1.35;
  color: var(--toolbar-hint);
}

.map-editor__line-selection-menu {
  position: absolute;
  width: 268px;
  max-height: calc(100% - 16px);
  overflow: auto;
  border: 1px solid var(--toolbar-border);
  border-radius: 12px;
  background: var(--toolbar-card-bg);
  color: var(--toolbar-text);
  padding: 10px;
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.35);
}

.map-editor__line-selection-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 8px 0;
}

.map-editor__line-selection-option {
  border: 1px solid var(--toolbar-input-border);
  border-radius: 8px;
  background: var(--toolbar-input-bg);
  color: var(--toolbar-text);
  text-align: left;
  padding: 8px 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.map-editor__line-selection-option:hover {
  border-color: var(--toolbar-button-hover-border);
  background: var(--toolbar-button-bg);
}

.map-editor__line-selection-color {
  width: 16px;
  height: 16px;
  border-radius: 999px;
  border: 1.5px solid rgba(0, 0, 0, 0.15);
  flex-shrink: 0;
}

.map-editor__line-selection-name {
  font-size: 13px;
  font-weight: 600;
}

.map-editor__line-selection-name-en {
  font-size: 12px;
  color: var(--toolbar-muted);
  margin-left: auto;
}

.map-editor__hint {
  position: absolute;
  left: 12px;
  bottom: 10px;
  margin: 0;
  padding: 5px 8px;
  background: var(--toolbar-card-bg);
  color: var(--toolbar-text);
  border: 1px solid var(--toolbar-border);
  border-radius: 6px;
  font-size: 11px;
  z-index: 11;
  pointer-events: none;
  opacity: 0.95;
}

:deep(.maplibregl-ctrl-scale) {
  border: 1px solid var(--toolbar-border);
  border-radius: 7px;
  background: var(--toolbar-card-bg);
  color: var(--toolbar-text);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.25;
}
</style>
