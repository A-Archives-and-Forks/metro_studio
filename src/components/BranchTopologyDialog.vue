<script setup>
import { computed, ref, watch } from 'vue'
import { NModal, NSelect } from 'naive-ui'
import { useProjectStore } from '../stores/projectStore'
import { analyzeLineBranchTopology } from '../lib/schematic/branchTopology'
import { serializeLineBranchTopologyXml } from '../lib/schematic/branchTopologyXml'
import { serializeRmgConfigJson } from '../lib/schematic/branchTopologyRmg'
import { getDisplayLineName } from '../lib/lineNaming'
import IconBase from './IconBase.vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])

const store = useProjectStore()

// ── State ──

const selectedLineId = ref(null)
const copied = ref(false)
let copyTimeout = null

// ── Derived data ──

const lineOptions = computed(() =>
  (store.project?.lines || []).map((line) => ({
    label: getDisplayLineName(line, 'zh') || line.nameZh || line.id,
    value: line.id,
  })),
)

const analysisResults = computed(() => {
  if (!selectedLineId.value || !store.project) return []
  return analyzeLineBranchTopology(store.project, selectedLineId.value)
})

const xmlOutput = computed(() => {
  if (!selectedLineId.value || !store.project) return ''
  return serializeLineBranchTopologyXml(store.project, selectedLineId.value)
})

const rmgOutput = computed(() => {
  if (!selectedLineId.value || !store.project) return ''
  return serializeRmgConfigJson(store.project, selectedLineId.value) || ''
})

const allValid = computed(() => analysisResults.value.length > 0 && analysisResults.value.every((r) => r.valid))

// ── Init: auto-select first line when dialog opens ──

watch(
  () => props.visible,
  (v) => {
    if (v && !selectedLineId.value) {
      selectedLineId.value = store.project?.lines?.[0]?.id ?? null
    }
    if (!v) {
      copied.value = false
      clearTimeout(copyTimeout)
    }
  },
)

// ── Actions ──

function doClose() {
  emit('close')
}

function copyXml() {
  if (!xmlOutput.value) return
  navigator.clipboard.writeText(xmlOutput.value).then(() => {
    copied.value = true
    clearTimeout(copyTimeout)
    copyTimeout = setTimeout(() => { copied.value = false }, 2000)
  })
}

function downloadXml() {
  if (!xmlOutput.value) return
  const line = (store.project?.lines || []).find((l) => l.id === selectedLineId.value)
  const lineName = line ? (getDisplayLineName(line, 'zh') || line.nameZh || line.id) : 'line'
  const projectName = store.project?.name || 'project'
  const filename = `${projectName}_${lineName}_branch-topology.xml`
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '-')

  const blob = new Blob([xmlOutput.value], { type: 'application/xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function downloadRmg() {
  if (!rmgOutput.value) return
  const line = (store.project?.lines || []).find((l) => l.id === selectedLineId.value)
  const lineName = line ? (getDisplayLineName(line, 'zh') || line.nameZh || line.id) : 'line'
  const projectName = store.project?.name || 'project'
  const filename = `RMG_${projectName}_${lineName}.json`
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '-')

  const blob = new Blob([rmgOutput.value], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── Helpers ──

function resultStatusIcon(result) {
  return result.valid ? 'check-circle' : 'alert-triangle'
}

function trunkSummary(result) {
  if (result.isLoop) {
    const n = result.trunkStationIds?.length ?? 0
    return n ? `环线 ${n} 站` : '–'
  }
  const n = result.trunkStationIds?.length ?? 0
  return n ? `主干 ${n} 站` : '–'
}

function branchSummary(result) {
  const parts = []
  const leftIv = result.intervals?.find((iv) => iv.fromIndex === -1)
  const rightIv = result.intervals?.find((iv) => !isFinite(iv.toIndex))
  const closedIntervals = result.intervals?.filter((iv) => iv.fromIndex >= 0 && isFinite(iv.toIndex)) || []
  if (leftIv) parts.push(`岔入支线 ${leftIv.stationIds.length} 站`)
  if (rightIv) parts.push(`岔出支线 ${rightIv.stationIds.length} 站`)
  if (closedIntervals.length) parts.push(`${closedIntervals.length} 条区间支线`)
  return parts.join('、') || '无支线'
}

function stationName(id) {
  return store.stationById?.get(id)?.nameZh || id
}
</script>

<template>
  <NModal
    :show="visible"
    :mask-closable="true"
    :closable="true"
    preset="card"
    title="线路拓扑分析 & XML 导出"
    style="width: 860px; max-width: 96vw"
    @update:show="(v) => !v && doClose()"
  >
    <div class="btd">
      <!-- Line selector -->
      <div class="btd__row btd__row--select">
        <label class="btd__label">选择线路</label>
        <NSelect
          v-model:value="selectedLineId"
          :options="lineOptions"
          placeholder="请选择线路"
          style="flex: 1; max-width: 320px"
          size="small"
        />
        <span v-if="analysisResults.length" class="btd__tag" :class="allValid ? 'btd__tag--ok' : 'btd__tag--err'">
          <IconBase :name="allValid ? 'check-circle' : 'alert-triangle'" size="13" />
          {{ allValid ? '结构合法' : '结构无效' }}
        </span>
      </div>

      <!-- Per-component summary cards -->
      <div v-if="analysisResults.length" class="btd__cards">
        <div
          v-for="result in analysisResults"
          :key="result.componentIndex"
          class="btd__card"
          :class="result.valid ? 'btd__card--ok' : 'btd__card--err'"
        >
          <div class="btd__card-head">
            <IconBase :name="resultStatusIcon(result)" size="14" />
            <span>联通分量 #{{ result.componentIndex + 1 }}</span>
          </div>
          <template v-if="result.valid">
            <div v-if="result.isLoop" class="btd__card-row">
              <span class="btd__card-key">环线</span>
              <span class="btd__card-val">
                {{ trunkSummary(result) }}
              </span>
            </div>
            <template v-else>
              <div class="btd__card-row">
                <span class="btd__card-key">主干</span>
                <span class="btd__card-val">
                  {{ stationName(result.trunkStationIds[0]) }}
                  →
                  {{ stationName(result.trunkStationIds[result.trunkStationIds.length - 1]) }}
                  （{{ trunkSummary(result) }}）
                </span>
              </div>
              <div class="btd__card-row">
                <span class="btd__card-key">支线</span>
                <span class="btd__card-val">{{ branchSummary(result) }}</span>
              </div>
              <div v-if="result.intervals?.length" class="btd__intervals">
                <div
                  v-for="(iv, i) in result.intervals"
                  :key="i"
                  class="btd__interval"
                >
                  <IconBase name="git-branch" size="12" />
                  {{ stationName(iv.fromStationId) }} → {{ stationName(iv.toStationId) }}
                  （{{ iv.stationIds.length }} 站）
                </div>
              </div>
            </template>
          </template>
          <template v-else>
            <div class="btd__card-err-msg">
              <IconBase name="info" size="13" />
              {{ result.reason }}
            </div>
          </template>
        </div>
      </div>

      <div v-else-if="selectedLineId" class="btd__empty">
        <IconBase name="loader" size="18" />
        分析中…
      </div>

      <!-- XML preview -->
      <div v-if="selectedLineId" class="btd__xml-wrap">
        <div class="btd__xml-toolbar">
          <span class="btd__xml-title">XML 预览</span>
          <div class="btd__xml-actions">
            <button class="btd__btn" @click="copyXml">
              <IconBase :name="copied ? 'check' : 'copy'" size="13" />
              {{ copied ? '已复制' : '复制' }}
            </button>
            <button class="btd__btn btd__btn--primary" @click="downloadXml">
              <IconBase name="download" size="13" />
              下载 XML
            </button>
            <button class="btd__btn btd__btn--rmg" :disabled="!rmgOutput" @click="downloadRmg">
              <IconBase name="download" size="13" />
              下载 RMG 配置
            </button>
          </div>
        </div>
        <pre class="btd__xml-pre">{{ xmlOutput }}</pre>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.btd {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 200px;
}

.btd__row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.btd__label {
  font-size: 13px;
  color: var(--color-text-muted, #888);
  white-space: nowrap;
}

.btd__tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 500;
}
.btd__tag--ok  { background: #ecfdf5; color: #15803d; }
.btd__tag--err { background: #fef2f2; color: #b91c1c; }

:root[data-ui-theme="dark"] .btd__tag--ok  { background: #052e16; color: #4ade80; }
:root[data-ui-theme="dark"] .btd__tag--err { background: #450a0a; color: #f87171; }

/* Cards */
.btd__cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.btd__card {
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 13px;
  border: 1px solid transparent;
}
.btd__card--ok  { background: var(--color-surface-1, #f8fafc); border-color: #d1fae5; }
.btd__card--err { background: var(--color-surface-1, #f8fafc); border-color: #fecaca; }

:root[data-ui-theme="dark"] .btd__card--ok  { background: #0d1f17; border-color: #14532d; }
:root[data-ui-theme="dark"] .btd__card--err { background: #1f0d0d; border-color: #7f1d1d; }

.btd__card-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  margin-bottom: 6px;
  color: var(--color-text, #222);
}
.btd__card--ok  .btd__card-head { color: #15803d; }
.btd__card--err .btd__card-head { color: #b91c1c; }

:root[data-ui-theme="dark"] .btd__card--ok  .btd__card-head { color: #4ade80; }
:root[data-ui-theme="dark"] .btd__card--err .btd__card-head { color: #f87171; }

.btd__card-row {
  display: flex;
  gap: 8px;
  margin-bottom: 3px;
}
.btd__card-key {
  color: var(--color-text-muted, #888);
  min-width: 32px;
}
.btd__card-val {
  color: var(--color-text, #222);
  flex: 1;
}

:root[data-ui-theme="dark"] .btd__card-key { color: #94a3b8; }
:root[data-ui-theme="dark"] .btd__card-val { color: #e2e8f0; }

.btd__intervals {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.btd__interval {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: var(--color-surface-2, #f1f5f9);
  border-radius: 6px;
  font-size: 12px;
  color: var(--color-text-muted, #666);
}
:root[data-ui-theme="dark"] .btd__interval { background: #1e293b; color: #94a3b8; }

.btd__card-err-msg {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  color: var(--color-text, #555);
  font-size: 12.5px;
  line-height: 1.5;
}

.btd__empty {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-muted, #888);
  font-size: 13px;
  padding: 16px 0;
}

/* XML section */
.btd__xml-wrap {
  display: flex;
  flex-direction: column;
  gap: 0;
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 8px;
  overflow: hidden;
}
:root[data-ui-theme="dark"] .btd__xml-wrap { border-color: #334155; }

.btd__xml-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: var(--color-surface-1, #f8fafc);
  border-bottom: 1px solid var(--color-border, #e2e8f0);
}
:root[data-ui-theme="dark"] .btd__xml-toolbar { background: #0f172a; border-color: #334155; }

.btd__xml-title {
  font-size: 12px;
  color: var(--color-text-muted, #888);
  font-weight: 500;
  letter-spacing: 0.02em;
}

.btd__xml-actions {
  display: flex;
  gap: 6px;
}

.btd__btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 5px;
  background: var(--color-surface-2, #fff);
  color: var(--color-text, #333);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.btd__btn:hover { background: var(--color-surface-3, #f1f5f9); border-color: #94a3b8; }

.btd__btn--primary {
  background: #3b82f6;
  border-color: #2563eb;
  color: #fff;
}
.btd__btn--primary:hover { background: #2563eb; border-color: #1d4ed8; }

.btd__btn--rmg {
  background: #8b5cf6;
  border-color: #7c3aed;
  color: #fff;
}
.btd__btn--rmg:hover { background: #7c3aed; border-color: #6d28d9; }
.btd__btn--rmg:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

:root[data-ui-theme="dark"] .btd__btn {
  background: #1e293b;
  border-color: #334155;
  color: #e2e8f0;
}
:root[data-ui-theme="dark"] .btd__btn:hover { background: #334155; }

.btd__xml-pre {
  margin: 0;
  padding: 12px 14px;
  font-family: 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
  font-size: 11.5px;
  line-height: 1.6;
  overflow: auto;
  max-height: 320px;
  background: var(--color-surface-0, #fff);
  color: var(--color-text, #1e293b);
  white-space: pre;
  tab-size: 2;
}
:root[data-ui-theme="dark"] .btd__xml-pre { background: #020817; color: #94a3b8; }
</style>
