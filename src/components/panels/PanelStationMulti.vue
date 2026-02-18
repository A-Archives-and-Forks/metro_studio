<script setup>
import { computed, reactive } from 'vue'
import AccordionSection from '../AccordionSection.vue'
import TooltipWrapper from '../TooltipWrapper.vue'
import { useProjectStore } from '../../stores/projectStore'
import { useAiAutoBatchNaming } from '../../composables/useAiAutoBatchNaming'
import { useDialog } from '../../composables/useDialog'

const store = useProjectStore()
const { confirm } = useDialog()

const aiAutoBatch = useAiAutoBatchNaming()

const isNewStation = (s) => s.nameZh?.startsWith('新站 ')

const selectedStationCount = computed(() => store.selectedStationIds.length)

const selectedStationsInOrder = computed(() => {
  if (!store.project) return []
  const stationMap = new Map(store.project.stations.map((s) => [s.id, s]))
  return (store.selectedStationIds || []).map((id) => stationMap.get(id)).filter(Boolean)
})

const stationBatchForm = reactive({
  zhTemplate: '',
  enTemplate: '',
  startIndex: 1,
})

const stationEnglishRetranslateProgress = computed(() => store.stationEnglishRetranslateProgress || {
  done: 0,
  total: 0,
  percent: 0,
  message: '',
})

const canEditSelectedManualTransfer = computed(() => selectedStationCount.value === 2)

const selectedManualTransferExists = computed(() => {
  if (!canEditSelectedManualTransfer.value) return false
  const [stationAId, stationBId] = store.selectedStationIds
  return store.hasManualTransferBetweenStations(stationAId, stationBId)
})

function applyBatchStationRename() {
  store.renameSelectedStationsByTemplate({
    zhTemplate: stationBatchForm.zhTemplate,
    enTemplate: stationBatchForm.enTemplate,
    startIndex: stationBatchForm.startIndex,
  })
}

async function startAiAutoBatchNaming() {
  const selected = selectedStationsInOrder.value
  if (!selected.length) return
  const newStations = selected.filter(isNewStation)
  const namedStations = selected.filter((s) => !isNewStation(s))
  if (!newStations.length && !namedStations.length) return
  let targets = newStations
  if (namedStations.length) {
    const ok = await confirm({
      title: '覆盖已有站名',
      message: `选中的 ${selected.length} 个站中有 ${namedStations.length} 个已命名站点，是否也重新命名？`,
      confirmText: '全部命名',
      cancelText: '仅命名新站',
    })
    if (ok) targets = selected
  }
  if (!targets.length) return
  aiAutoBatch.start(targets)
}

function translateNonNewStations() {
  const ids = selectedStationsInOrder.value.filter((s) => !isNewStation(s)).map((s) => s.id)
  if (!ids.length) return
  store.retranslateStationEnglishNamesByIdsWithAi(ids)
}
</script>

<template>
  <div class="panel-station-multi">
    <p class="pp-hint">已选 {{ selectedStationCount }} 个站点</p>

    <AccordionSection title="AI 批量命名">
      <div class="pp-row">
        <TooltipWrapper text="AI自动生成并写回全部站名" placement="bottom">
          <button
            class="pp-btn pp-btn--primary"
            :disabled="store.isStationEnglishRetranslating || aiAutoBatch.state.active"
            @click="startAiAutoBatchNaming"
          >
            全自动命名
          </button>
        </TooltipWrapper>
      </div>

      <!-- AI 全自动批量命名进度 -->
      <div v-if="aiAutoBatch.state.active" class="pp-progress">
        <div class="pp-progress-head">
          <span>AI全自动命名 {{ aiAutoBatch.state.doneCount }}/{{ aiAutoBatch.total.value }}</span>
          <strong>{{ aiAutoBatch.percent.value }}%</strong>
        </div>
        <div class="pp-progress-track">
          <div class="pp-progress-fill" :style="{ width: `${aiAutoBatch.percent.value}%` }" />
        </div>
        <p class="pp-hint">
          成功 {{ aiAutoBatch.state.successCount }}，失败 {{ aiAutoBatch.state.failedCount }}，已应用 {{ aiAutoBatch.state.appliedCount }}
        </p>
        <p v-if="aiAutoBatch.state.running" class="pp-hint">正在自动生成并写回站名...</p>
        <p v-if="aiAutoBatch.state.error" class="pp-hint">{{ aiAutoBatch.state.error }}</p>
        <div v-if="!aiAutoBatch.state.running && aiAutoBatch.state.failedItems.length" class="pp-hint">
          失败示例：
          <span v-for="(item, idx) in aiAutoBatch.state.failedItems.slice(0, 3)" :key="`${item.stationId}_${idx}`">
            {{ idx === 0 ? '' : '；' }}{{ item.stationName }}（{{ item.message }}）
          </span>
        </div>
        <div class="pp-row">
          <TooltipWrapper text="仅重试失败项" placement="bottom">
            <button
              class="pp-btn"
              :disabled="aiAutoBatch.state.running || !aiAutoBatch.state.failedStationIds.length"
              @click="aiAutoBatch.retryFailed"
            >
              仅重试失败
            </button>
          </TooltipWrapper>
          <TooltipWrapper :text="aiAutoBatch.state.running ? '取消自动命名' : '关闭面板'" placement="bottom">
            <button class="pp-btn pp-btn--danger" @click="aiAutoBatch.cancel">
              {{ aiAutoBatch.state.running ? '取消' : '关闭' }}
            </button>
          </TooltipWrapper>
        </div>
      </div>
    </AccordionSection>

    <AccordionSection title="英文翻译">
      <TooltipWrapper text="AI翻译选中站英文名" placement="bottom">
        <button
          class="pp-btn"
          :disabled="!selectedStationCount || store.isStationEnglishRetranslating"
          @click="translateNonNewStations"
        >
          {{ store.isStationEnglishRetranslating ? '翻译中...' : 'AI翻译选中站英文' }}
        </button>
      </TooltipWrapper>
      <div v-if="stationEnglishRetranslateProgress.total > 0" class="pp-progress">
        <div class="pp-progress-head">
          <span>{{ stationEnglishRetranslateProgress.message || '处理中...' }}</span>
          <strong>{{ Math.round(stationEnglishRetranslateProgress.percent || 0) }}%</strong>
        </div>
        <div class="pp-progress-track">
          <div
            class="pp-progress-fill"
            :style="{ width: `${Math.max(0, Math.min(100, stationEnglishRetranslateProgress.percent || 0))}%` }"
          />
        </div>
        <p class="pp-hint">{{ stationEnglishRetranslateProgress.done || 0 }} / {{ stationEnglishRetranslateProgress.total || 0 }}</p>
      </div>
    </AccordionSection>

    <AccordionSection title="批量重命名">
      <p class="pp-hint">使用模板批量重命名（`{n}` 为序号）。</p>
      <input v-model="stationBatchForm.zhTemplate" class="pp-input" placeholder="中文模板，例如：站点 {n}" />
      <input v-model="stationBatchForm.enTemplate" class="pp-input" placeholder="English template, e.g. Station {n}" />
      <label class="pp-label">起始序号</label>
      <input v-model.number="stationBatchForm.startIndex" type="number" min="1" class="pp-input" />
      <div class="pp-row">
        <TooltipWrapper text="按模板批量重命名" placement="bottom">
          <button class="pp-btn pp-btn--primary" @click="applyBatchStationRename">批量重命名</button>
        </TooltipWrapper>
        <TooltipWrapper text="删除选中站点" placement="bottom">
          <button class="pp-btn pp-btn--danger" @click="store.deleteSelectedStations()">删除选中站点</button>
        </TooltipWrapper>
      </div>
    </AccordionSection>

    <AccordionSection title="换乘工具" :default-open="false">
      <p class="pp-hint">选择 2 个站点后，可将其视作换乘（不改原线路拓扑）。</p>
      <div class="pp-row">
        <TooltipWrapper text="将选中两站设为换乘" placement="bottom">
          <button
            class="pp-btn"
            :disabled="!canEditSelectedManualTransfer || selectedManualTransferExists"
            @click="store.addManualTransferForSelectedStations()"
          >
            设为换乘
          </button>
        </TooltipWrapper>
        <TooltipWrapper text="取消选中两站的换乘" placement="bottom">
          <button
            class="pp-btn"
            :disabled="!canEditSelectedManualTransfer || !selectedManualTransferExists"
            @click="store.removeManualTransferForSelectedStations()"
          >
            取消换乘
          </button>
        </TooltipWrapper>
      </div>
    </AccordionSection>
  </div>
</template>

<style scoped>
.panel-station-multi {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
