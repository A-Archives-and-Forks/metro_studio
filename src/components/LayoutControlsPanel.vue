<script setup>
import { ref } from 'vue'
import IconBase from './IconBase.vue'
import TooltipWrapper from './TooltipWrapper.vue'
import { usePanelResize } from '../composables/usePanelResize'
import SchematicControls from './SchematicControls.vue'
import { useProjectStore } from '../stores/projectStore'

const { width, onPointerDown } = usePanelResize()
const collapsed = ref(false)
const store = useProjectStore()

function toggleCollapse() {
  collapsed.value = !collapsed.value
}
</script>

<template>
  <aside class="layout-controls-panel" :class="{ 'layout-controls-panel--collapsed': collapsed }" :style="collapsed ? {} : { width: `${width}px` }">
    <div v-if="!collapsed" class="layout-controls-panel__resize-handle" @pointerdown="onPointerDown" />
    <div class="layout-controls-panel__header">
      <template v-if="!collapsed">
        <IconBase name="sliders" :size="14" class="layout-controls-panel__header-icon" />
        <span class="layout-controls-panel__title">排版控制</span>
      </template>
      <TooltipWrapper :text="collapsed ? '展开面板' : '折叠面板'" placement="left">
        <button class="layout-controls-panel__collapse-btn" type="button" @click="toggleCollapse">
          <IconBase :name="collapsed ? 'chevron-left' : 'chevron-right'" :size="14" />
        </button>
      </TooltipWrapper>
    </div>
    <div v-if="!collapsed" class="layout-controls-panel__body">
      <SchematicControls />
    </div>
    <div v-if="!collapsed" class="layout-controls-panel__footer">
      <TooltipWrapper text="自动排版为官方风格" placement="top">
        <button
          class="pp-btn pp-btn--primary pp-btn--full"
          :disabled="store.isLayoutRunning || !store.project?.stations?.length"
          @click="store.runAutoLayout()"
        >
          {{ store.isLayoutRunning ? '排版中...' : '自动生成官方风' }}
        </button>
      </TooltipWrapper>
    </div>
  </aside>
</template>

<style scoped>
.layout-controls-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--toolbar-bg);
  border-left: 1px solid var(--toolbar-border);
  overflow: hidden;
  flex-shrink: 0;
  transition: width var(--transition-slow, 0.25s ease);
}

.layout-controls-panel--collapsed {
  width: 40px;
}

.layout-controls-panel__resize-handle {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  cursor: col-resize;
  z-index: 10;
  transition: background-color 0.15s ease;
}

.layout-controls-panel__resize-handle:hover,
.layout-controls-panel__resize-handle:active {
  background: var(--toolbar-tab-active-border);
}

.layout-controls-panel__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--toolbar-border);
  background: var(--toolbar-header-bg);
  flex-shrink: 0;
}

.layout-controls-panel__header-icon {
  flex-shrink: 0;
  color: var(--toolbar-muted);
}

.layout-controls-panel__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--toolbar-text);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.layout-controls-panel__collapse-btn {
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

.layout-controls-panel__collapse-btn:hover {
  color: var(--toolbar-text);
  background: rgba(255, 255, 255, 0.06);
}

.layout-controls-panel__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.layout-controls-panel__body::-webkit-scrollbar {
  width: 6px;
}

.layout-controls-panel__body::-webkit-scrollbar-thumb {
  background: var(--toolbar-scrollbar-thumb);
  border-radius: 999px;
}

.layout-controls-panel__footer {
  padding: 12px 14px;
  border-top: 1px solid var(--toolbar-border);
  background: var(--toolbar-bg);
  flex-shrink: 0;
}

.pp-btn--full {
  width: 100%;
}
</style>
