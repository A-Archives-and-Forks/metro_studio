<script setup>
import { computed, inject } from 'vue'
import { useProjectStore } from '../stores/projectStore'
import { useWorldMetroRanking } from '../composables/useWorldMetroRanking'
import TooltipWrapper from './TooltipWrapper.vue'

const store = useProjectStore()
const { state: ranking, rankingMessage, comparisonMessage, timestamp, refresh: refreshRanking } = useWorldMetroRanking()

const saveState = inject('autoSaveSaveState')
const lastSavedAt = inject('autoSaveLastSavedAt')
const saveNow = inject('autoSaveSaveNow')

const saveIndicator = computed(() => {
  switch (saveState?.value) {
    case 'saving':
      return { label: '正在保存...', cssClass: 'status-bar__save--saving' }
    case 'unsaved':
      return { label: '未保存更改', cssClass: 'status-bar__save--unsaved' }
    case 'error':
      return { label: '保存失败', cssClass: 'status-bar__save--error' }
    case 'saved':
    default:
      return { label: '已保存', cssClass: 'status-bar__save--saved' }
  }
})

const lastSavedLabel = computed(() => {
  if (!lastSavedAt?.value) return ''
  const d = lastSavedAt.value
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
})

const MODE_LABELS = {
  select: '选择/拖拽',
  'add-station': '点站',
  'ai-add-station': 'AI点站',
  'add-edge': '拉线',
  'route-draw': '连续布线',
  'style-brush': '样式刷',
  'box-select': '框选',
  'quick-link': '快速连线',
  'anchor-edit': '锚点编辑',
  'delete-mode': '删除',
  'measure-two-point': '两点测量',
  'measure-multi-point': '多点测量',
  'annotation': '注释',
}

const modeLabel = computed(() => MODE_LABELS[store.mode] || store.mode)

const selectionSummary = computed(() => {
  const stationCount = store.selectedStationIds?.length || 0
  const edgeCount = store.selectedEdgeIds?.length || 0
  const anchorSelected = store.selectedEdgeAnchor ? 1 : 0

  const parts = []
  if (stationCount > 0) parts.push(`${stationCount} 站点`)
  if (edgeCount > 0) parts.push(`${edgeCount} 线段`)
  if (anchorSelected > 0) parts.push(`${anchorSelected} 锚点`)

  return parts.length > 0 ? parts.join(', ') : '无选中'
})

const projectSummary = computed(() => {
  if (!store.project) return '无工程'
  const stationCount = store.project.stations?.length || 0
  const edgeCount = store.project.edges?.length || 0
  const lineCount = store.project.lines?.length || 0
  return `${lineCount} 线路 · ${stationCount} 站点 · ${edgeCount} 线段`
})
</script>

<template>
  <footer class="status-bar">
    <div class="status-bar__section">
      <span class="status-bar__label">模式</span>
      <span class="status-bar__badge">{{ modeLabel }}</span>
      <span v-if="store.currentEditYear != null" class="status-bar__badge status-bar__badge--year">编辑年份: {{ store.currentEditYear }}</span>
    </div>
    <div class="status-bar__divider"></div>
    <div class="status-bar__section">
      <span class="status-bar__label">选中</span>
      <span class="status-bar__value">{{ selectionSummary }}</span>
    </div>
    <div class="status-bar__divider"></div>
    <div class="status-bar__section status-bar__section--grow">
      <span class="status-bar__label">工程</span>
      <span class="status-bar__value">{{ projectSummary }}</span>
    </div>
    <div class="status-bar__divider"></div>
    <div class="status-bar__section status-bar__section--save" @click="saveNow">
      <span class="status-bar__save-dot" :class="saveIndicator.cssClass"></span>
      <span class="status-bar__value">{{ saveIndicator.label }}</span>
      <span v-if="lastSavedLabel && saveState?.value !== 'saving'" class="status-bar__save-time">{{ lastSavedLabel }}</span>
    </div>
    <div v-if="store.statusText" class="status-bar__divider"></div>
    <div v-if="store.statusText" class="status-bar__section status-bar__section--status">
      <span class="status-bar__value status-bar__value--status">{{ store.statusText }}</span>
    </div>
    <div class="status-bar__divider"></div>
    <div class="status-bar__section">
      <span class="status-bar__label">全球排名</span>
      <TooltipWrapper :text="`${comparisonMessage || ''}${timestamp ? ` · ${timestamp}` : ''}`" placement="top">
        <span class="status-bar__value status-bar__value--ranking" @click="refreshRanking" style="cursor: pointer;">
          {{ ranking.loading ? '加载中...' : rankingMessage }}
        </span>
      </TooltipWrapper>
    </div>
  </footer>
</template>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 12px;
  background: var(--workspace-panel-header-bg);
  border-top: 1px solid var(--workspace-panel-header-border);
  font-size: 11px;
  line-height: 1.4;
  min-height: 28px;
}

.status-bar__section {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  min-width: 0;
}

.status-bar__section--grow {
  flex: 1;
  min-width: 0;
}

.status-bar__section--status {
  margin-left: auto;
  min-width: 0;
}

.status-bar__label {
  color: var(--workspace-panel-muted);
  font-weight: 600;
  flex-shrink: 0;
}

.status-bar__badge {
  color: var(--toolbar-tab-active-text);
  font-weight: 500;
  background: var(--toolbar-tab-active-bg);
  padding: 1px 6px;
  border-radius: var(--radius-sm, 4px);
  font-size: 10px;
}

.status-bar__badge--year {
  background: rgba(251, 191, 36, 0.15);
  color: #fbbf24;
}

.status-bar__value {
  color: var(--workspace-panel-text);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-bar__value--status {
  color: var(--toolbar-status);
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-bar__value--ranking {
  color: var(--toolbar-text);
  transition: color var(--transition-fast);
}

.status-bar__value--ranking:hover {
  color: var(--toolbar-tab-active-text);
}

.status-bar__divider {
  width: 1px;
  height: 12px;
  background: var(--workspace-panel-border);
  flex-shrink: 0;
}

.status-bar__section--save {
  cursor: pointer;
  border-radius: var(--radius-sm, 4px);
  padding: 2px 6px;
  margin: -2px 0;
  transition: background var(--transition-fast);
}

.status-bar__section--save:hover {
  background: rgba(255, 255, 255, 0.05);
}

.status-bar__save-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-bar__save--saved {
  background: #34d399;
  box-shadow: 0 0 4px rgba(52, 211, 153, 0.4);
}

.status-bar__save--unsaved {
  background: #fbbf24;
  box-shadow: 0 0 4px rgba(251, 191, 36, 0.4);
}

.status-bar__save--saving {
  background: #60a5fa;
  box-shadow: 0 0 4px rgba(96, 165, 250, 0.4);
  animation: save-pulse 1s ease-in-out infinite;
}

.status-bar__save--error {
  background: #f87171;
  box-shadow: 0 0 4px rgba(248, 113, 113, 0.4);
}

.status-bar__save-time {
  color: var(--workspace-panel-muted);
  font-size: 10px;
}

@keyframes save-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

@media (max-width: 960px) {
  .status-bar {
    flex-wrap: wrap;
    gap: 8px;
    padding: 6px 12px;
  }

  .status-bar__section--grow {
    flex-basis: 100%;
  }
}
</style>
