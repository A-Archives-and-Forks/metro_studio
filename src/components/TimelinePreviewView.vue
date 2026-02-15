<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useProjectStore } from '../stores/projectStore'
import { createTimelinePreviewRenderer } from '../lib/timeline/timelinePreviewRenderer'
import IconBase from './IconBase.vue'

const props = defineProps({
  active: { type: Boolean, default: false },
})

const store = useProjectStore()
const containerRef = ref(null)
const canvasRef = ref(null)

let renderer = null
let resizeObserver = null

const hasData = computed(() => store.timelineHasData)
const pseudoMode = ref(false)
const playbackState = ref('idle')
const currentYear = ref(null)
const yearIndex = ref(0)
const totalYears = ref(0)
const playbackSpeed = ref(1)
const isFullscreen = ref(false)

const speedOptions = [0.2, 0.5, 0.8, 1, 1.5, 2, 3, 5]

/** Whether the project has edges (lines with geometry) at all — needed for pseudo mode. */
const hasEdges = computed(() => (store.project?.edges?.length || 0) > 0)

/** Whether the project has multiple lines with edges — pseudo mode needs at least 1 line with edges. */
const canUsePseudoMode = computed(() => {
  if (!store.project) return false
  const edgeLineIds = new Set()
  for (const edge of store.project.edges || []) {
    for (const lid of edge.sharedByLineIds || []) edgeLineIds.add(lid)
  }
  return edgeLineIds.size > 0
})

/** Whether the toolbar should be shown (real data or active pseudo mode). */
const showToolbar = computed(() => hasData.value || pseudoMode.value)

/** Current year display label — in pseudo mode, show line name from renderer. */
const currentYearLabel = computed(() => {
  if (!pseudoMode.value || currentYear.value == null) return currentYear.value
  const labels = renderer?.lineLabels
  if (labels && labels.has(currentYear.value)) {
    return labels.get(currentYear.value).nameZh
  }
  return `#${currentYear.value}`
})

const progressPercent = computed(() => {
  if (totalYears.value <= 1) return 0
  return (yearIndex.value / (totalYears.value - 1)) * 100
})

function createRenderer() {
  if (!canvasRef.value || !store.project) return
  if (!hasData.value && !pseudoMode.value) return
  destroyRenderer()

  renderer = createTimelinePreviewRenderer(canvasRef.value, store.project, {
    title: store.project.name || 'RailMap',
    author: '',
    pseudoMode: pseudoMode.value,
    onStateChange(state, info) {
      playbackState.value = state
      if (info) {
        currentYear.value = info.year
        yearIndex.value = info.yearIndex
        totalYears.value = info.totalYears
      }
    },
    onYearChange(year, idx, total) {
      currentYear.value = year
      yearIndex.value = idx
      totalYears.value = total
    },
  })

  renderer.setSpeed(playbackSpeed.value)

  // Initial sizing
  if (containerRef.value) {
    const rect = containerRef.value.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      renderer.resize(rect.width, rect.height)
    }
  }
}

function destroyRenderer() {
  if (renderer) {
    renderer.destroy()
    renderer = null
  }
}

function onPlay() {
  if (!renderer) createRenderer()
  renderer?.play()
}

function onPause() {
  renderer?.pause()
}

function onStop() {
  renderer?.stop()
}

function onSpeedChange(speed) {
  playbackSpeed.value = speed
  renderer?.setSpeed(speed)
}

/** Enter pseudo mode and start playback. */
function startPseudoPreview() {
  pseudoMode.value = true
  destroyRenderer()
  createRenderer()
  renderer?.play()
}

/** Exit pseudo mode and return to normal empty state. */
function exitPseudoMode() {
  pseudoMode.value = false
  destroyRenderer()
  playbackState.value = 'idle'
  currentYear.value = null
  yearIndex.value = 0
  totalYears.value = 0
}

async function toggleFullscreen() {
  if (!containerRef.value) return
  try {
    if (!document.fullscreenElement) {
      await containerRef.value.requestFullscreen()
    } else {
      await document.exitFullscreen()
    }
  } catch { /* noop */ }
}

function onFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement
}

function setupResizeObserver() {
  if (!containerRef.value) return
  resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0 && renderer) {
        renderer.resize(width, height)
      }
    }
  })
  resizeObserver.observe(containerRef.value)
}

// Pause rAF when view is not active
watch(
  () => props.active,
  (active) => {
    if (active && (hasData.value || pseudoMode.value)) {
      if (!renderer) createRenderer()
    } else if (!active && renderer) {
      if (playbackState.value !== 'idle') {
        renderer.stop()
      }
    }
  },
)

// Rebuild when project data changes
watch(
  () => store.project?.edges?.length,
  () => {
    if (props.active && renderer) {
      renderer.rebuild()
    }
  },
)

// When real timeline data appears, exit pseudo mode automatically
watch(hasData, (has) => {
  if (has && pseudoMode.value) {
    pseudoMode.value = false
    destroyRenderer()
    createRenderer()
  }
})

onMounted(() => {
  document.addEventListener('fullscreenchange', onFullscreenChange)
  setupResizeObserver()
  if (props.active && hasData.value) {
    createRenderer()
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  destroyRenderer()
})
</script>

<template>
  <section class="preview-view">
    <header class="preview-view__header">
      <h2>
        {{ pseudoMode ? '线序预览' : '时间轴预览' }}
      </h2>

      <div v-if="showToolbar" class="preview-view__toolbar">
        <div class="preview-view__playback">
          <button
            class="preview-view__btn"
            type="button"
            :title="playbackState === 'idle' ? '播放' : playbackState === 'loading' ? '加载瓦片中…' : '暂停'"
            :disabled="playbackState === 'loading'"
            @click="playbackState === 'idle' ? onPlay() : playbackState === 'playing' ? onPause() : null"
          >
            <IconBase :name="playbackState === 'playing' ? 'pause' : 'play'" :size="14" />
          </button>

          <button
            v-if="playbackState !== 'idle'"
            class="preview-view__btn"
            type="button"
            title="停止"
            @click="onStop"
          >
            <IconBase name="square" :size="12" />
          </button>
        </div>

        <span v-if="currentYear != null" class="preview-view__year">{{ currentYearLabel }}</span>

        <div class="preview-view__speed">
          <button
            v-for="s in speedOptions"
            :key="s"
            class="preview-view__speed-btn"
            :class="{ 'preview-view__speed-btn--active': playbackSpeed === s }"
            type="button"
            @click="onSpeedChange(s)"
          >
            {{ s }}x
          </button>
        </div>

        <button
          v-if="pseudoMode"
          class="preview-view__toggle-btn preview-view__toggle-btn--active"
          type="button"
          title="退出线序预览"
          @click="exitPseudoMode"
        >
          退出线序
        </button>

        <button
          class="preview-view__btn preview-view__btn--fullscreen"
          type="button"
          :title="isFullscreen ? '退出全屏' : '全屏'"
          @click="toggleFullscreen"
        >
          <IconBase :name="isFullscreen ? 'minimize' : 'maximize'" :size="14" />
        </button>
      </div>
    </header>

    <div ref="containerRef" class="preview-view__canvas-container">
      <canvas ref="canvasRef" class="preview-view__canvas" />

      <div v-if="!hasData && !pseudoMode" class="preview-view__empty">
        <IconBase name="clock" :size="32" />
        <p>暂无标记年份的线段，无法预览时间轴动画</p>
        <p class="preview-view__empty-hint">在线段属性中设置"开通年份"后即可使用</p>
        <button
          v-if="canUsePseudoMode"
          class="preview-view__pseudo-btn"
          type="button"
          @click="startPseudoPreview"
        >
          <IconBase name="play" :size="12" />
          按线路顺序预览伪"发展史"
        </button>
      </div>

      <div
        v-if="(hasData || pseudoMode) && playbackState !== 'idle' && totalYears > 1"
        class="preview-view__progress"
      >
        <div
          class="preview-view__progress-bar"
          :style="{ width: `${progressPercent}%` }"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.preview-view {
  border: 1px solid var(--workspace-panel-border);
  border-radius: 12px;
  background: var(--workspace-panel-bg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.preview-view__header {
  padding: 8px 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--workspace-panel-header-border);
  background: var(--workspace-panel-header-bg);
  color: var(--workspace-panel-text);
  flex-shrink: 0;
  gap: 12px;
}

.preview-view__header h2 {
  margin: 0;
  font-size: 16px;
  color: var(--workspace-panel-text);
  white-space: nowrap;
}

.preview-view__toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: nowrap;
}

.preview-view__playback {
  display: flex;
  align-items: center;
  gap: 4px;
}

.preview-view__btn {
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: var(--toolbar-button-bg);
  color: var(--toolbar-muted);
  border-radius: 4px;
  padding: 5px 7px;
  cursor: pointer;
  transition: color 0.12s, background 0.12s;
}

.preview-view__btn:hover {
  color: var(--toolbar-text);
  background: var(--toolbar-button-hover-bg);
}

.preview-view__btn--fullscreen {
  margin-left: auto;
}

.preview-view__year {
  font-size: 16px;
  font-weight: 700;
  color: var(--toolbar-text);
  min-width: 48px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  font-family: 'DIN Alternate', 'Bahnschrift', 'Roboto Condensed', monospace;
}

.preview-view__speed {
  display: flex;
  gap: 2px;
  border: 1px solid var(--toolbar-input-border);
  border-radius: 4px;
  overflow: hidden;
}

.preview-view__speed-btn {
  border: none;
  background: transparent;
  color: var(--toolbar-muted);
  font-size: 10px;
  padding: 2px 6px;
  cursor: pointer;
  transition: color 0.1s, background 0.1s;
}

.preview-view__speed-btn:hover {
  color: var(--toolbar-text);
}

.preview-view__speed-btn--active {
  background: var(--toolbar-primary-bg);
  color: var(--toolbar-primary-text, #fff);
}

.preview-view__toggle-btn {
  border: none;
  background: transparent;
  color: var(--toolbar-muted);
  font-size: 10px;
  padding: 2px 8px;
  cursor: pointer;
  transition: color 0.1s, background 0.1s;
}

.preview-view__toggle-btn:hover {
  color: var(--toolbar-text);
}

.preview-view__toggle-btn--active {
  background: var(--toolbar-primary-bg);
  color: var(--toolbar-primary-text, #fff);
}

.preview-view__canvas-container {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
  background: #ECEFF1;
}

.preview-view__canvas-container:fullscreen {
  background: #ECEFF1;
}

.preview-view__canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.preview-view__empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--workspace-panel-muted);
  background: var(--workspace-canvas-bg);
}

.preview-view__empty p {
  margin: 0;
  font-size: 14px;
}

.preview-view__empty-hint {
  font-size: 12px !important;
  opacity: 0.7;
}

.preview-view__pseudo-btn {
  margin-top: 8px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  border: 1px solid var(--toolbar-primary-bg, #2563eb);
  border-radius: 6px;
  background: transparent;
  color: var(--toolbar-primary-bg, #2563eb);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.preview-view__pseudo-btn:hover {
  background: var(--toolbar-primary-bg, #2563eb);
  color: #fff;
}

.preview-view__progress {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: rgba(0, 0, 0, 0.15);
}

.preview-view__progress-bar {
  height: 100%;
  background: var(--toolbar-primary-bg);
  transition: width 0.3s ease;
  border-radius: 0 2px 2px 0;
}
</style>
