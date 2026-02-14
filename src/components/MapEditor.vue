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

const store = useProjectStore()
const mapContainer = ref(null)
const contextMenuRef = ref(null)
const aiStationMenuRef = ref(null)
let map = null
let dragState = null
let anchorDragState = null
let suppressNextMapClick = false
let scaleControl = null
let aiNamingAbortController = null
const ROUTE_DRAW_SHORT_DISTANCE_METERS = 500
const ROUTE_DRAW_LONG_DISTANCE_METERS = 2000
const ROUTE_DRAW_SHORT_COLOR = '#EF4444'
const ROUTE_DRAW_LONG_COLOR = '#A855F7'

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
  nonSquare: 'round',
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

const stationCount = computed(() => store.project?.stations.length || 0)
const edgeCount = computed(() => store.project?.edges.length || 0)
const selectedEdgeLabel = computed(() => (store.selectedEdgeId ? '1' : '0'))
const contextMenuStyle = computed(() => ({
  left: `${contextMenu.x}px`,
  top: `${contextMenu.y}px`,
}))
const aiStationMenuStyle = computed(() => ({
  left: `${aiStationMenu.x}px`,
  top: `${aiStationMenu.y}px`,
}))
const hasSelection = computed(
  () => store.selectedStationIds.length > 0 || Boolean(store.selectedEdgeId) || Boolean(store.selectedEdgeAnchor),
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

    store.statusText = 'AI点站：正在调用本机 Ollama 生成候选站名...'
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

function clearContextEdgeAnchorsFromContext() {
  if (!contextMenu.edgeId) return
  if (!window.confirm('确认清空该线段全部锚点吗？')) return
  store.clearEdgeAnchors(contextMenu.edgeId)
  closeContextMenu()
}

function renameContextStationFromContext() {
  if (!contextStation.value) return
  const nameZh = window.prompt('输入站点中文名', contextStation.value.nameZh || '')
  if (nameZh == null) return
  const nameEn = window.prompt('输入站点英文名', contextStation.value.nameEn || '')
  if (nameEn == null) return
  store.updateStationName(contextStation.value.id, {
    nameZh,
    nameEn,
  })
  closeContextMenu()
}

function deleteContextStationFromContext() {
  if (!contextMenu.stationId) return
  if (!window.confirm('确认删除该站点吗？')) return
  store.setSelectedStations([contextMenu.stationId])
  store.deleteSelectedStations()
  closeContextMenu()
}

function deleteContextEdgeFromContext() {
  if (!contextMenu.edgeId) return
  if (!window.confirm('确认删除该线段吗？')) return
  store.selectEdge(contextMenu.edgeId)
  store.deleteSelectedEdge()
  closeContextMenu()
}


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
        'line-width': 14,
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
        'line-cap': 'round',
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
        'text-field': ['get', 'nameZh'],
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
  map.setFilter(LAYER_EDGES_SELECTED, ['==', ['get', 'id'], store.selectedEdgeId || '__none__'])
}

function updateMapData() {
  if (!map) return
  const stationSource = map.getSource(SOURCE_STATIONS)
  const edgeSource = map.getSource(SOURCE_EDGES)
  const anchorSource = map.getSource(SOURCE_EDGE_ANCHORS)
  if (stationSource) {
    stationSource.setData(buildStationsGeoJson(store.project, store.selectedStationIds))
  }
  if (edgeSource) {
    edgeSource.setData(buildEdgesGeoJson(store.project))
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

function handleStationClick(event) {
  closeContextMenu()
  const stationId = event.features?.[0]?.properties?.id
  if (!stationId) return
  if (store.mode === 'route-draw') {
    store.selectStation(stationId)
    return
  }
  const mouseEvent = event.originalEvent
  const isMultiModifier = Boolean(mouseEvent?.shiftKey || mouseEvent?.ctrlKey || mouseEvent?.metaKey)
  store.selectStation(stationId, {
    multi: isMultiModifier && store.mode === 'select',
    toggle: isMultiModifier && store.mode === 'select',
  })
}

function handleEdgeClick(event) {
  closeContextMenu()
  if (store.mode !== 'select') return
  const edgeId = event.features?.[0]?.properties?.id
  if (!edgeId) return
  const mouseEvent = event.originalEvent
  const keepStationSelection = Boolean(mouseEvent?.shiftKey || mouseEvent?.ctrlKey || mouseEvent?.metaKey)
  store.selectEdge(edgeId, { keepStationSelection })
}

function handleEdgeAnchorClick(event) {
  closeContextMenu()
  if (store.mode !== 'select') return
  const edgeId = event.features?.[0]?.properties?.edgeId
  const anchorIndexRaw = event.features?.[0]?.properties?.anchorIndex
  const anchorIndex = Number(anchorIndexRaw)
  if (!edgeId || !Number.isInteger(anchorIndex)) return
  store.selectEdgeAnchor(edgeId, anchorIndex)
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
    store.selectStation(stationId, { multi: true, toggle: true })
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

    const picked = (store.project?.stations || [])
      .filter((station) => {
        const pt = map.project(station.lngLat)
        return pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY
      })
      .map((station) => station.id)

    if (picked.length) {
      store.selectStations(picked, { replace: !selectionBox.append })
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

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
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
  if (store.selectedEdgeId) {
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
  store.unregisterActualRoutePngExporter(exportActualRoutePngFromMap)
  window.removeEventListener('resize', handleWindowResize)
  window.removeEventListener('keydown', handleWindowKeyDown)
  closeContextMenu()
  closeAiStationMenu()
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
    selectedEdgeAnchor: store.selectedEdgeAnchor,
    boundary: store.regionBoundary,
  }),
  () => {
    if (!map || !map.isStyleLoaded()) return
    ensureSources()
    ensureMapLayers()
    updateMapData()
  },
  { deep: true },
)
</script>

<template>
  <section class="map-editor">
    <header class="map-editor__header">
      <h2>真实地图编辑器</h2>
      <div class="map-editor__stats">
        <span>站点: {{ stationCount }}</span>
        <span>线段: {{ edgeCount }}</span>
        <span>已选站: {{ store.selectedStationIds.length }}</span>
        <span>已选边: {{ selectedEdgeLabel }}</span>
        <span>模式: {{ store.mode }}</span>
      </div>
    </header>
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
              <button @click="renameContextStationFromContext" :disabled="!contextStation">重命名站点</button>
              <button @click="deleteContextStationFromContext" :disabled="!contextMenu.stationId">删除该站点</button>
            </div>
          </div>

          <div v-if="contextMenu.targetType === 'edge'" class="map-editor__context-section">
            <p>线段操作</p>
            <div class="map-editor__context-row">
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

      <p class="map-editor__hint">
        Shift/Ctrl/⌘ + 拖拽框选 | Delete 删除站点/线段/锚点 | Ctrl/Cmd+A 全选站点 | Esc 取消待连接起点/关闭菜单
      </p>
    </div>
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

.map-editor__header {
  padding: 12px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--workspace-panel-header-border);
  background: var(--workspace-panel-header-bg);
  color: var(--workspace-panel-text);
}

.map-editor__header h2 {
  margin: 0;
  font-size: 16px;
  color: var(--workspace-panel-text);
}

.map-editor__stats {
  display: flex;
  gap: 12px;
  color: var(--workspace-panel-muted);
  font-size: 12px;
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
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(15, 23, 42, 0.9);
  color: #f8fafc;
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
  border: 1px solid #2b3643;
  border-radius: 12px;
  background: rgba(9, 16, 27, 0.97);
  color: #e2e8f0;
  padding: 10px;
  box-shadow: 0 18px 42px rgba(2, 6, 23, 0.48);
}

.map-editor__ai-menu {
  position: absolute;
  width: 356px;
  max-height: calc(100% - 16px);
  overflow: auto;
  border: 1px solid #2b3643;
  border-radius: 12px;
  background: rgba(9, 16, 27, 0.98);
  color: #e2e8f0;
  padding: 10px;
  box-shadow: 0 18px 42px rgba(2, 6, 23, 0.5);
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
  color: #93c5fd;
  line-height: 1.35;
}

.map-editor__context-section {
  margin-top: 10px;
  border-top: 1px solid #334155;
  padding-top: 8px;
}

.map-editor__context-section > p {
  margin: 0 0 6px;
  font-size: 12px;
  color: #cbd5e1;
}

.map-editor__context-row {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}

.map-editor__context-row button,
.map-editor__context-row button {
  border: 1px solid #334155;
  border-radius: 7px;
  background: #0f172a;
  color: #e2e8f0;
  font-size: 11px;
  padding: 5px 7px;
  cursor: pointer;
}

.map-editor__context-row button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.map-editor__ai-loading {
  margin: 8px 0;
  font-size: 12px;
  line-height: 1.5;
  color: #cbd5e1;
}

.map-editor__ai-error {
  margin: 8px 0;
  font-size: 12px;
  line-height: 1.5;
  color: #fda4af;
}

.map-editor__ai-candidate-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 8px 0;
}

.map-editor__ai-candidate {
  border: 1px solid #334155;
  border-radius: 8px;
  background: #0f172a;
  color: #e2e8f0;
  text-align: left;
  padding: 8px 9px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.map-editor__ai-candidate strong {
  font-size: 13px;
}

.map-editor__ai-candidate span {
  font-size: 12px;
  color: #cbd5e1;
}

.map-editor__ai-candidate small {
  font-size: 11px;
  line-height: 1.35;
  color: #93c5fd;
}

.map-editor__hint {
  position: absolute;
  left: 12px;
  bottom: 10px;
  margin: 0;
  padding: 5px 8px;
  background: rgba(15, 23, 42, 0.72);
  color: #e2e8f0;
  border-radius: 6px;
  font-size: 11px;
  z-index: 11;
  pointer-events: none;
}

:deep(.maplibregl-ctrl-scale) {
  border: 1px solid rgba(15, 23, 42, 0.6);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.92);
  color: #0f172a;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.25;
}
</style>
