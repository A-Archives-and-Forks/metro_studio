<script setup>
import { computed, ref } from 'vue'
import { useAutoAnimate } from '@formkit/auto-animate/vue'
import { useProjectStore } from '../stores/projectStore'
import { usePanelResize } from '../composables/usePanelResize'
import { useAnimationSettings } from '../composables/useAnimationSettings.js'
import IconBase from './IconBase.vue'
import TooltipWrapper from './TooltipWrapper.vue'
import PanelNoSelection from './panels/PanelNoSelection.vue'
import PanelStationSingle from './panels/PanelStationSingle.vue'
import PanelStationMulti from './panels/PanelStationMulti.vue'
import PanelEdgeSingle from './panels/PanelEdgeSingle.vue'
import PanelEdgeMulti from './panels/PanelEdgeMulti.vue'
import PanelAnchor from './panels/PanelAnchor.vue'

const store = useProjectStore()
const { width, onPointerDown } = usePanelResize()
const collapsed = ref(false)
const panelBody = ref(null)

const { getAutoAnimateConfig } = useAnimationSettings()
useAutoAnimate(panelBody, getAutoAnimateConfig())

const selectedStationCount = computed(() => store.selectedStationIds.length)
const selectedEdgeCount = computed(() => store.selectedEdgeIds.length)

const selectedStation = computed(() => {
  if (!store.project || !store.selectedStationId) return null
  return store.project.stations.find((s) => s.id === store.selectedStationId) || null
})

const panelType = computed(() => {
  if (store.selectedEdgeAnchor) return 'anchor'
  if (selectedEdgeCount.value > 1) return 'edge-multi'
  if (selectedEdgeCount.value === 1) return 'edge-single'
  if (selectedStationCount.value === 1 && selectedStation.value) return 'station-single'
  if (selectedStationCount.value > 1) return 'station-multi'
  return 'none'
})

const panelTitle = computed(() => {
  switch (panelType.value) {
    case 'anchor': return '锚点'
    case 'edge-multi': return `线段（${selectedEdgeCount.value}）`
    case 'edge-single': return '线段'
    case 'station-single': return '站点'
    case 'station-multi': return `站点（${selectedStationCount.value}）`
    default: return '属性'
  }
})

const panelIcon = computed(() => {
  switch (panelType.value) {
    case 'anchor': return 'anchor'
    case 'edge-multi':
    case 'edge-single': return 'git-branch'
    case 'station-single':
    case 'station-multi': return 'map-pin'
    default: return 'settings'
  }
})

function toggleCollapse() {
  collapsed.value = !collapsed.value
}
</script>

<template>
  <aside class="properties-panel" :class="{ 'properties-panel--collapsed': collapsed }" :style="collapsed ? {} : { width: `${width}px` }">
    <div v-if="!collapsed" class="properties-panel__resize-handle" @pointerdown="onPointerDown" />
    <div class="properties-panel__header">
      <template v-if="!collapsed">
        <IconBase :name="panelIcon" :size="14" class="properties-panel__header-icon" />
        <span class="properties-panel__title">{{ panelTitle }}</span>
      </template>
      <TooltipWrapper :text="collapsed ? '展开面板' : '折叠面板'" placement="left">
        <button class="properties-panel__collapse-btn" type="button" @click="toggleCollapse">
          <IconBase :name="collapsed ? 'chevron-left' : 'chevron-right'" :size="14" />
        </button>
      </TooltipWrapper>
    </div>
    <div v-if="!collapsed" ref="panelBody" class="properties-panel__body">
      <PanelAnchor v-if="panelType === 'anchor'" />
      <PanelEdgeMulti v-else-if="panelType === 'edge-multi'" />
      <PanelEdgeSingle v-else-if="panelType === 'edge-single'" />
      <PanelStationSingle v-else-if="panelType === 'station-single'" />
      <PanelStationMulti v-else-if="panelType === 'station-multi'" />
      <PanelNoSelection v-else />
    </div>
  </aside>
</template>

<style scoped>
.properties-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--toolbar-bg);
  border-left: 1px solid var(--toolbar-border);
  overflow: hidden;
  flex-shrink: 0;
  transition: width var(--transition-slow, 0.25s ease);
}

.properties-panel--collapsed {
  width: 40px;
}

.properties-panel__resize-handle {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  cursor: col-resize;
  z-index: 10;
  transition: background-color 0.15s ease;
}

.properties-panel__resize-handle:hover,
.properties-panel__resize-handle:active {
  background: var(--toolbar-tab-active-border);
}

.properties-panel__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--toolbar-border);
  background: var(--toolbar-header-bg);
  flex-shrink: 0;
}

.properties-panel__header-icon {
  flex-shrink: 0;
  color: var(--toolbar-muted);
}

.properties-panel__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--toolbar-text);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.properties-panel__collapse-btn {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--toolbar-muted);
  cursor: pointer;
  padding: 2px;
  border-radius: var(--radius-sm, 4px);
  display: flex;
  align-items: center;
  transition: color var(--transition-fast, 0.1s ease), background var(--transition-fast, 0.1s ease);
}

.properties-panel__collapse-btn:hover {
  color: var(--toolbar-text);
  background: rgba(255, 255, 255, 0.06);
}

.properties-panel__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 12px;
}

.properties-panel__body::-webkit-scrollbar {
  width: 6px;
}

.properties-panel__body::-webkit-scrollbar-thumb {
  background: var(--toolbar-scrollbar-thumb);
  border-radius: 999px;
}
</style>
