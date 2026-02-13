<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { buildSchematicRenderModel } from '../lib/schematic/renderModel'
import { useProjectStore } from '../stores/projectStore'

const store = useProjectStore()
const svgRef = ref(null)
const viewport = reactive({
  scale: 1,
  tx: 0,
  ty: 0,
})
const panState = reactive({
  active: false,
  lastClientX: 0,
  lastClientY: 0,
})

const latestSnapshot = computed(() => {
  const snapshots = store.project?.snapshots || []
  return snapshots.length ? snapshots[snapshots.length - 1] : null
})

const renderModel = computed(() => buildSchematicRenderModel(store.project, {}))
const viewportTransform = computed(() => `translate(${viewport.tx} ${viewport.ty}) scale(${viewport.scale})`)

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function resetViewport() {
  viewport.scale = 1
  viewport.tx = 0
  viewport.ty = 0
}

function toSvgPoint(clientX, clientY) {
  if (!svgRef.value) return null
  const ctm = svgRef.value.getScreenCTM()
  if (!ctm) return null
  const point = svgRef.value.createSVGPoint()
  point.x = clientX
  point.y = clientY
  return point.matrixTransform(ctm.inverse())
}

function onCanvasWheel(event) {
  const focus = toSvgPoint(event.clientX, event.clientY)
  if (!focus) return

  const oldScale = viewport.scale
  const zoomFactor = Math.exp(-event.deltaY * 0.0017)
  const nextScale = clamp(oldScale * zoomFactor, 0.35, 7)
  if (Math.abs(nextScale - oldScale) < 1e-6) return

  viewport.tx += (oldScale - nextScale) * focus.x
  viewport.ty += (oldScale - nextScale) * focus.y
  viewport.scale = nextScale
}

function onCanvasMouseDown(event) {
  if (event.button !== 1) return
  event.preventDefault()
  panState.active = true
  panState.lastClientX = event.clientX
  panState.lastClientY = event.clientY
}

function onCanvasAuxClick(event) {
  if (event.button === 1) {
    event.preventDefault()
  }
}

function endMiddlePan() {
  panState.active = false
}

function onGlobalMouseMove(event) {
  if (!panState.active) return

  const previous = toSvgPoint(panState.lastClientX, panState.lastClientY)
  const current = toSvgPoint(event.clientX, event.clientY)
  if (previous && current) {
    viewport.tx += current.x - previous.x
    viewport.ty += current.y - previous.y
  }

  panState.lastClientX = event.clientX
  panState.lastClientY = event.clientY
}

function onGlobalMouseUp(event) {
  if (!panState.active) return
  if (event.type === 'mouseup' && event.button !== 1) return
  endMiddlePan()
}

watch(
  () => [store.project?.id || '', renderModel.value.width, renderModel.value.height],
  async () => {
    await nextTick()
    resetViewport()
  },
  { immediate: true },
)

onMounted(() => {
  window.addEventListener('mousemove', onGlobalMouseMove)
  window.addEventListener('mouseup', onGlobalMouseUp)
  window.addEventListener('blur', onGlobalMouseUp)
})

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onGlobalMouseMove)
  window.removeEventListener('mouseup', onGlobalMouseUp)
  window.removeEventListener('blur', onGlobalMouseUp)
})
</script>

<template>
  <section class="schematic-view">
    <header class="schematic-view__header">
      <h2>官方风示意图视图（地理主导）</h2>
      <div class="schematic-view__stats">
        <span v-if="latestSnapshot">评分: {{ latestSnapshot.score.toFixed(2) }}</span>
        <span>快照: {{ store.project?.snapshots.length || 0 }}</span>
      </div>
    </header>

    <div
      class="schematic-view__canvas"
      :class="{ 'schematic-view__canvas--panning': panState.active }"
      @wheel.prevent="onCanvasWheel"
      @mousedown="onCanvasMouseDown"
      @auxclick="onCanvasAuxClick"
    >
      <svg
        ref="svgRef"
        :viewBox="`0 0 ${renderModel.width} ${renderModel.height}`"
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
      >
        <rect :width="renderModel.width" :height="renderModel.height" :fill="renderModel.theme.background" />

        <g :transform="viewportTransform">
          <g class="schematic-view__edges-halo">
            <path
              v-for="edge in renderModel.edgePaths"
              :key="`halo_${edge.id}`"
              :d="edge.pathD"
              fill="none"
              stroke="#f8fafc"
              :stroke-width="edge.width + 5.4"
              stroke-linecap="round"
              stroke-linejoin="round"
              :opacity="Math.min(1, edge.opacity + 0.06)"
            />
          </g>

          <g class="schematic-view__edges-core">
            <path
              v-for="edge in renderModel.edgePaths"
              :key="edge.id"
              :d="edge.pathD"
              fill="none"
              :stroke="edge.color"
              :stroke-width="edge.width"
              stroke-linecap="round"
              stroke-linejoin="round"
              :opacity="edge.opacity"
            />
          </g>

          <g class="schematic-view__stations">
            <g v-for="station in renderModel.stations" :key="station.id">
              <rect
                v-if="station.isInterchange"
                :x="station.x - 5.8"
                :y="station.y - 3.6"
                width="11.6"
                height="7.2"
                rx="3.5"
                ry="3.5"
                fill="#ffffff"
                :stroke="renderModel.theme.interchangeStroke"
                stroke-width="1.7"
              />
              <circle
                v-else
                :cx="station.x"
                :cy="station.y"
                r="4.1"
                fill="#ffffff"
                :stroke="renderModel.theme.stationStroke"
                stroke-width="1.7"
              />

              <text
                class="schematic-view__label-zh"
                :x="station.labelX"
                :y="station.labelY"
                :text-anchor="station.labelAnchor"
              >
                {{ station.nameZh }}
              </text>
              <text
                v-if="station.nameEn"
                class="schematic-view__label-en"
                :x="station.labelX"
                :y="station.labelY + 11"
                :text-anchor="station.labelAnchor"
              >
                {{ station.nameEn }}
              </text>
            </g>
          </g>

          <g class="schematic-view__title">
            <text x="54" y="116" class="schematic-view__title-city-en">{{ renderModel.title.cityEn }}</text>
            <text x="246" y="116" class="schematic-view__title-city-zh">{{ renderModel.title.cityZh }}</text>
          </g>
        </g>
      </svg>
    </div>
  </section>
</template>

<style scoped>
.schematic-view {
  border: 1px solid #d3dbe2;
  border-radius: 12px;
  background: #ffffff;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.schematic-view__header {
  padding: 12px 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #e2e8f0;
}

.schematic-view__header h2 {
  margin: 0;
  font-size: 16px;
}

.schematic-view__stats {
  display: flex;
  gap: 10px;
  font-size: 12px;
  color: #334155;
}

.schematic-view__canvas {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: #eef2f4;
  user-select: none;
  cursor: default;
}

.schematic-view__canvas--panning {
  cursor: grabbing;
}

.schematic-view__canvas svg {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
}

.schematic-view__label-zh {
  font-size: 11.8px;
  fill: #111827;
}

.schematic-view__label-en {
  font-size: 9.3px;
  letter-spacing: 0.015em;
  fill: #7b8794;
}

.schematic-view__title-city-en {
  font-size: 64px;
  font-weight: 700;
  letter-spacing: 0.03em;
  fill: #3db4d6;
}

.schematic-view__title-city-zh {
  font-size: 58px;
  font-weight: 700;
  fill: #2fa3c9;
}
</style>
