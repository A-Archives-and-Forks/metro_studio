<script setup>
import maplibregl from 'maplibre-gl'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { getDisplayLineName } from '../lib/lineNaming'
import { useProjectStore } from '../stores/projectStore'

const store = useProjectStore()
const mapContainer = ref(null)
const contextFileInputRef = ref(null)
let map = null
let dragState = null
let suppressNextMapClick = false
let scaleControl = null

const LAYER_EDGES = 'railmap-edges'
const LAYER_EDGES_HIT = 'railmap-edges-hit'
const LAYER_EDGES_SELECTED = 'railmap-edges-selected'
const LAYER_STATIONS = 'railmap-stations-layer'
const SOURCE_STATIONS = 'railmap-stations'
const SOURCE_EDGES = 'railmap-edges'
const LINE_STATUS_SET = new Set(['open', 'construction', 'proposed'])
const LINE_STYLE_SET = new Set(['solid', 'dashed', 'dotted'])
const selectionBox = reactive({
  active: false,
  append: false,
  startX: 0,
  startY: 0,
  endX: 0,
  endY: 0,
})
const contextMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  lngLat: null,
  stationId: null,
  edgeId: null,
})

const stationCount = computed(() => store.project?.stations.length || 0)
const edgeCount = computed(() => store.project?.edges.length || 0)
const selectedEdgeLabel = computed(() => (store.selectedEdgeId ? '1' : '0'))
const activeLine = computed(() => {
  if (!store.project || !store.activeLineId) return null
  return store.project.lines.find((line) => line.id === store.activeLineId) || null
})
const contextMenuStyle = computed(() => ({
  left: `${contextMenu.x}px`,
  top: `${contextMenu.y}px`,
}))
const selectedStation = computed(() => {
  if (!store.project || !store.selectedStationId) return null
  return store.project.stations.find((station) => station.id === store.selectedStationId) || null
})
const hasSelection = computed(() => store.selectedStationIds.length > 0 || Boolean(store.selectedEdgeId))
const allLines = computed(() => store.project?.lines || [])
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

function displayLineName(line) {
  return getDisplayLineName(line, 'zh') || line?.nameZh || ''
}

function isTextInputTarget(target) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select'
}

function closeContextMenu() {
  contextMenu.visible = false
  contextMenu.stationId = null
  contextMenu.edgeId = null
  contextMenu.lngLat = null
}

function openContextMenu(event) {
  if (!mapContainer.value) return
  const point = event.point || { x: 0, y: 0 }
  const stations = map.queryRenderedFeatures(point, { layers: [LAYER_STATIONS] })
  const edges = map.queryRenderedFeatures(point, { layers: [LAYER_EDGES_HIT] })

  const stationId = stations[0]?.properties?.id || null
  const edgeId = edges[0]?.properties?.id || null
  if (stationId) {
    store.setSelectedStations([stationId])
  } else if (edgeId) {
    store.selectEdge(edgeId)
  }

  const rect = mapContainer.value.getBoundingClientRect()
  const menuWidth = 330
  const menuHeight = 640
  const x = Math.max(8, Math.min(point.x, Math.max(8, rect.width - menuWidth - 8)))
  const y = Math.max(8, Math.min(point.y, Math.max(8, rect.height - menuHeight - 8)))

  contextMenu.x = x
  contextMenu.y = y
  contextMenu.stationId = stationId
  contextMenu.edgeId = edgeId
  contextMenu.lngLat = [event.lngLat.lng, event.lngLat.lat]
  contextMenu.visible = true
}

function normalizeStatusInput(value, fallback = 'open') {
  const normalized = String(value || '').trim().toLowerCase()
  return LINE_STATUS_SET.has(normalized) ? normalized : fallback
}

function normalizeStyleInput(value, fallback = 'solid') {
  const normalized = String(value || '').trim().toLowerCase()
  return LINE_STYLE_SET.has(normalized) ? normalized : fallback
}

function parseBoolInput(value, fallback = false) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return fallback
  if (['1', 'true', 'yes', 'y', 'on', '是'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n', 'off', '否'].includes(normalized)) return false
  return fallback
}

function onContextOverlayMouseDown(event) {
  if (event.button !== 0 && event.button !== 2) return
  closeContextMenu()
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

function selectAllStationsFromContext() {
  store.selectAllStations()
  closeContextMenu()
}

function clearSelectionFromContext() {
  store.clearSelection()
  closeContextMenu()
}

function deleteSelectedStationsFromContext() {
  if (!store.selectedStationIds.length) return
  if (!window.confirm(`确认删除已选 ${store.selectedStationIds.length} 个站点吗？`)) return
  store.deleteSelectedStations()
  closeContextMenu()
}

function deleteSelectedEdgeFromContext() {
  if (!store.selectedEdgeId) return
  if (!window.confirm('确认删除当前选中线段吗？')) return
  store.deleteSelectedEdge()
  closeContextMenu()
}

function renameSelectedStationFromContext() {
  if (!selectedStation.value) return
  const nameZh = window.prompt('输入站点中文名', selectedStation.value.nameZh || '')
  if (nameZh == null) return
  const nameEn = window.prompt('输入站点英文名', selectedStation.value.nameEn || '')
  if (nameEn == null) return
  store.updateStationName(selectedStation.value.id, {
    nameZh,
    nameEn,
  })
  closeContextMenu()
}

function batchRenameStationsFromContext() {
  if (store.selectedStationIds.length < 2) return
  const zhTemplate = window.prompt('输入中文模板（例如：站点 {n}）', '站点 {n}')
  if (zhTemplate == null) return
  const enTemplate = window.prompt('输入英文模板（例如：Station {n}）', 'Station {n}')
  if (enTemplate == null) return
  const startIndexRaw = window.prompt('输入起始序号', '1')
  if (startIndexRaw == null) return
  store.renameSelectedStationsByTemplate({
    zhTemplate,
    enTemplate,
    startIndex: Number(startIndexRaw),
  })
  closeContextMenu()
}

function addLineFromContext() {
  const nameZh = window.prompt('输入线路中文名', `手工线路 ${(store.project?.lines.length || 0) + 1}`)
  if (nameZh == null) return
  const nameEn = window.prompt('输入线路英文名', '')
  if (nameEn == null) return
  const color = window.prompt('输入线路颜色（HEX）', '#005BBB')
  if (color == null) return
  const statusRaw = window.prompt('输入线路状态：open / construction / proposed', 'open')
  if (statusRaw == null) return
  const styleRaw = window.prompt('输入线型：solid / dashed / dotted', 'solid')
  if (styleRaw == null) return
  const isLoopRaw = window.prompt('是否环线：yes / no', 'no')
  if (isLoopRaw == null) return
  store.addLine({
    nameZh,
    nameEn,
    color,
    status: normalizeStatusInput(statusRaw, 'open'),
    style: normalizeStyleInput(styleRaw, 'solid'),
    isLoop: parseBoolInput(isLoopRaw, false),
  })
  closeContextMenu()
}

function updateActiveLineFromContext() {
  if (!activeLine.value) return
  const nameZh = window.prompt('输入线路中文名', activeLine.value.nameZh || '')
  if (nameZh == null) return
  const nameEn = window.prompt('输入线路英文名', activeLine.value.nameEn || '')
  if (nameEn == null) return
  const color = window.prompt('输入线路颜色（HEX）', activeLine.value.color || '#005BBB')
  if (color == null) return
  const statusRaw = window.prompt('输入线路状态：open / construction / proposed', activeLine.value.status || 'open')
  if (statusRaw == null) return
  const styleRaw = window.prompt('输入线型：solid / dashed / dotted', activeLine.value.style || 'solid')
  if (styleRaw == null) return
  const isLoopRaw = window.prompt('是否环线：yes / no', activeLine.value.isLoop ? 'yes' : 'no')
  if (isLoopRaw == null) return
  store.updateLine(activeLine.value.id, {
    nameZh,
    nameEn,
    color,
    status: normalizeStatusInput(statusRaw, activeLine.value.status || 'open'),
    style: normalizeStyleInput(styleRaw, activeLine.value.style || 'solid'),
    isLoop: parseBoolInput(isLoopRaw, Boolean(activeLine.value.isLoop)),
  })
  closeContextMenu()
}

function deleteActiveLineFromContext() {
  if (!activeLine.value) return
  if (!window.confirm(`确认删除线路「${displayLineName(activeLine.value)}」吗？`)) return
  store.deleteLine(activeLine.value.id)
  closeContextMenu()
}

function setActiveLineFromContext(lineId) {
  store.setActiveLine(lineId)
  closeContextMenu()
}

async function runAutoLayoutFromContext() {
  await store.runAutoLayout()
  closeContextMenu()
}

async function createProjectFromContext() {
  const name = window.prompt('输入新工程名', '新建工程')
  if (name == null) return
  await store.createNewProject(name.trim() || '新建工程')
  closeContextMenu()
}

async function renameProjectFromContext() {
  if (!store.project) return
  const name = window.prompt('输入当前工程新名称', store.project.name || '')
  if (name == null) return
  await store.renameCurrentProject(name)
  closeContextMenu()
}

async function duplicateProjectFromContext() {
  if (!store.project) return
  const name = window.prompt('输入复制工程名称', `${store.project.name} 副本`)
  if (name == null) return
  await store.duplicateCurrentProject(name)
  closeContextMenu()
}

async function deleteCurrentProjectFromContext() {
  if (!store.project) return
  if (!window.confirm(`确认删除当前工程「${store.project.name}」吗？`)) return
  await store.deleteProjectById(store.project.id)
  closeContextMenu()
}

async function persistProjectFromContext() {
  await store.persistNow()
  closeContextMenu()
}

async function importOsmFromContext() {
  await store.importJinanNetwork()
  closeContextMenu()
}

async function exportActualRoutePngFromContext() {
  await store.exportActualRoutePng()
  closeContextMenu()
}

async function exportOfficialSchematicPngFromContext() {
  await store.exportOfficialSchematicPng()
  closeContextMenu()
}

async function exportAllLineHudZipFromContext() {
  await store.exportAllLineHudZip()
  closeContextMenu()
}

function exportProjectFileFromContext() {
  store.exportProjectFile()
  closeContextMenu()
}

function importProjectFileFromContext() {
  contextFileInputRef.value?.click()
  closeContextMenu()
}

async function onContextProjectFileSelected(event) {
  const file = event.target.files?.[0]
  if (!file) return
  try {
    await store.importProjectFile(file)
  } catch (error) {
    store.statusText = `加载工程失败: ${error.message || '未知错误'}`
  } finally {
    event.target.value = ''
  }
}

function sanitizeFileName(value, fallback = 'railmap') {
  const normalized = String(value || '').trim()
  const sanitized = normalized
    .replace(/[\\/:%*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '')
    .trim()
  return sanitized || fallback
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

function collectProjectBounds(project) {
  const coords = []
  for (const station of project?.stations || []) {
    if (Array.isArray(station.lngLat) && station.lngLat.length === 2) {
      const [lng, lat] = station.lngLat
      if (Number.isFinite(lng) && Number.isFinite(lat)) coords.push([lng, lat])
    }
  }
  for (const edge of project?.edges || []) {
    for (const point of edge?.waypoints || []) {
      if (!Array.isArray(point) || point.length !== 2) continue
      const [lng, lat] = point
      if (Number.isFinite(lng) && Number.isFinite(lat)) coords.push([lng, lat])
    }
  }
  if (!coords.length) return null

  let minLng = Number.POSITIVE_INFINITY
  let minLat = Number.POSITIVE_INFINITY
  let maxLng = Number.NEGATIVE_INFINITY
  let maxLat = Number.NEGATIVE_INFINITY
  for (const [lng, lat] of coords) {
    minLng = Math.min(minLng, lng)
    minLat = Math.min(minLat, lat)
    maxLng = Math.max(maxLng, lng)
    maxLat = Math.max(maxLat, lat)
  }
  return {
    minLng,
    minLat,
    maxLng,
    maxLat,
  }
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

async function captureMapFrameBlob(maxAttempts = 6) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
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
      return blob
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return null
}

async function exportActualRoutePngFromMap({ project, stationVisibilityMode = 'all' } = {}) {
  if (!map) {
    throw new Error('真实地图未初始化')
  }

  const normalizedStationVisibilityMode = ['all', 'interchange', 'none'].includes(stationVisibilityMode)
    ? stationVisibilityMode
    : 'all'
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
    await waitForMapIdle()
    if (hasLabelLayer) {
      map.setLayoutProperty(labelLayerId, 'visibility', 'none')
    }
    if (hasStationLayer) {
      if (normalizedStationVisibilityMode === 'none') {
        map.setLayoutProperty(stationLayerId, 'visibility', 'none')
      } else if (normalizedStationVisibilityMode === 'interchange') {
        map.setLayoutProperty(stationLayerId, 'visibility', 'visible')
        map.setFilter(stationLayerId, ['==', ['get', 'isInterchange'], true])
      } else {
        map.setLayoutProperty(stationLayerId, 'visibility', 'visible')
        map.setFilter(stationLayerId, null)
      }
    }
    await fitMapToProjectForExport(project || store.project)
    pngBlob = await captureMapFrameBlob(6)
    if (!pngBlob && map.getLayer('osm-base')) {
      const previousVisibility = map.getLayoutProperty('osm-base', 'visibility') || 'visible'
      try {
        map.setLayoutProperty('osm-base', 'visibility', 'none')
        pngBlob = await captureMapFrameBlob(4)
      } finally {
        map.setLayoutProperty('osm-base', 'visibility', previousVisibility)
        await waitForMapRenderFrame()
      }
    }
  } finally {
    if (hasLabelLayer) {
      map.setLayoutProperty(labelLayerId, 'visibility', previousLabelVisibility)
    }
    if (hasStationLayer) {
      map.setLayoutProperty(stationLayerId, previousStationVisibility)
      map.setFilter(stationLayerId, previousStationFilter || null)
    }
    map.jumpTo({
      center: cameraState.center,
      zoom: cameraState.zoom,
      bearing: cameraState.bearing,
      pitch: cameraState.pitch,
    })
    await waitForMapRenderFrame()
  }

  if (!pngBlob) {
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
}

function buildMapStyle() {
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
      },
    },
    layers: [
      {
        id: 'osm-base',
        type: 'raster',
        source: 'osm',
      },
    ],
  }
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

  if (!map.getLayer(LAYER_EDGES)) {
    map.addLayer({
      id: LAYER_EDGES,
      type: 'line',
      source: SOURCE_EDGES,
      paint: {
        'line-color': ['coalesce', ['get', 'color'], '#2563EB'],
        'line-width': 5,
        'line-opacity': 0.88,
        'line-dasharray': [
          'case',
          ['==', ['get', 'lineStyle'], 'dashed'],
          ['literal', [2.2, 1.5]],
          ['==', ['get', 'lineStyle'], 'dotted'],
          ['literal', [0.2, 1.7]],
          ['literal', [1, 0]],
        ],
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    })
  }

  if (!map.getLayer(LAYER_EDGES_SELECTED)) {
    map.addLayer({
      id: LAYER_EDGES_SELECTED,
      type: 'line',
      source: SOURCE_EDGES,
      filter: ['==', ['get', 'id'], ''],
      paint: {
        'line-color': '#F8FAFC',
        'line-width': 8.5,
        'line-opacity': 0.96,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    })
  }

  updateSelectedEdgeFilter()

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
      data: buildStationsGeoJson(),
    })
  }

  if (!map.getSource(SOURCE_EDGES)) {
    map.addSource(SOURCE_EDGES, {
      type: 'geojson',
      data: buildEdgesGeoJson(),
    })
  }

  if (!map.getSource('jinan-boundary')) {
    map.addSource('jinan-boundary', {
      type: 'geojson',
      data: buildBoundaryGeoJson(),
    })
  } else {
    map.getSource('jinan-boundary').setData(buildBoundaryGeoJson())
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

function buildBoundaryGeoJson() {
  if (!store.regionBoundary) {
    return {
      type: 'FeatureCollection',
      features: [],
    }
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: store.regionBoundary,
        properties: {},
      },
    ],
  }
}

function buildStationsGeoJson() {
  const stations = store.project?.stations || []
  const selectedStationSet = new Set(store.selectedStationIds || [])
  return {
    type: 'FeatureCollection',
    features: stations.map((station) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: station.lngLat,
      },
      properties: {
        id: station.id,
        nameZh: station.nameZh,
        isInterchange: station.isInterchange,
        underConstruction: station.underConstruction,
        proposed: station.proposed,
        isSelected: selectedStationSet.has(station.id),
      },
    })),
  }
}

function buildEdgesGeoJson() {
  const lines = new Map((store.project?.lines || []).map((line) => [line.id, line]))
  const edges = store.project?.edges || []
  const stations = new Map((store.project?.stations || []).map((station) => [station.id, station]))

  return {
    type: 'FeatureCollection',
    features: edges
      .map((edge) => {
        const line = lines.get(edge.sharedByLineIds[0])
        const fallback = []
        const fromStation = stations.get(edge.fromStationId)
        const toStation = stations.get(edge.toStationId)
        if (fromStation) fallback.push(fromStation.lngLat)
        if (toStation) fallback.push(toStation.lngLat)
        const coordinates = edge.waypoints?.length >= 2 ? edge.waypoints : fallback
        if (coordinates.length < 2) return null
        return {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates,
          },
          properties: {
            id: edge.id,
            color: line?.color || '#2563EB',
            lineStyle: line?.style || 'solid',
            sharedCount: edge.sharedByLineIds.length,
          },
        }
      })
      .filter(Boolean),
  }
}

function updateMapData() {
  if (!map) return
  const stationSource = map.getSource(SOURCE_STATIONS)
  const edgeSource = map.getSource(SOURCE_EDGES)
  if (stationSource) {
    stationSource.setData(buildStationsGeoJson())
  }
  if (edgeSource) {
    edgeSource.setData(buildEdgesGeoJson())
  }
  updateSelectedEdgeFilter()
}

function handleWindowResize() {
  if (map) {
    map.resize()
  }
}

function handleStationClick(event) {
  closeContextMenu()
  const stationId = event.features?.[0]?.properties?.id
  if (!stationId) return
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

function handleMapClick(event) {
  closeContextMenu()
  if (!map) return
  if (suppressNextMapClick) {
    suppressNextMapClick = false
    return
  }
  const hitStations = map.queryRenderedFeatures(event.point, { layers: [LAYER_STATIONS] })
  const hitEdges = map.queryRenderedFeatures(event.point, { layers: [LAYER_EDGES_HIT] })
  if (hitStations.length) return
  if (hitEdges.length) return
  if (store.mode === 'add-station') {
    store.addStationAt([event.lngLat.lng, event.lngLat.lat])
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

function onMouseMove(event) {
  if (selectionBox.active) {
    selectionBox.endX = event.point.x
    selectionBox.endY = event.point.y
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

  if (!dragState) return
  dragState = null
  map.getCanvas().style.cursor = ''
  map.dragPan.enable()
}

function startBoxSelection(event) {
  closeContextMenu()
  if (store.mode !== 'select') return
  if (selectionBox.active) return
  const mouseEvent = event.originalEvent
  if (mouseEvent?.button !== 0) return
  const modifier = Boolean(mouseEvent?.shiftKey || mouseEvent?.ctrlKey || mouseEvent?.metaKey)
  if (!modifier) return

  const hitStations = map.queryRenderedFeatures(event.point, { layers: [LAYER_STATIONS] })
  const hitEdges = map.queryRenderedFeatures(event.point, { layers: [LAYER_EDGES_HIT] })
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
  if (!map || selectionBox.active || dragState) return
  map.getCanvas().style.cursor = 'pointer'
}

function onInteractiveFeatureLeave() {
  if (!map || selectionBox.active || dragState) return
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
    if (contextMenu.visible) {
      closeContextMenu()
      return
    }
    store.clearSelection()
    return
  }

  if (event.key !== 'Delete' && event.key !== 'Backspace') return

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
    map.on('mouseenter', LAYER_STATIONS, onInteractiveFeatureEnter)
    map.on('mouseleave', LAYER_STATIONS, onInteractiveFeatureLeave)
    map.on('mouseenter', LAYER_EDGES_HIT, onInteractiveFeatureEnter)
    map.on('mouseleave', LAYER_EDGES_HIT, onInteractiveFeatureLeave)
  })

  map.on('click', handleMapClick)
  map.on('contextmenu', handleMapContextMenu)
  map.on('mousedown', startBoxSelection)
  map.on('mousemove', onMouseMove)
  map.on('mouseup', stopStationDrag)
  map.on('mouseleave', stopStationDrag)
  window.addEventListener('resize', handleWindowResize)
  window.addEventListener('keydown', handleWindowKeyDown)
})

onBeforeUnmount(() => {
  store.unregisterActualRoutePngExporter(exportActualRoutePngFromMap)
  window.removeEventListener('resize', handleWindowResize)
  window.removeEventListener('keydown', handleWindowKeyDown)
  closeContextMenu()
  scaleControl = null
  if (map) {
    map.remove()
  }
})

watch(
  () => ({
    project: store.project,
    selectedStationId: store.selectedStationId,
    selectedStationIds: store.selectedStationIds,
    selectedEdgeId: store.selectedEdgeId,
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
      <input
        ref="contextFileInputRef"
        type="file"
        accept=".json,.railmap.json"
        class="map-editor__hidden-input"
        @change="onContextProjectFileSelected"
      />
      <div v-if="selectionBox.active" class="map-editor__selection-box" :style="selectionBoxStyle"></div>

      <div
        v-if="contextMenu.visible"
        class="map-editor__context-mask"
        @mousedown="onContextOverlayMouseDown"
        @contextmenu.prevent="onContextOverlayMouseDown"
      >
        <div class="map-editor__context-menu" :style="contextMenuStyle" @mousedown.stop @contextmenu.prevent>
          <h3>右键菜单</h3>
          <p class="map-editor__context-meta">模式: {{ store.mode }} | 已选: {{ hasSelection ? '是' : '否' }}</p>
          <p v-if="contextMenu.stationId" class="map-editor__context-meta">目标站点: {{ contextMenu.stationId }}</p>
          <p v-if="contextMenu.edgeId" class="map-editor__context-meta">目标线段: {{ contextMenu.edgeId }}</p>
          <p v-if="contextMenu.lngLat" class="map-editor__context-meta">
            坐标: {{ contextMenu.lngLat[0].toFixed(6) }}, {{ contextMenu.lngLat[1].toFixed(6) }}
          </p>

          <div class="map-editor__context-section">
            <p>编辑模式</p>
            <div class="map-editor__context-row">
              <button @click="setModeFromContext('select')">选择/拖拽</button>
              <button @click="setModeFromContext('add-station')">点站</button>
              <button @click="setModeFromContext('add-edge')">拉线</button>
            </div>
          </div>

          <div class="map-editor__context-section">
            <p>站点与线段</p>
            <div class="map-editor__context-row">
              <button @click="addStationAtContext" :disabled="!contextMenu.lngLat">在此新增站点</button>
              <button @click="renameSelectedStationFromContext" :disabled="!selectedStation">重命名站点</button>
              <button @click="batchRenameStationsFromContext" :disabled="store.selectedStationIds.length < 2">
                批量重命名
              </button>
            </div>
            <div class="map-editor__context-row">
              <button @click="selectAllStationsFromContext">全选站点</button>
              <button @click="clearSelectionFromContext">清空选择</button>
              <button @click="deleteSelectedStationsFromContext" :disabled="!store.selectedStationIds.length">
                删除选中站点
              </button>
            </div>
            <div class="map-editor__context-row">
              <button @click="deleteSelectedEdgeFromContext" :disabled="!store.selectedEdgeId">删除选中线段</button>
            </div>
          </div>

          <div class="map-editor__context-section">
            <p>线路</p>
            <div class="map-editor__context-row">
              <button @click="addLineFromContext">新增线路</button>
              <button @click="updateActiveLineFromContext" :disabled="!activeLine">编辑当前线路</button>
              <button @click="deleteActiveLineFromContext" :disabled="!activeLine">删除当前线路</button>
            </div>
            <div class="map-editor__context-line-list">
              <button
                v-for="line in allLines"
                :key="line.id"
                :class="{ active: store.activeLineId === line.id }"
                @click="setActiveLineFromContext(line.id)"
              >
                <span class="map-editor__context-line-dot" :style="{ backgroundColor: line.color }"></span>
                <span>{{ displayLineName(line) }}</span>
              </button>
            </div>
          </div>

          <div class="map-editor__context-section">
            <p>工程与排版</p>
            <div class="map-editor__context-row">
              <button @click="createProjectFromContext">新建工程</button>
              <button @click="renameProjectFromContext" :disabled="!store.project">重命名工程</button>
              <button @click="duplicateProjectFromContext" :disabled="!store.project">复制工程</button>
            </div>
            <div class="map-editor__context-row">
              <button @click="deleteCurrentProjectFromContext" :disabled="!store.project">删除当前工程</button>
              <button @click="persistProjectFromContext" :disabled="!store.project">存入本地库</button>
              <button @click="runAutoLayoutFromContext" :disabled="store.isLayoutRunning || !store.project?.stations?.length">
                自动排版
              </button>
            </div>
            <div class="map-editor__context-row">
              <button @click="importOsmFromContext" :disabled="store.isImporting">导入 OSM</button>
              <button @click="exportProjectFileFromContext" :disabled="!store.project">保存工程文件</button>
              <button @click="importProjectFileFromContext">加载工程文件</button>
            </div>
          </div>

          <div class="map-editor__context-section">
            <p>导出</p>
            <div class="map-editor__context-row">
              <button @click="exportActualRoutePngFromContext">导出实际走向图 PNG</button>
              <button @click="exportOfficialSchematicPngFromContext">导出官方风格图 PNG</button>
            </div>
            <div class="map-editor__context-row">
              <button @click="exportAllLineHudZipFromContext">导出车辆 HUD 打包</button>
            </div>
          </div>
        </div>
      </div>

      <p class="map-editor__hint">Shift/Ctrl/⌘ + 拖拽框选 | Delete 删除选中 | Ctrl/Cmd+A 全选站点</p>
    </div>
  </section>
</template>

<style scoped>
.map-editor {
  border: 1px solid #cbd5e1;
  border-radius: 12px;
  background: #ffffff;
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
  border-bottom: 1px solid #e2e8f0;
}

.map-editor__header h2 {
  margin: 0;
  font-size: 16px;
}

.map-editor__stats {
  display: flex;
  gap: 12px;
  color: #334155;
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

.map-editor__hidden-input {
  display: none;
}

.map-editor__selection-box {
  position: absolute;
  border: 1px solid #0ea5e9;
  background: rgba(14, 165, 233, 0.14);
  pointer-events: none;
  z-index: 10;
}

.map-editor__context-mask {
  position: absolute;
  inset: 0;
  z-index: 30;
}

.map-editor__context-menu {
  position: absolute;
  width: 330px;
  max-height: calc(100% - 16px);
  overflow: auto;
  border: 1px solid #2b3643;
  border-radius: 12px;
  background: rgba(9, 16, 27, 0.97);
  color: #e2e8f0;
  padding: 10px;
  box-shadow: 0 18px 42px rgba(2, 6, 23, 0.48);
}

.map-editor__context-menu h3 {
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
.map-editor__context-line-list button {
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

.map-editor__context-line-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-height: 120px;
  overflow: auto;
}

.map-editor__context-line-list button {
  display: flex;
  align-items: center;
  gap: 7px;
}

.map-editor__context-line-list button.active {
  border-color: #22c55e;
}

.map-editor__context-line-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  flex-shrink: 0;
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
