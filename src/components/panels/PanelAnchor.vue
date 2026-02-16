<script setup>
import { computed } from 'vue'
import { useProjectStore } from '../../stores/projectStore'
import { getDisplayLineName } from '../../lib/lineNaming'
import TooltipWrapper from '../TooltipWrapper.vue'

const store = useProjectStore()

const anchor = computed(() => store.selectedEdgeAnchor)

const selectedEdge = computed(() => {
  if (!anchor.value || !store.project) return null
  return store.project.edges.find((e) => e.id === anchor.value.edgeId) || null
})

const edgeStations = computed(() => {
  if (!selectedEdge.value || !store.project) return { from: null, to: null }
  const stationMap = new Map(store.project.stations.map((s) => [s.id, s]))
  return {
    from: stationMap.get(selectedEdge.value.fromStationId) || null,
    to: stationMap.get(selectedEdge.value.toStationId) || null,
  }
})

const edgeLines = computed(() => {
  if (!selectedEdge.value || !store.project) return []
  const lineMap = new Map(store.project.lines.map((l) => [l.id, l]))
  return (selectedEdge.value.sharedByLineIds || []).map((lineId) => lineMap.get(lineId)).filter(Boolean)
})

const totalAnchors = computed(() => {
  if (!selectedEdge.value) return 0
  const waypoints = store.resolveEditableEdgeWaypoints(selectedEdge.value)
  if (!waypoints || waypoints.length < 3) return 0
  return waypoints.length - 2
})

function displayLineName(line) {
  return getDisplayLineName(line, 'zh') || line?.nameZh || ''
}

function deleteAnchor() {
  if (!anchor.value) return
  store.removeSelectedEdgeAnchor()
}
</script>

<template>
  <div class="panel-anchor" v-if="anchor && selectedEdge">
    <p class="pp-hint">锚点索引: {{ anchor.anchorIndex }}</p>
    <p class="pp-hint">
      连接站点:
      {{ edgeStations.from?.nameZh || selectedEdge.fromStationId }}
      ↔
      {{ edgeStations.to?.nameZh || selectedEdge.toStationId }}
    </p>

    <div class="pp-divider" />

    <label v-if="edgeLines.length" class="pp-label">所属线路</label>
    <ul v-if="edgeLines.length" class="edge-line-tags">
      <li v-for="line in edgeLines" :key="line.id" :title="line.nameZh">
        <span class="edge-line-swatch" :style="{ backgroundColor: line.color }" />
        <span>{{ displayLineName(line) }}</span>
      </li>
    </ul>
    <p v-else class="pp-hint">所属线路: 无</p>

    <label class="pp-label">锚点位置</label>
    <p class="pp-hint">
      第 {{ anchor.anchorIndex }} / {{ totalAnchors }} 个锚点
    </p>

    <div class="pp-divider" />

    <div class="pp-row">
      <TooltipWrapper text="删除锚点" placement="bottom">
        <button class="pp-btn pp-btn--danger" @click="deleteAnchor">删除锚点</button>
      </TooltipWrapper>
    </div>
  </div>
</template>

<style scoped>
.panel-anchor {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.edge-line-tags {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.edge-line-tags li {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: 1px solid var(--toolbar-input-border);
  border-radius: 4px;
  background: var(--toolbar-input-bg);
  font-size: 11px;
  color: var(--toolbar-text);
}

.edge-line-swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex-shrink: 0;
}
</style>
