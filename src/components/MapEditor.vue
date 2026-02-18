<script setup>
import maplibregl from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAutoAnimate } from '@formkit/auto-animate/vue'
import { useProjectStore } from '../stores/projectStore'
import {
  LAYER_EDGE_ANCHORS_HIT,
  LAYER_EDGES,
  LAYER_EDGES_HIT,
  LAYER_EDGES_SQUARE,
  LAYER_STATIONS,
} from './map-editor/constants'
import { buildMapStyle } from './map-editor/mapStyle'
import {
  ensureSources,
  ensureMapLayers,
  updateMapData,
  ensureLanduseLayer,
  removeLanduseLayer,
  updateLanduseVisibility,
  setStationHighlightVisibility,
} from './map-editor/mapLayers'
import { useMapContextMenu } from '../composables/useMapContextMenu.js'
import { useMapLineSelectionMenu } from '../composables/useMapLineSelectionMenu.js'
import { useMapExport } from '../composables/useMapExport.js'
import { useMapEventHandlers } from '../composables/useMapEventHandlers.js'
import { useMapBoundary } from '../composables/useMapBoundary.js'
import { useRouteDrawPreview } from '../composables/useRouteDrawPreview.js'
import { useMapTimelinePlayer } from '../composables/useMapTimelinePlayer.js'
import { useMapNavigation } from '../composables/useMapNavigation.js'
import { useAnimationSettings } from '../composables/useAnimationSettings.js'
import IconBase from './IconBase.vue'
import TimelineSlider from './TimelineSlider.vue'
import LanduseLegend from './LanduseLegend.vue'

const store = useProjectStore()
const mapContainer = ref(null)
const contextMenuRef = ref(null)
const lineSelectionMenuRef = ref(null)
const showHint = ref(false)
let map = null
let scaleControl = null

const { getAutoAnimateConfig } = useAnimationSettings()
useAutoAnimate(contextMenuRef, getAutoAnimateConfig())
useAutoAnimate(lineSelectionMenuRef, getAutoAnimateConfig())

function getMap() {
  return map
}

// ── Composables ──

const {
  contextMenu,
  contextMenuStyle,
  hasSelection,
  contextStation,
  contextTargetLabel,
  canMergeAtContextStation,
  closeContextMenu,
  adjustContextMenuPosition,
  openContextMenu,
  onContextOverlayMouseDown,
  setModeFromContext,
  addStationAtContext,
  clearSelectionFromContext,
  addEdgeAnchorFromContext,
  removeEdgeAnchorFromContext,
  clearContextEdgeAnchorsFromContext,
  renameContextStationFromContext,
  deleteContextStationFromContext,
  deleteContextEdgeFromContext,
  splitEdgeAtContext,
  mergeEdgesAtContextStation,
  aiTranslateContextStationEnglishFromContext,
} = useMapContextMenu({
  store,
  mapContainerRef: mapContainer,
  contextMenuRef,
  getMap,
})

const {
  lineSelectionMenu,
  closeLineSelectionMenu,
  openLineSelectionMenu,
  selectLineFromMenu,
  onLineSelectionMenuOverlayMouseDown,
} = useMapLineSelectionMenu({
  store,
  mapContainerRef: mapContainer,
  closeContextMenu,
})

const lineSelectionMenuStyle = computed(() => ({
  left: `${lineSelectionMenu.x}px`,
  top: `${lineSelectionMenu.y}px`,
}))

const { exportActualRoutePngFromMap } = useMapExport({ store, getMap })

const {
  routeDrawPreview,
  routeDrawDistanceLabel,
  routeDrawDistanceStyle,
  clearRouteDrawPreview,
  refreshRouteDrawPreviewProjectedPoints,
  updateRouteDrawPreview,
} = useRouteDrawPreview({ store, getMap })

const {
  selectionBox,
  handleStationClick,
  handleEdgeClick,
  handleEdgeAnchorClick,
  handleMapClick,
  handleMapContextMenu,
  startStationDrag,
  startEdgeAnchorDrag,
  onMouseMove,
  stopStationDrag,
  startBoxSelection,
  onInteractiveFeatureEnter,
  onInteractiveFeatureLeave,
  handleWindowResize,
} = useMapEventHandlers({
  store,
  getMap,
  closeContextMenu,
  closeLineSelectionMenu,
  openContextMenu,
  updateRouteDrawPreview,
  clearRouteDrawPreview,
  openLineSelectionMenu,
  refreshRouteDrawPreviewProjectedPoints,
  contextMenu,
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

const {
  fitMapToBoundary,
  setMapNotReady,
  onMapLoad: onBoundaryMapLoad,
  setupBoundaryWatcher,
} = useMapBoundary({ store, getMap })

const {
  onTimelineYearChange,
  onTimelinePlay,
  onTimelinePause,
  onTimelineStop,
  onTimelineSpeedChange,
  destroy: destroyTimelinePlayer,
} = useMapTimelinePlayer({ store })

const {
  navPrompt,
  navResultVisible,
  initNavigation,
  destroyNavigation,
} = useMapNavigation({ store, getMap })

// ── Map helpers ──

function lockMapNorthUp() {
  if (!map) return
  map.dragRotate?.disable()
  map.touchZoomRotate?.disableRotation()
  map.setBearing(0)
  map.setPitch(0)
}

function onWindowResize() {
  handleWindowResize(adjustContextMenuPosition)
}

// ── Escape callback registration ──
const registerEscapeCallback = inject('registerEscapeCallback', null)
const unregisterEscapeCallback = inject('unregisterEscapeCallback', null)

function escapeHandler() {
  if (contextMenu.visible) {
    closeContextMenu()
    return true
  }
  return false
}

function formatNavDistance(meters) {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`
  return `${Math.round(meters)} m`
}

const measureMarkersKey = ref(0)
const annotationMarkersKey = ref(0)

function getMeasureMarkerStyle(lngLat) {
  if (!map || !lngLat) return { display: 'none' }
  const point = map.project(lngLat)
  return {
    left: `${point.x}px`,
    top: `${point.y}px`,
  }
}

function getAnnotationMarkerStyle(lngLat) {
  if (!map || !lngLat) return { display: 'none' }
  const point = map.project(lngLat)
  return {
    left: `${point.x}px`,
    top: `${point.y}px`,
  }
}

const measureLines = computed(() => {
  // 依赖 measureMarkersKey 来触发重新计算
  const _ = measureMarkersKey.value
  if (!map || !store.measure.points || store.measure.points.length < 2) return []
  const lines = []
  for (let i = 0; i < store.measure.points.length - 1; i++) {
    const p1 = map.project(store.measure.points[i].lngLat)
    const p2 = map.project(store.measure.points[i + 1].lngLat)
    lines.push({
      x1: p1.x,
      y1: p1.y,
      x2: p2.x,
      y2: p2.y,
    })
  }
  return lines
})

function updateMeasureAndAnnotationPositions() {
  measureMarkersKey.value++
  annotationMarkersKey.value++
}

// ── Lifecycle ──

onMounted(() => {
  store.registerActualRoutePngExporter(exportActualRoutePngFromMap)

  const pmtilesProtocol = new Protocol()
  maplibregl.addProtocol('pmtiles', pmtilesProtocol.tile)

  map = new maplibregl.Map({
    container: mapContainer.value,
    style: buildMapStyle(store.mapTileType),
    center: [116.40, 39.90],
    zoom: 4,
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
  map.addControl(scaleControl, 'top-left')

  map.on('load', () => {
    lockMapNorthUp()
    ensureSources(map, store)
    ensureMapLayers(map, store)
    updateMapData(map, store)
    map.resize()

    onBoundaryMapLoad()

    if (store.showLanduseOverlay) {
      ensureLanduseLayer(map, store)
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

    initNavigation(map)
  })

  map.on('click', handleMapClick)
  map.on('contextmenu', handleMapContextMenu)
  map.on('mousedown', startBoxSelection)
  map.on('mousemove', onMouseMove)
  map.on('mouseup', stopStationDrag)
  map.on('mouseleave', stopStationDrag)
  map.on('move', refreshRouteDrawPreviewProjectedPoints)
  map.on('move', updateMeasureAndAnnotationPositions)
  map.on('zoom', updateMeasureAndAnnotationPositions)
  window.addEventListener('resize', onWindowResize)
  if (registerEscapeCallback) registerEscapeCallback(escapeHandler)
})

onBeforeUnmount(() => {
  setMapNotReady()
  store.unregisterActualRoutePngExporter(exportActualRoutePngFromMap)
  window.removeEventListener('resize', onWindowResize)
  if (unregisterEscapeCallback) unregisterEscapeCallback(escapeHandler)
  closeContextMenu()
  destroyTimelinePlayer()
  destroyNavigation()
  scaleControl = null
  maplibregl.removeProtocol('pmtiles')
  removeLanduseLayer(map)
  if (map) {
    map.remove()
  }
})

// ── Watchers ──

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
  },
)

watch(
  () => store.navigation.active,
  (active) => {
    if (!map) return
    const opacity = active ? 0.2 : 0.88
    if (map.getLayer(LAYER_EDGES)) {
      map.setPaintProperty(LAYER_EDGES, 'line-opacity', opacity)
    }
    if (map.getLayer(LAYER_EDGES_SQUARE)) {
      map.setPaintProperty(LAYER_EDGES_SQUARE, 'line-opacity', opacity)
    }
  },
  { immediate: true },
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
    ensureSources(map, store)
    ensureMapLayers(map, store)
    updateMapData(map, store)
  },
  { deep: true },
)

  setupBoundaryWatcher()

  watch(
    () => ({
      showLanduseOverlay: store.showLanduseOverlay,
      protomapsApiKey: store.protomapsApiKey,
    }),
    ({ showLanduseOverlay: visible }) => {
      if (!map || !map.isStyleLoaded()) return
      if (visible) {
        ensureLanduseLayer(map, store)
      } else {
        removeLanduseLayer(map)
      }
    },
  )

  watch(
    () => store.highlightStationLocations,
    (visible) => {
      if (!map || !map.isStyleLoaded()) return
      setStationHighlightVisibility(map, visible)
    },
  )

  watch(
    () => ({
      active: store.quickRename?.active,
      currentIndex: store.quickRename?.currentIndex,
      stationOrder: store.quickRename?.stationOrder,
    }),
    ({ active, currentIndex, stationOrder }) => {
      if (!map || !map.isStyleLoaded() || !active) return
      if (currentIndex < 0 || currentIndex >= stationOrder.length) return

      const stationId = stationOrder[currentIndex]
      const station = store.project?.stations?.find(s => s.id === stationId)
      if (!station || !station.lngLat) return

      const [lng, lat] = station.lngLat
      const currentZoom = map.getZoom()
      const targetZoom = Math.max(14, Math.min(16, currentZoom))

      requestAnimationFrame(() => {
        map.easeTo({
          center: [lng, lat],
          zoom: targetZoom,
          duration: 300,
        })
      })
    },
    { deep: true, immediate: true },
  )

  watch(
    () => store.mapTileType,
    (newTileType) => {
      if (!map) return
      const center = map.getCenter()
      const zoom = map.getZoom()
      const bearing = map.getBearing()
      const pitch = map.getPitch()

      map.setStyle(buildMapStyle(newTileType))

      map.once('style.load', () => {
        ensureSources(map, store)
        ensureMapLayers(map, store)
        updateMapData(map, store)
        if (store.showLanduseOverlay) {
          ensureLanduseLayer(map, store)
        }
        setStationHighlightVisibility(map, store.highlightStationLocations)
        map.setCenter(center)
        map.setZoom(zoom)
        map.setBearing(bearing)
        map.setPitch(pitch)
        lockMapNorthUp()
      })
    },
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
              <button @click="setModeFromContext('add-edge')">拉线</button>
              <button @click="setModeFromContext('route-draw')">连续布线</button>
            </div>
          </div>

          <div v-if="contextMenu.targetType === 'map'" class="map-editor__context-section">
            <p>空白处操作</p>
            <div class="map-editor__context-row">
              <button @click="addStationAtContext" :disabled="!contextMenu.lngLat">在此新增站点</button>
              <button @click="clearSelectionFromContext">清空选择</button>
            </div>
          </div>

          <div v-if="contextMenu.targetType === 'station'" class="map-editor__context-section">
            <p>站点操作</p>
            <div class="map-editor__context-row">
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

      <!-- 测量连线 -->
      <svg v-if="measureLines.length > 0" class="map-editor__measure-lines" aria-hidden="true">
        <line
          v-for="(line, index) in measureLines"
          :key="`measure-line-${index}-${measureMarkersKey}`"
          :x1="line.x1"
          :y1="line.y1"
          :x2="line.x2"
          :y2="line.y2"
          stroke="#3b82f6"
          stroke-width="3"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-dasharray="8 4"
        />
      </svg>

      <!-- 测量点标记 -->
      <div
        v-for="(point, index) in store.measure.points"
        :key="`measure-${index}-${measureMarkersKey}`"
        class="map-editor__measure-marker"
        :style="getMeasureMarkerStyle(point.lngLat)"
      >
        <div class="map-editor__measure-marker-icon">{{ index + 1 }}</div>
      </div>

      <!-- 注释标记 -->
      <div
        v-for="annotation in (store.project?.annotations || [])"
        :key="`annotation-${annotation.id}-${annotationMarkersKey}`"
        class="map-editor__annotation-marker"
        :class="{ active: annotation.id === store.selectedAnnotationId }"
        :style="getAnnotationMarkerStyle(annotation.lngLat)"
      >
        <div class="map-editor__annotation-marker-icon">
          <IconBase name="message-circle" :size="16" />
        </div>
        <div v-if="annotation.text" class="map-editor__annotation-marker-text">{{ annotation.text }}</div>
      </div>

      <div v-if="navPrompt" class="map-editor__nav-prompt">
        <IconBase name="navigation" :size="14" />
        <span>{{ navPrompt }}</span>
        <button class="map-editor__nav-prompt-close" @click="store.exitNavigation()">Esc 退出</button>
      </div>

      <div v-if="navResultVisible" class="map-editor__nav-panel">
        <div class="map-editor__nav-panel-header">
          <h3>导航结果</h3>
          <button class="map-editor__nav-panel-close" @click="store.exitNavigation()" aria-label="关闭导航">
            <IconBase name="x" :size="14" />
          </button>
        </div>
        <div v-if="store.navigation.result" class="map-editor__nav-panel-body">
          <div class="map-editor__nav-summary">
            <span class="map-editor__nav-total">总距离 {{ formatNavDistance(store.navigation.result.totalMeters) }}</span>
            <span class="map-editor__nav-detail">
              步行 {{ formatNavDistance(store.navigation.result.walkToOriginMeters) }}
              → 地铁 {{ formatNavDistance(store.navigation.result.transitMeters) }}
              → 步行 {{ formatNavDistance(store.navigation.result.walkFromDestMeters) }}
            </span>
          </div>
          <div
            v-for="(seg, i) in store.navigation.result.segments"
            :key="i"
            class="map-editor__nav-segment"
          >
            <span class="map-editor__nav-seg-color" :style="{ background: seg.lineColor }"></span>
            <span class="map-editor__nav-seg-text">
              {{ seg.lineName }}：{{ seg.fromStation }} → {{ seg.toStation }}（{{ seg.stationCount }}站，{{ formatNavDistance(seg.distanceMeters) }}）
            </span>
          </div>
        </div>
        <div v-else class="map-editor__nav-panel-body">
          <p class="map-editor__nav-no-route">未找到可达路径，请尝试更近的位置</p>
        </div>
      </div>

      <button
        class="map-editor__hint-toggle"
        :class="{ 'map-editor__hint-toggle--active': showHint }"
        @click="showHint = !showHint"
        title="显示/隐藏快捷键提示"
      >
        <IconBase name="info" :size="18" />
      </button>

      <p v-if="showHint" class="map-editor__hint">
        Shift + 拖拽框选站点 | Ctrl/⌘ + 拖拽框选线段 | Alt + 点击线段选中整条线路 | Delete 删除站点/线段/锚点 | Ctrl/Cmd+A 全选站点 | Ctrl/Cmd+Z 撤销 |
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
    <LanduseLegend :visible="store.showLanduseOverlay" />
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
  animation: selection-appear var(--transition-fast) forwards;
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
  transition: border-color var(--transition-normal);
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
  transition: border-color var(--transition-normal), background-color var(--transition-normal);
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
  transition: border-color var(--transition-normal), background-color var(--transition-normal);
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

.map-editor__hint-toggle {
  position: absolute;
  left: 12px;
  bottom: 10px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--toolbar-card-bg);
  color: var(--toolbar-text);
  border: 1px solid var(--toolbar-border);
  border-radius: 6px;
  cursor: pointer;
  z-index: 12;
  transition: all 0.2s ease;
  padding: 0;
}

.map-editor__hint-toggle:hover {
  background: var(--toolbar-hover-bg);
  border-color: var(--toolbar-hover-border);
}

.map-editor__hint-toggle--active {
  background: var(--toolbar-primary-bg);
  color: #fff;
  border-color: var(--toolbar-primary-border);
}

.map-editor__hint {
  position: absolute;
  left: 52px;
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

.map-editor__nav-prompt {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  border: 1px solid var(--toolbar-border);
  border-radius: 999px;
  background: var(--toolbar-card-bg);
  color: var(--toolbar-text);
  font-size: 12px;
  font-weight: 500;
  z-index: 20;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  pointer-events: auto;
}

.map-editor__nav-prompt-close {
  border: none;
  background: transparent;
  color: var(--toolbar-muted);
  font-size: 11px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: color var(--transition-fast), background var(--transition-fast);
}

.map-editor__nav-prompt-close:hover {
  color: var(--toolbar-text);
  background: rgba(255, 255, 255, 0.08);
}

.map-editor__nav-panel {
  position: absolute;
  top: 12px;
  right: 56px;
  width: 280px;
  max-height: calc(100% - 24px);
  overflow: auto;
  border: 1px solid var(--toolbar-border);
  border-radius: 12px;
  background: var(--toolbar-card-bg);
  color: var(--toolbar-text);
  padding: 10px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.25);
  z-index: 20;
}

.map-editor__nav-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.map-editor__nav-panel-header h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.map-editor__nav-panel-close {
  border: none;
  background: transparent;
  color: var(--toolbar-muted);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  transition: color var(--transition-fast), background var(--transition-fast);
}

.map-editor__nav-panel-close:hover {
  color: var(--toolbar-text);
  background: rgba(255, 255, 255, 0.08);
}

.map-editor__nav-panel-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.map-editor__nav-summary {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--toolbar-divider);
}

.map-editor__nav-total {
  font-size: 15px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.map-editor__nav-detail {
  font-size: 11px;
  color: var(--toolbar-muted);
  line-height: 1.4;
}

.map-editor__nav-segment {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 0;
}

.map-editor__nav-seg-color {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  border: 1.5px solid rgba(0, 0, 0, 0.12);
  flex-shrink: 0;
  margin-top: 1px;
}

.map-editor__nav-seg-text {
  font-size: 12px;
  line-height: 1.4;
}

.map-editor__nav-no-route {
  margin: 0;
  font-size: 12px;
  color: var(--toolbar-muted);
  text-align: center;
  padding: 12px 0;
}

.map-editor__measure-lines {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 18;
}

.map-editor__measure-marker {
  position: absolute;
  transform: translate(-50%, -50%);
  pointer-events: none;
  z-index: 20;
  animation: measure-marker-appear 0.2s ease-out;
}

@keyframes measure-marker-appear {
  from {
    transform: translate(-50%, -50%) scale(0);
    opacity: 0;
  }
  to {
    transform: translate(-50%, -50%) scale(1);
    opacity: 1;
  }
}

.map-editor__measure-marker-icon {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  border: 3px solid white;
  box-shadow: 0 3px 12px rgba(59, 130, 246, 0.4), 0 1px 4px rgba(0, 0, 0, 0.2);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

.map-editor__annotation-marker {
  position: absolute;
  transform: translate(-50%, -100%);
  pointer-events: none;
  z-index: 19;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  max-width: 200px;
}

.map-editor__annotation-marker-icon {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #f59e0b;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 3px solid white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  transition: all 0.2s ease;
}

.map-editor__annotation-marker:hover .map-editor__annotation-marker-icon {
  background: #d97706;
  transform: scale(1.1);
}

.map-editor__annotation-marker.active .map-editor__annotation-marker-icon {
  background: #dc2626;
  border-color: #fca5a5;
}

.map-editor__annotation-marker-text {
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.8);
  color: white;
  font-size: 11px;
  line-height: 1.3;
  max-width: 100%;
  word-break: break-word;
  text-align: center;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
}
</style>
