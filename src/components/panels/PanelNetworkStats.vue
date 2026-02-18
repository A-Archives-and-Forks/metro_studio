<script setup>
import { computed } from 'vue'
import AccordionSection from '../AccordionSection.vue'
import { useProjectStore } from '../../stores/projectStore'
import { getDisplayLineName } from '../../lib/lineNaming'

const store = useProjectStore()

// ── Helpers ──

function resolveEdgeLengthMeters(edge) {
  if (Number.isFinite(edge?.lengthMeters) && edge.lengthMeters > 0) return edge.lengthMeters
  return 0
}

function formatKm(meters) {
  return (meters / 1000).toFixed(1)
}

// ── Line counts by status ──

const lines = computed(() => store.project?.lines || [])
const edges = computed(() => store.project?.edges || [])
const stations = computed(() => store.project?.stations || [])

const edgeByIdMap = computed(() => {
  const map = new Map()
  for (const edge of edges.value) {
    map.set(edge.id, edge)
  }
  return map
})

const totalLines = computed(() => lines.value.length)

const lineCountByStatus = computed(() => {
  let open = 0
  let construction = 0
  let proposed = 0
  for (const line of lines.value) {
    if (line.status === 'open') open++
    else if (line.status === 'construction') construction++
    else if (line.status === 'proposed') proposed++
  }
  return { open, construction, proposed }
})

// ── Station stats ──

/** Unique stations: deduplicate by station id (stations array is already unique by id) */
const totalStations = computed(() => stations.value.length)

function effectiveLines(s) {
  return s.transferLineIds?.length ? s.transferLineIds : s.lineIds
}

/** Interchange stations: stations whose transferLineIds (or lineIds) contain 2+ lines */
const interchangeStations = computed(() => {
  return stations.value.filter((s) => effectiveLines(s).length >= 2)
})

const interchangeCount = computed(() => interchangeStations.value.length)

/** Station with the most lines passing through (including virtual transfers) */
const maxInterchangeStation = computed(() => {
  let best = null
  let bestCount = 0
  for (const station of stations.value) {
    const count = effectiveLines(station).length
    if (count > bestCount) {
      bestCount = count
      best = station
    }
  }
  return best
})

const maxInterchangeLineCount = computed(() => {
  const s = maxInterchangeStation.value
  return s ? effectiveLines(s).length : 0
})

const maxInterchangeLineNames = computed(() => {
  const station = maxInterchangeStation.value
  if (!station) return ''
  const lineMap = store.lineById
  return effectiveLines(station)
    .map((id) => {
      const line = lineMap.get(id)
      return line ? getDisplayLineName(line, 'zh') : null
    })
    .filter(Boolean)
    .join('、')
})

// ── Mileage stats ──

/**
 * Total mileage: sum all unique edges' lengthMeters.
 * Each physical edge is counted once regardless of how many lines share it.
 */
const totalMileageMeters = computed(() => {
  let total = 0
  for (const edge of edges.value) {
    total += resolveEdgeLengthMeters(edge)
  }
  return total
})

/**
 * Mileage per line: sum of edges belonging to each line.
 * Shared edges are counted for each line that uses them (operational mileage perspective).
 */
function computeLineMileageMeters(line) {
  let total = 0
  for (const edgeId of line.edgeIds) {
    const edge = edgeByIdMap.value.get(edgeId)
    if (edge) total += resolveEdgeLengthMeters(edge)
  }
  return total
}

/** Mileage breakdown by line status (edges counted per-line, so shared edges count for each line) */
const mileageByStatus = computed(() => {
  let open = 0
  let construction = 0
  let proposed = 0
  for (const line of lines.value) {
    const m = computeLineMileageMeters(line)
    if (line.status === 'open') open += m
    else if (line.status === 'construction') construction += m
    else if (line.status === 'proposed') proposed += m
  }
  return { open, construction, proposed }
})

// ── Per-line details ──

const lineDetails = computed(() => {
  return lines.value.map((line) => {
    const mileageMeters = computeLineMileageMeters(line)
    // Count unique stations on this line's edges
    const stationIdSet = new Set()
    for (const edgeId of line.edgeIds) {
      const edge = edgeByIdMap.value.get(edgeId)
      if (edge) {
        stationIdSet.add(edge.fromStationId)
        stationIdSet.add(edge.toStationId)
      }
    }
    return {
      id: line.id,
      name: getDisplayLineName(line, 'zh') || line.nameZh || '未命名',
      color: line.color,
      status: line.status,
      stationCount: stationIdSet.size,
      mileageMeters,
      mileageKm: formatKm(mileageMeters),
    }
  }).sort((a, b) => b.mileageMeters - a.mileageMeters)
})

// ── Average inter-station distance ──

const averageInterStationKm = computed(() => {
  const edgeList = edges.value
  if (!edgeList.length) return '0.0'
  let totalMeters = 0
  let count = 0
  for (const edge of edgeList) {
    const len = resolveEdgeLengthMeters(edge)
    if (len > 0) {
      totalMeters += len
      count++
    }
  }
  if (count === 0) return '0.0'
  return (totalMeters / count / 1000).toFixed(1)
})

// ── Longest / shortest line ──

const longestLine = computed(() => {
  if (!lineDetails.value.length) return null
  return lineDetails.value[0] // already sorted descending by mileage
})

const shortestLine = computed(() => {
  if (!lineDetails.value.length) return null
  // Find shortest among lines that actually have edges
  const withEdges = lineDetails.value.filter((l) => l.mileageMeters > 0)
  if (!withEdges.length) return null
  return withEdges[withEdges.length - 1]
})

// ── Status label helper ──

const STATUS_LABELS = { open: '运营', construction: '在建', proposed: '规划' }

function statusLabel(status) {
  return STATUS_LABELS[status] || status
}
</script>

<template>
  <div class="net-stats">
    <!-- 概览 -->
    <AccordionSection title="线网概况">
      <table class="stats-table">
        <tbody>
          <tr>
            <td class="stats-label">线路总数</td>
            <td class="stats-value">
              {{ totalLines }} 条
              <span v-if="totalLines > 0" class="stats-sub">
                （运营 {{ lineCountByStatus.open }}
                <template v-if="lineCountByStatus.construction"> / 在建 {{ lineCountByStatus.construction }}</template>
                <template v-if="lineCountByStatus.proposed"> / 规划 {{ lineCountByStatus.proposed }}</template>）
              </span>
            </td>
          </tr>
          <tr>
            <td class="stats-label">车站总数</td>
            <td class="stats-value">{{ totalStations }} 座</td>
          </tr>
          <tr>
            <td class="stats-label">换乘站</td>
            <td class="stats-value">{{ interchangeCount }} 座</td>
          </tr>
          <tr>
            <td class="stats-label">总里程</td>
            <td class="stats-value">
              {{ formatKm(totalMileageMeters) }} km
            </td>
          </tr>
          <tr v-if="mileageByStatus.open > 0">
            <td class="stats-label stats-label--indent">运营里程</td>
            <td class="stats-value">{{ formatKm(mileageByStatus.open) }} km</td>
          </tr>
          <tr v-if="mileageByStatus.construction > 0">
            <td class="stats-label stats-label--indent">在建里程</td>
            <td class="stats-value">{{ formatKm(mileageByStatus.construction) }} km</td>
          </tr>
          <tr v-if="mileageByStatus.proposed > 0">
            <td class="stats-label stats-label--indent">规划里程</td>
            <td class="stats-value">{{ formatKm(mileageByStatus.proposed) }} km</td>
          </tr>
          <tr>
            <td class="stats-label">平均站间距</td>
            <td class="stats-value">{{ averageInterStationKm }} km</td>
          </tr>
        </tbody>
      </table>

      <!-- 最长/最短/最大换乘 -->
      <div v-if="longestLine || shortestLine || maxInterchangeStation" class="stats-highlights">
        <div class="pp-divider" />
        <div v-if="longestLine" class="stats-highlight-row">
          <span class="stats-label">最长线路</span>
          <span class="stats-value">
            <span class="line-swatch" :style="{ backgroundColor: longestLine.color }" />
            {{ longestLine.name }}（{{ longestLine.mileageKm }} km）
          </span>
        </div>
        <div v-if="shortestLine && shortestLine.id !== longestLine?.id" class="stats-highlight-row">
          <span class="stats-label">最短线路</span>
          <span class="stats-value">
            <span class="line-swatch" :style="{ backgroundColor: shortestLine.color }" />
            {{ shortestLine.name }}（{{ shortestLine.mileageKm }} km）
          </span>
        </div>
        <div v-if="maxInterchangeStation && maxInterchangeLineCount >= 2" class="stats-highlight-row">
          <span class="stats-label">最大换乘站</span>
          <span class="stats-value">
            {{ maxInterchangeStation.nameZh }}（{{ maxInterchangeLineCount }} 线：{{ maxInterchangeLineNames }}）
          </span>
        </div>
      </div>
    </AccordionSection>

    <!-- 各线路排行 -->
    <AccordionSection title="各线路排行" :default-open="false">
      <p v-if="!lineDetails.length" class="pp-hint">暂无线路数据</p>
      <ul v-else class="line-ranking">
        <li v-for="(detail, index) in lineDetails" :key="detail.id" class="line-ranking-item">
          <span class="line-ranking-index">{{ index + 1 }}</span>
          <span class="line-swatch" :style="{ backgroundColor: detail.color }" />
          <span class="line-ranking-name">{{ detail.name }}</span>
          <span class="line-ranking-badge">{{ statusLabel(detail.status) }}</span>
          <span class="line-ranking-stat">{{ detail.stationCount }} 站</span>
          <span class="line-ranking-stat">{{ detail.mileageKm }} km</span>
        </li>
      </ul>
    </AccordionSection>
  </div>
</template>

<style scoped>
.net-stats {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* ── Stats table ── */

.stats-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.stats-table td {
  padding: 3px 0;
  vertical-align: top;
}

.stats-label {
  color: var(--toolbar-muted);
  font-size: 11px;
  white-space: nowrap;
  padding-right: 10px;
  min-width: 68px;
}

.stats-label--indent {
  padding-left: 12px;
}

.stats-value {
  color: var(--toolbar-text);
  font-size: 12px;
}

.stats-sub {
  color: var(--toolbar-hint);
  font-size: 11px;
}

/* ── Highlights ── */

.stats-highlights {
  margin-top: 2px;
}

.stats-highlight-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  font-size: 12px;
}

.stats-highlight-row .stats-label {
  flex-shrink: 0;
}

.stats-highlight-row .stats-value {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* ── Line ranking list ── */

.line-ranking {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 280px;
  overflow-y: auto;
}

.line-ranking-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 6px;
  border: 1px solid var(--toolbar-input-border);
  border-radius: 6px;
  background: var(--toolbar-input-bg);
  font-size: 12px;
  color: var(--toolbar-text);
}

.line-ranking-index {
  color: var(--toolbar-muted);
  font-size: 10px;
  font-weight: 600;
  min-width: 14px;
  text-align: center;
}

.line-ranking-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.line-ranking-badge {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--toolbar-divider);
  color: var(--toolbar-muted);
  flex-shrink: 0;
}

.line-ranking-stat {
  color: var(--toolbar-hint);
  font-size: 11px;
  white-space: nowrap;
  flex-shrink: 0;
}

/* ── Shared swatch ── */

.line-swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex-shrink: 0;
}
</style>
