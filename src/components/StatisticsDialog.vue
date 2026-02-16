<script setup>
import { nextTick, ref, computed, watch } from 'vue'
import { useProjectStore } from '../stores/projectStore'
import IconBase from './IconBase.vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])

const store = useProjectStore()
const dialogRef = ref(null)
const activeTab = ref('basics')
const loading = ref(false)

const stats = computed(() => store.networkStatistics)

const tabs = [
  { key: 'basics', label: '基础概况', icon: 'grid' },
  { key: 'paths', label: '最长路径', icon: 'route' },
  { key: 'interchanges', label: '换乘枢纽', icon: 'git-branch' },
  { key: 'lines', label: '线路分析', icon: 'git-branch' },
]

function doClose() {
  emit('close')
}

function onKeydown(e) {
  if (e.key === 'Escape') {
    doClose()
  }
  if (e.key === 'Tab' && dialogRef.value) {
    const focusable = dialogRef.value.querySelectorAll(
      'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault()
        last.focus()
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }
}

function formatDistance(meters) {
  if (!meters && meters !== 0) return '-'
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`
  }
  return `${Math.round(meters)} m`
}

function getStationName(id) {
  return store.stationById.get(id)?.nameZh || id
}

function formatLineNames(lineIds) {
  return (lineIds || [])
    .map(lid => store.lineById.get(lid)?.nameZh)
    .filter(Boolean)
    .join('、')
}

watch(
  () => props.visible,
  async (visible) => {
    if (visible) {
      loading.value = true
      await nextTick()
      loading.value = false
    }
  }
)
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog-transition">
      <div
        v-if="visible"
        class="stats-overlay"
        @mousedown.self="doClose"
        @keydown="onKeydown"
      >
        <div
          ref="dialogRef"
          class="stats-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="统计信息"
        >
          <header class="stats-dialog__header">
            <h2 class="stats-dialog__title">统计信息</h2>
          </header>
          
          <div class="stats-dialog__tabs">
            <button
              v-for="tab in tabs"
              :key="tab.key"
              :class="['stats-dialog__tab', { 'stats-dialog__tab--active': activeTab === tab.key }]"
              type="button"
              @click="activeTab = tab.key"
            >
              <IconBase :name="tab.icon" :size="14" />
              <span>{{ tab.label }}</span>
            </button>
          </div>

          <div class="stats-dialog__body">
            <div v-if="loading" class="stats-dialog__loading">
              计算中...
            </div>
            
            <div v-else-if="!stats" class="stats-dialog__empty">
              暂无数据，请先创建或导入工程
            </div>

            <template v-else>
              <div v-show="activeTab === 'basics'" class="stats__section">
                <div class="stats-grid">
                  <div class="stats-card">
                    <div class="stats-card__label">线路总数</div>
                    <div class="stats-card__value">{{ stats.basics.lineCount }}</div>
                    <div class="stats-card__sub">运营线路</div>
                  </div>
                  <div class="stats-card">
                    <div class="stats-card__label">站点总数</div>
                    <div class="stats-card__value">{{ stats.basics.stationCount }}</div>
                    <div class="stats-card__sub">{{ stats.basics.interchangeCount }} 换乘站</div>
                  </div>
                  <div class="stats-card">
                    <div class="stats-card__label">线段总数</div>
                    <div class="stats-card__value">{{ stats.basics.edgeCount }}</div>
                    <div class="stats-card__sub">含曲线段</div>
                  </div>
                  <div class="stats-card">
                    <div class="stats-card__label">总里程</div>
                    <div class="stats-card__value">{{ stats.basics.totalKm.toFixed(1) }} km</div>
                    <div class="stats-card__sub">{{ formatDistance(stats.basics.totalMeters) }}</div>
                  </div>
                </div>

                <div v-if="stats.interchanges.total > 0" class="stats-group">
                  <h3 class="stats-group__title">换乘站分布</h3>
                  <div class="stats-row">
                    <span class="stats-row__label">N线换乘站</span>
                    <div class="stats-row__value">
                      <span
                        v-for="(count, n) in stats.interchanges.byLineCount"
                        :key="n"
                        class="stats-tag"
                      >
                        {{ n }}线: {{ count }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div v-show="activeTab === 'paths'" class="stats__section">
                <div class="stats-group" v-if="stats.paths.longestDistance">
                  <h3 class="stats-group__title">最长距离路径</h3>
                  <div class="path-info">
                    <div class="path-info__route">
                      {{ getStationName(stats.paths.longestDistance.fromStationId) }}
                      →
                      {{ getStationName(stats.paths.longestDistance.toStationId) }}
                    </div>
                    <div class="path-info__metrics">
                      <span class="path-metric">
                        <IconBase name="map" :size="12" />
                        {{ formatDistance(stats.paths.longestDistance.metrics.maxDistance) }}
                      </span>
                      <span class="path-metric">
                        <IconBase name="circle" :size="12" />
                        {{ stats.paths.longestDistance.metrics.stationCount }} 站
                      </span>
                      <span class="path-metric">
                        <IconBase name="shuffle" :size="12" />
                        {{ stats.paths.longestDistance.metrics.transferCount }} 次换乘
                      </span>
                    </div>
                  </div>
                </div>

                <div class="stats-group" v-if="stats.paths.maxTransfers">
                  <h3 class="stats-group__title">最多换乘路径</h3>
                  <div class="path-info">
                    <div class="path-info__route">
                      {{ getStationName(stats.paths.maxTransfers.fromStationId) }}
                      →
                      {{ getStationName(stats.paths.maxTransfers.toStationId) }}
                    </div>
                    <div class="path-info__metrics">
                      <span class="path-metric">
                        <IconBase name="shuffle" :size="12" />
                        {{ stats.paths.maxTransfers.metrics.transferCount }} 次换乘
                      </span>
                      <span class="path-metric">
                        <IconBase name="map" :size="12" />
                        {{ formatDistance(stats.paths.maxTransfers.metrics.totalMeters) }}
                      </span>
                      <span class="path-metric">
                        <IconBase name="git-branch" :size="12" />
                        {{ stats.paths.maxTransfers.metrics.uniqueLinesCount }} 条线路
                      </span>
                    </div>
                  </div>
                </div>

                <div class="stats-group" v-if="stats.paths.maxLines">
                  <h3 class="stats-group__title">最多线路路径</h3>
                  <div class="path-info">
                    <div class="path-info__route">
                      {{ getStationName(stats.paths.maxLines.fromStationId) }}
                      →
                      {{ getStationName(stats.paths.maxLines.toStationId) }}
                    </div>
                    <div class="path-info__metrics">
                      <span class="path-metric">
                        <IconBase name="git-branch" :size="12" />
                        {{ stats.paths.maxLines.metrics.uniqueLinesCount }} 条线路
                      </span>
                      <span class="path-metric">
                        <IconBase name="map" :size="12" />
                        {{ formatDistance(stats.paths.maxLines.metrics.totalMeters) }}
                      </span>
                      <span class="path-metric">
                        <IconBase name="shuffle" :size="12" />
                        {{ stats.paths.maxLines.metrics.transferCount }} 次换乘
                      </span>
                    </div>
                  </div>
                </div>

                <div class="stats-group" v-if="stats.paths.maxStations">
                  <h3 class="stats-group__title">最多站点路径</h3>
                  <div class="path-info">
                    <div class="path-info__route">
                      {{ getStationName(stats.paths.maxStations.fromStationId) }}
                      →
                      {{ getStationName(stats.paths.maxStations.toStationId) }}
                    </div>
                    <div class="path-info__metrics">
                      <span class="path-metric">
                        <IconBase name="circle" :size="12" />
                        {{ stats.paths.maxStations.metrics.stationCount }} 站
                      </span>
                      <span class="path-metric">
                        <IconBase name="map" :size="12" />
                        {{ formatDistance(stats.paths.maxStations.metrics.totalMeters) }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div v-show="activeTab === 'interchanges'" class="stats__section">
                <div v-if="stats.interchanges.ranking.length === 0" class="stats-dialog__empty">
                  暂无换乘站
                </div>
                <div v-else class="interchange-list">
                  <div
                    v-for="(item, index) in stats.interchanges.ranking"
                    :key="item.stationId"
                    class="interchange-item"
                  >
                    <div class="interchange-item__rank">{{ index + 1 }}</div>
                    <div class="interchange-item__info">
                      <div class="interchange-item__name">{{ item.stationName }}</div>
                      <div class="interchange-item__lines">{{ formatLineNames(item.lineIds) }}</div>
                    </div>
                    <div class="interchange-item__count">{{ item.lineCount }}线</div>
                  </div>
                </div>
              </div>

              <div v-show="activeTab === 'lines'" class="stats__section">
                <div class="line-table">
                  <div class="line-table__header">
                    <div class="line-table__cell">线路</div>
                    <div class="line-table__cell">站点</div>
                    <div class="line-table__cell">线段</div>
                    <div class="line-table__cell">里程</div>
                    <div class="line-table__cell">类型</div>
                  </div>
                  <div
                    v-for="line in stats.lines"
                    :key="line.lineId"
                    class="line-table__row"
                  >
                    <div class="line-table__cell line-table__cell--name">{{ line.lineName }}</div>
                    <div class="line-table__cell">{{ line.stationCount }}</div>
                    <div class="line-table__cell">{{ line.edgeCount }}</div>
                    <div class="line-table__cell">{{ formatDistance(line.meters) }}</div>
                    <div class="line-table__cell">{{ line.isLoop ? '环线' : '普线' }}</div>
                  </div>
                </div>
              </div>
            </template>
          </div>

          <footer class="stats-dialog__footer">
            <button
              class="stats-dialog__btn stats-dialog__btn--primary"
              type="button"
              @click="doClose"
            >
              关闭
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.stats-overlay {
  position: fixed;
  inset: 0;
  z-index: 9500;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
}

.stats-dialog {
  width: 800px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 64px);
  background: var(--toolbar-card-bg);
  border: 1px solid var(--toolbar-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.stats-dialog__header {
  padding: 16px 20px 0;
  border-bottom: 1px solid var(--toolbar-divider);
}

.stats-dialog__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--toolbar-text);
  line-height: 1.4;
  padding-bottom: 14px;
}

.stats-dialog__tabs {
  display: flex;
  gap: 0;
  padding: 0 20px;
  border-bottom: 1px solid var(--toolbar-divider);
}

.stats-dialog__tab {
  padding: 10px 16px;
  border: none;
  background: transparent;
  color: var(--toolbar-muted);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  border-bottom: 2px solid transparent;
  transition: all var(--transition-normal);
}

.stats-dialog__tab:hover {
  color: var(--toolbar-text);
}

.stats-dialog__tab--active {
  color: var(--toolbar-text);
  border-bottom-color: #2563eb;
}

.stats-dialog__body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.stats-dialog__loading,
.stats-dialog__empty {
  padding: 40px 20px;
  text-align: center;
  color: var(--toolbar-muted);
  font-size: 13px;
}

.stats__section {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
}

.stats-card {
  padding: 16px;
  background: var(--toolbar-input-bg);
  border: 1px solid var(--toolbar-input-border);
  border-radius: 8px;
}

.stats-card__label {
  font-size: 12px;
  color: var(--toolbar-muted);
  margin-bottom: 6px;
}

.stats-card__value {
  font-size: 24px;
  font-weight: 700;
  color: var(--toolbar-text);
  margin-bottom: 4px;
}

.stats-card__sub {
  font-size: 11px;
  color: var(--toolbar-muted);
}

.stats-group {
  padding: 16px;
  background: var(--toolbar-input-bg);
  border: 1px solid var(--toolbar-input-border);
  border-radius: 8px;
}

.stats-group__title {
  margin: 0 0 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--toolbar-text);
}

.stats-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.stats-row__label {
  font-size: 12px;
  color: var(--toolbar-muted);
  min-width: 80px;
}

.stats-row__value {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.stats-tag {
  padding: 3px 8px;
  background: var(--toolbar-button-bg);
  border: 1px solid var(--toolbar-button-border);
  border-radius: 4px;
  font-size: 11px;
  color: var(--toolbar-button-text);
}

.path-info {
  padding: 14px;
  background: var(--toolbar-card-bg);
  border: 1px solid var(--toolbar-divider);
  border-radius: 6px;
}

.path-info__route {
  font-size: 14px;
  font-weight: 600;
  color: var(--toolbar-text);
  margin-bottom: 10px;
  line-height: 1.4;
}

.path-info__metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.path-metric {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--toolbar-muted);
}

.interchange-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.interchange-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: var(--toolbar-input-bg);
  border: 1px solid var(--toolbar-input-border);
  border-radius: 6px;
}

.interchange-item__rank {
  font-size: 20px;
  font-weight: 700;
  color: var(--toolbar-text);
  flex-shrink: 0;
  width: 28px;
  text-align: center;
}

.interchange-item__rank--1 {
  font-size: 24px;
}

.interchange-item__rank--2 {
  font-size: 22px;
}

.interchange-item__rank--3 {
  font-size: 20px;
}

.interchange-item__info {
  flex: 1;
  min-width: 0;
}

.interchange-item__name {
  font-size: 14px;
  font-weight: 600;
  color: var(--toolbar-text);
  margin-bottom: 4px;
}

.interchange-item__lines {
  font-size: 12px;
  color: var(--toolbar-muted);
}

.interchange-item__count {
  padding: 4px 10px;
  background: var(--toolbar-primary-bg, #2563eb);
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  color: white;
}

.line-table {
  border: 1px solid var(--toolbar-divider);
  border-radius: 8px;
  overflow: hidden;
}

.line-table__header {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1.2fr 0.8fr;
  background: var(--toolbar-input-bg);
  border-bottom: 1px solid var(--toolbar-divider);
}

.line-table__cell {
  padding: 10px 12px;
  font-size: 12px;
  color: var(--toolbar-text);
  border-bottom: 1px solid var(--toolbar-divider);
}

.line-table__cell--name {
  font-weight: 600;
}

.line-table__row {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1.2fr 0.8fr;
  background: var(--toolbar-card-bg);
}

.line-table__row:last-child .line-table__cell {
  border-bottom: none;
}

.line-table__row:hover .line-table__cell {
  background: var(--toolbar-button-bg);
}

.stats-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 20px 16px;
  border-top: 1px solid var(--toolbar-divider);
}

.stats-dialog__btn {
  padding: 7px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all var(--transition-normal);
  outline: none;
}

.stats-dialog__btn:focus-visible {
  box-shadow: var(--focus-ring);
}

.stats-dialog__btn--primary {
  background: linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%);
  border-color: var(--toolbar-primary-border);
  color: #fff;
}

.stats-dialog__btn--primary:hover {
  background: linear-gradient(180deg, #3b82f6 0%, #2563eb 100%);
  box-shadow: 0 2px 8px rgba(29, 78, 216, 0.35);
}
</style>
