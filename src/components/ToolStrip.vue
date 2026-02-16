<script setup>
import { computed } from 'vue'
import IconBase from './IconBase.vue'
import TooltipWrapper from './TooltipWrapper.vue'
import { getEffectiveBindings, formatBindingDisplay } from '../lib/shortcutRegistry'

const props = defineProps({
  mode: { type: String, default: 'select' },
  canUndo: { type: Boolean, default: false },
  canRedo: { type: Boolean, default: false },
})

const emit = defineEmits(['set-mode', 'undo', 'redo'])

const TOOL_SHORTCUT_MAP = {
  'select': 'tool.select',
  'add-station': 'tool.addStation',
  'ai-add-station': 'tool.aiAddStation',
  'add-edge': 'tool.addEdge',
  'route-draw': 'tool.routeDraw',
  'style-brush': 'tool.styleBrush',
  'box-select': 'tool.boxSelect',
  'quick-link': 'tool.quickLink',
  'anchor-edit': 'tool.anchorEdit',
  'delete-mode': 'tool.delete',
  'measure': 'tool.measure',
  'annotation': 'tool.annotation',
}

const tools = computed(() => {
  const bindings = getEffectiveBindings()
  const bindingMap = new Map(bindings.map((b) => [b.id, b.binding]))
  return [
    { mode: 'select', icon: 'cursor', label: '选择' },
    { mode: 'add-station', icon: 'plus-circle', label: '点站' },
    { mode: 'ai-add-station', icon: 'sparkles', label: 'AI点站' },
    { mode: 'add-edge', icon: 'git-branch', label: '拉线' },
    { mode: 'route-draw', icon: 'route', label: '布线' },
    { mode: 'style-brush', icon: 'paintbrush', label: '样式刷' },
    { mode: 'box-select', icon: 'box-select', label: '框选' },
    { mode: 'quick-link', icon: 'link', label: '连线' },
    { mode: 'anchor-edit', icon: 'edit-3', label: '锚点' },
    { mode: 'delete-mode', icon: 'trash', label: '删除' },
    { mode: 'measure', icon: 'ruler', label: '测量' },
    { mode: 'annotation', icon: 'message-square', label: '注释' },
  ].map((t) => ({
    ...t,
    shortcut: formatBindingDisplay(bindingMap.get(TOOL_SHORTCUT_MAP[t.mode]) || ''),
  }))
})

const undoShortcut = computed(() => {
  const bindings = getEffectiveBindings()
  const b = bindings.find((x) => x.id === 'edit.undo')
  return b ? formatBindingDisplay(b.binding) : 'Ctrl+Z'
})

const redoShortcut = computed(() => {
  const bindings = getEffectiveBindings()
  const b = bindings.find((x) => x.id === 'edit.redo')
  return b ? formatBindingDisplay(b.binding) : 'Ctrl+Shift+Z'
})
</script>

<template>
  <aside class="tool-strip">
    <div class="tool-strip__tools">
      <TooltipWrapper
        v-for="tool in tools"
        :key="tool.mode"
        :text="tool.label"
        :shortcut="tool.shortcut"
        placement="right"
        :delay="300"
      >
        <button
          class="tool-strip__btn"
          :class="{ 'tool-strip__btn--active': mode === tool.mode }"
          type="button"
          @click="emit('set-mode', tool.mode)"
        >
          <IconBase :name="tool.icon" :size="18" />
        </button>
      </TooltipWrapper>
    </div>

    <div class="tool-strip__divider" />

    <div class="tool-strip__actions">
      <TooltipWrapper text="撤销" :shortcut="undoShortcut" placement="right" :delay="300">
        <button
          class="tool-strip__btn"
          :disabled="!canUndo"
          type="button"
          @click="emit('undo')"
        >
          <IconBase name="undo" :size="18" />
        </button>
      </TooltipWrapper>
      <TooltipWrapper text="重做" :shortcut="redoShortcut" placement="right" :delay="300">
        <button
          class="tool-strip__btn"
          :disabled="!canRedo"
          type="button"
          @click="emit('redo')"
        >
          <IconBase name="redo" :size="18" />
        </button>
      </TooltipWrapper>
    </div>
  </aside>
</template>

<style scoped>
.tool-strip {
  width: 44px;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0;
  background: var(--toolbar-bg);
  border-right: 1px solid var(--toolbar-border);
  overflow-y: auto;
  flex-shrink: 0;
}

.tool-strip__tools {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: 100%;
  padding: 0 6px;
}

.tool-strip__actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: 100%;
  padding: 0 6px;
}

.tool-strip__divider {
  width: 20px;
  height: 1px;
  margin: 8px 0;
  background: var(--toolbar-divider);
  flex-shrink: 0;
}

.tool-strip__btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--radius-md, 8px);
  background: transparent;
  color: var(--toolbar-muted);
  cursor: pointer;
  transition: color var(--transition-fast, 0.1s ease), background var(--transition-fast, 0.1s ease);
}

.tool-strip__btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  color: var(--toolbar-text);
}

.tool-strip__btn--active {
  color: var(--toolbar-tab-active-text);
  background: transparent;
}

.tool-strip__btn--active::before {
  content: '';
  position: absolute;
  left: -6px;
  top: 50%;
  transform: translateY(-50%);
  width: var(--indicator-width, 2px);
  height: 20px;
  background: var(--indicator-color, var(--toolbar-primary-bg));
  border-radius: 0 1px 1px 0;
}

.tool-strip__btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
</style>
