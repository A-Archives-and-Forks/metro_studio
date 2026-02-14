<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { getDisplayLineName } from '../lib/lineNaming'
import { LINE_STYLE_OPTIONS, normalizeLineStyle } from '../lib/lineStyles'
import { useProjectStore } from '../stores/projectStore'

const store = useProjectStore()
const props = defineProps({
  collapsed: {
    type: Boolean,
    default: false,
  },
})
const emit = defineEmits(['toggle-collapse'])

const THEME_STORAGE_KEY = 'railmap_ui_theme'
const TAB_OPTIONS = [
  { key: 'project', label: '项目与数据' },
  { key: 'workflow', label: '绘制流程' },
  { key: 'object', label: '对象属性' },
  { key: 'publish', label: '发布导出' },
]
const MODE_LABELS = {
  select: '选择/拖拽',
  'add-station': '点站',
  'ai-add-station': 'AI点站',
  'add-edge': '拉线',
  'route-draw': '连续布线',
}

const activeTab = ref('project')
const uiTheme = ref('dark')
const newProjectName = ref('济南地铁图工程')
const projectRenameName = ref('')
const projectFilter = ref('')
const newLineZh = ref('')
const newLineEn = ref('')
const newLineColor = ref('#005BBB')
const newLineStatus = ref('open')
const newLineStyle = ref('solid')
const newLineIsLoop = ref(false)
const fileInputRef = ref(null)
const projectOptions = ref([])
const stationForm = reactive({
  nameZh: '',
  nameEn: '',
})
const stationBatchForm = reactive({
  zhTemplate: '',
  enTemplate: '',
  startIndex: 1,
})
const lineForm = reactive({
  nameZh: '',
  nameEn: '',
  color: '#005BBB',
  status: 'open',
  style: 'solid',
  isLoop: false,
})

const selectedStationCount = computed(() => store.selectedStationIds.length)
const canEditSelectedManualTransfer = computed(() => selectedStationCount.value === 2)
const selectedManualTransferExists = computed(() => {
  if (!canEditSelectedManualTransfer.value) return false
  const [stationAId, stationBId] = store.selectedStationIds
  return store.hasManualTransferBetweenStations(stationAId, stationBId)
})
const exportStationVisibilityMode = computed({
  get: () => store.exportStationVisibilityMode || 'all',
  set: (value) => store.setExportStationVisibilityMode(value),
})
const layoutGeoSeedScale = computed({
  get: () => Number(store.project?.layoutConfig?.geoSeedScale ?? 6),
  set: (value) => store.setLayoutGeoSeedScale(value),
})
const currentProjectId = computed(() => store.project?.id || '')
const filteredProjectOptions = computed(() => {
  const keyword = String(projectFilter.value || '').trim().toLowerCase()
  if (!keyword) return projectOptions.value
  return projectOptions.value.filter((project) => {
    const name = String(project.name || '').toLowerCase()
    const id = String(project.id || '').toLowerCase()
    return name.includes(keyword) || id.includes(keyword)
  })
})

const selectedStation = computed(() => {
  if (!store.project || !store.selectedStationId) return null
  return store.project.stations.find((station) => station.id === store.selectedStationId) || null
})
const activeLine = computed(() => {
  if (!store.project || !store.activeLineId) return null
  return store.project.lines.find((line) => line.id === store.activeLineId) || null
})
const selectedEdge = computed(() => {
  if (!store.project || !store.selectedEdgeId) return null
  return store.project.edges.find((edge) => edge.id === store.selectedEdgeId) || null
})
const selectedEdgeStations = computed(() => {
  if (!selectedEdge.value || !store.project) {
    return { from: null, to: null }
  }
  const stationMap = new Map(store.project.stations.map((station) => [station.id, station]))
  return {
    from: stationMap.get(selectedEdge.value.fromStationId) || null,
    to: stationMap.get(selectedEdge.value.toStationId) || null,
  }
})
const selectedEdgeLines = computed(() => {
  if (!selectedEdge.value || !store.project) return []
  const lineMap = new Map(store.project.lines.map((line) => [line.id, line]))
  return (selectedEdge.value.sharedByLineIds || []).map((lineId) => lineMap.get(lineId)).filter(Boolean)
})
const activeModeLabel = computed(() => MODE_LABELS[store.mode] || store.mode)
const activeObjectLabel = computed(() => {
  if (store.selectedEdgeAnchor) return '锚点'
  if (selectedEdge.value) return '线段'
  if (selectedStationCount.value === 1 && selectedStation.value) return '站点'
  if (selectedStationCount.value > 1) return `多站点（${selectedStationCount.value}）`
  if (activeLine.value) return '线路'
  return '无'
})
const contextSummary = computed(() => {
  if (store.selectedEdgeAnchor) {
    return `锚点 ${store.selectedEdgeAnchor.anchorIndex}（线段 ${store.selectedEdgeAnchor.edgeId}）`
  }
  if (selectedEdge.value) {
    return `线段 ${selectedEdge.value.id}`
  }
  if (selectedStationCount.value === 1 && selectedStation.value) {
    return selectedStation.value.nameZh || selectedStation.value.id
  }
  if (selectedStationCount.value > 1) {
    return `已选 ${selectedStationCount.value} 个站点`
  }
  if (activeLine.value) {
    return `当前线路：${displayLineName(activeLine.value)}`
  }
  return '未选择对象'
})

function applyUiTheme(theme) {
  const nextTheme = theme === 'light' ? 'light' : 'dark'
  uiTheme.value = nextTheme
  document.documentElement.setAttribute('data-ui-theme', nextTheme)
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme)
  } catch {
    // Ignore unavailable localStorage runtime.
  }
}

function restoreUiTheme() {
  try {
    const cachedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
    applyUiTheme(cachedTheme === 'light' ? 'light' : 'dark')
    return
  } catch {
    // Fall through to default theme.
  }
  applyUiTheme('dark')
}

async function refreshProjectOptions() {
  projectOptions.value = await store.listProjects()
}

async function createProject() {
  await store.createNewProject(newProjectName.value.trim() || '新建工程')
  projectRenameName.value = store.project?.name || ''
  await refreshProjectOptions()
}

async function importFromOsm() {
  await store.importJinanNetwork()
  projectRenameName.value = store.project?.name || ''
  await refreshProjectOptions()
}

function addLine() {
  store.addLine({
    nameZh: newLineZh.value,
    nameEn: newLineEn.value,
    color: newLineColor.value,
    status: newLineStatus.value,
    style: newLineStyle.value,
    isLoop: newLineIsLoop.value,
  })
  newLineZh.value = ''
  newLineEn.value = ''
  newLineStatus.value = 'open'
  newLineStyle.value = 'solid'
  newLineIsLoop.value = false
}

function chooseProjectFile() {
  fileInputRef.value?.click()
}

async function onFileSelected(event) {
  const file = event.target.files?.[0]
  if (!file) return
  try {
    await store.importProjectFile(file)
    projectRenameName.value = store.project?.name || ''
    await refreshProjectOptions()
  } catch (error) {
    store.statusText = `加载工程失败: ${error.message || '未知错误'}`
  } finally {
    event.target.value = ''
  }
}

async function onLoadProject(projectId) {
  await store.loadProjectById(projectId)
  projectRenameName.value = store.project?.name || ''
  await refreshProjectOptions()
}

async function renameCurrentProject() {
  if (!store.project) return
  await store.renameCurrentProject(projectRenameName.value || store.project.name)
  projectRenameName.value = store.project?.name || ''
  await refreshProjectOptions()
}

async function duplicateCurrentProject() {
  if (!store.project) return
  await store.duplicateCurrentProject(projectRenameName.value || `${store.project.name} 副本`)
  projectRenameName.value = store.project?.name || ''
  await refreshProjectOptions()
}

async function deleteProject(projectId) {
  const target = projectOptions.value.find((project) => project.id === projectId)
  const targetName = target?.name || projectId
  if (!window.confirm(`确认删除工程「${targetName}」吗？此操作不可撤销。`)) return
  await store.deleteProjectById(projectId)
  projectRenameName.value = store.project?.name || ''
  await refreshProjectOptions()
}

async function deleteCurrentProject() {
  if (!store.project) return
  await deleteProject(store.project.id)
}

async function persistProjectToDb() {
  await store.persistNow()
  await refreshProjectOptions()
}

function applyStationRename() {
  if (!selectedStation.value) return
  store.updateStationName(selectedStation.value.id, {
    nameZh: stationForm.nameZh,
    nameEn: stationForm.nameEn,
  })
}

function applyBatchStationRename() {
  store.renameSelectedStationsByTemplate({
    zhTemplate: stationBatchForm.zhTemplate,
    enTemplate: stationBatchForm.enTemplate,
    startIndex: stationBatchForm.startIndex,
  })
}

function addManualTransferForSelectedStations() {
  store.addManualTransferForSelectedStations()
}

function removeManualTransferForSelectedStations() {
  store.removeManualTransferForSelectedStations()
}

function applyLineChanges() {
  if (!activeLine.value) return
  store.updateLine(activeLine.value.id, {
    nameZh: lineForm.nameZh,
    nameEn: lineForm.nameEn,
    color: lineForm.color,
    status: lineForm.status,
    style: lineForm.style,
    isLoop: lineForm.isLoop,
  })
}

function deleteSelectedStations() {
  store.deleteSelectedStations()
}

function selectAllStations() {
  store.selectAllStations()
}

function deleteSelectedEdge() {
  store.deleteSelectedEdge()
}

function deleteActiveLine() {
  if (!activeLine.value) return
  store.deleteLine(activeLine.value.id)
}

function isCurrentProject(projectId) {
  return currentProjectId.value === projectId
}

function displayLineName(line) {
  return getDisplayLineName(line, 'zh') || line?.nameZh || ''
}

watch(
  selectedStation,
  (station) => {
    stationForm.nameZh = station?.nameZh || ''
    stationForm.nameEn = station?.nameEn || ''
  },
  { immediate: true },
)

watch(
  activeLine,
  (line) => {
    lineForm.nameZh = line?.nameZh || ''
    lineForm.nameEn = line?.nameEn || ''
    lineForm.color = line?.color || '#005BBB'
    lineForm.status = line?.status || 'open'
    lineForm.style = normalizeLineStyle(line?.style)
    lineForm.isLoop = Boolean(line?.isLoop)
  },
  { immediate: true },
)

watch(
  () => store.project?.id,
  () => {
    projectRenameName.value = store.project?.name || ''
  },
  { immediate: true },
)

onMounted(async () => {
  restoreUiTheme()
  await refreshProjectOptions()
  projectRenameName.value = store.project?.name || ''
})
</script>

<template>
  <aside class="toolbar" :class="{ 'toolbar--collapsed': props.collapsed }">
    <section class="toolbar__section toolbar__section--header">
      <div class="toolbar__header-top">
        <div class="toolbar__brand">
          <h1>{{ props.collapsed ? 'RM' : 'RailMap' }}</h1>
          <p v-if="!props.collapsed" class="toolbar__subtitle">济南地铁图生成与编辑</p>
        </div>
        <button
          class="toolbar__collapse-btn"
          type="button"
          :aria-label="props.collapsed ? '展开侧边栏' : '收起侧边栏'"
          :title="props.collapsed ? '展开侧边栏' : '收起侧边栏'"
          @click="emit('toggle-collapse')"
        >
          {{ props.collapsed ? '»' : '«' }}
        </button>
      </div>

      <template v-if="!props.collapsed">
        <div class="toolbar__theme-switch" role="group" aria-label="界面主题">
          <button class="toolbar__theme-btn" :class="{ active: uiTheme === 'light' }" @click="applyUiTheme('light')">日间</button>
          <button class="toolbar__theme-btn" :class="{ active: uiTheme === 'dark' }" @click="applyUiTheme('dark')">夜间</button>
        </div>

        <p class="toolbar__status">{{ store.statusText }}</p>
        <p class="toolbar__hint">当前工程 ID: {{ currentProjectId || '-' }}</p>
      </template>
    </section>

    <nav v-if="!props.collapsed" class="toolbar__tabs" aria-label="侧边栏功能选项卡">
      <button
        v-for="tab in TAB_OPTIONS"
        :key="tab.key"
        class="toolbar__tab"
        :class="{ active: activeTab === tab.key }"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </nav>

    <section v-if="!props.collapsed" class="toolbar__section toolbar__section--context">
      <h3>当前上下文</h3>
      <div class="toolbar__context-grid">
        <p><span>编辑模式</span><strong>{{ activeModeLabel }}</strong></p>
        <p><span>对象类型</span><strong>{{ activeObjectLabel }}</strong></p>
        <p><span>对象摘要</span><strong>{{ contextSummary }}</strong></p>
      </div>
    </section>

    <div v-if="!props.collapsed" class="toolbar__content">
      <template v-if="activeTab === 'project'">
        <section class="toolbar__section">
          <h3>工程管理</h3>
          <p class="toolbar__section-intro">管理工程生命周期与本地版本。</p>

          <label class="toolbar__label">新建工程名</label>
          <input v-model="newProjectName" class="toolbar__input" placeholder="输入新工程名" />
          <div class="toolbar__row">
            <button class="toolbar__btn toolbar__btn--primary" @click="createProject">新建工程</button>
            <button class="toolbar__btn" :disabled="!store.project" @click="duplicateCurrentProject">复制当前</button>
          </div>

          <label class="toolbar__label">当前工程名</label>
          <input v-model="projectRenameName" class="toolbar__input" placeholder="重命名当前工程" />
          <div class="toolbar__row">
            <button class="toolbar__btn" :disabled="!store.project" @click="renameCurrentProject">重命名</button>
            <button class="toolbar__btn toolbar__btn--danger" :disabled="!store.project" @click="deleteCurrentProject">
              删除当前
            </button>
          </div>

          <div class="toolbar__row">
            <button class="toolbar__btn" @click="store.exportProjectFile()">保存文件</button>
            <button class="toolbar__btn" @click="chooseProjectFile">加载文件</button>
          </div>
          <div class="toolbar__row">
            <button class="toolbar__btn" :disabled="!store.project" @click="persistProjectToDb">存入本地库</button>
          </div>
          <input ref="fileInputRef" type="file" accept=".json,.railmap.json" class="hidden" @change="onFileSelected" />

          <div class="toolbar__divider"></div>
          <label class="toolbar__label">本地工程检索</label>
          <input v-model="projectFilter" class="toolbar__input" placeholder="输入工程名或 ID 过滤" />
          <div class="toolbar__row">
            <button class="toolbar__btn toolbar__btn--small" @click="refreshProjectOptions">刷新列表</button>
          </div>
          <ul class="toolbar__project-list">
            <li v-for="project in filteredProjectOptions" :key="project.id">
              <div class="toolbar__project-item" :class="{ active: isCurrentProject(project.id) }">
                <div class="toolbar__project-main">
                  <span>{{ project.name }}</span>
                  <small>{{ new Date(project.meta.updatedAt).toLocaleString() }}</small>
                </div>
                <div class="toolbar__project-actions">
                  <button class="toolbar__btn toolbar__btn--small" @click="onLoadProject(project.id)">加载</button>
                  <button class="toolbar__btn toolbar__btn--small toolbar__btn--danger" @click="deleteProject(project.id)">
                    删除
                  </button>
                </div>
              </div>
            </li>
          </ul>
        </section>

        <section class="toolbar__section">
          <h3>外部数据导入</h3>
          <p class="toolbar__section-intro">控制 OSM 导入范围，并以当前工程为模板新建导入工程（不会覆盖当前工程）。</p>
          <label class="toolbar__checkbox">
            <input v-model="store.includeConstruction" type="checkbox" />
            包含在建线路与车站
          </label>
          <label class="toolbar__checkbox">
            <input v-model="store.includeProposed" type="checkbox" />
            包含规划线路与车站
          </label>
          <button class="toolbar__btn toolbar__btn--primary" :disabled="store.isImporting" @click="importFromOsm">
            {{ store.isImporting ? '导入中...' : '导入济南 OSM 线网' }}
          </button>
        </section>
      </template>

      <template v-else-if="activeTab === 'workflow'">
        <section class="toolbar__section">
          <h3>绘制流程</h3>
          <p class="toolbar__section-intro">先选择编辑模式，再执行选择与排版控制。</p>
          <div class="toolbar__row">
            <button class="toolbar__btn" :class="{ active: store.mode === 'select' }" @click="store.setMode('select')">
              选择/拖拽
            </button>
            <button class="toolbar__btn" :class="{ active: store.mode === 'add-station' }" @click="store.setMode('add-station')">
              点站
            </button>
            <button class="toolbar__btn" :class="{ active: store.mode === 'ai-add-station' }" @click="store.setMode('ai-add-station')">
              AI点站
            </button>
            <button class="toolbar__btn" :class="{ active: store.mode === 'add-edge' }" @click="store.setMode('add-edge')">
              拉线
            </button>
            <button class="toolbar__btn" :class="{ active: store.mode === 'route-draw' }" @click="store.setMode('route-draw')">
              连续布线
            </button>
          </div>
          <p class="toolbar__hint">
            提示: AI点站会抓取 300m 周边 OSM 道路/地域/设施并调用本机 Ollama 给出 5 个候选；连续布线模式下从首点开始，后续每次点击都会继续连线；Esc 可取消待连接起点。
          </p>
          <div class="toolbar__row">
            <span class="toolbar__meta">已选站点: {{ selectedStationCount }}</span>
            <span class="toolbar__meta">已选线段: {{ selectedEdge ? 1 : 0 }}</span>
          </div>
          <div class="toolbar__row">
            <button class="toolbar__btn" @click="selectAllStations">全选站点</button>
            <button class="toolbar__btn" @click="store.clearSelection()">清空选择</button>
          </div>
          <label class="toolbar__label">地理种子缩放（geoSeedScale）</label>
          <div class="toolbar__range-row">
            <input
              v-model.number="layoutGeoSeedScale"
              class="toolbar__range"
              type="range"
              min="0.1"
              max="16"
              step="0.1"
              :disabled="!store.project || store.isLayoutRunning"
            />
            <span class="toolbar__range-value">{{ layoutGeoSeedScale.toFixed(1) }}</span>
          </div>
          <p class="toolbar__hint">值越大，初始地理骨架展开越明显。</p>
          <button
            class="toolbar__btn toolbar__btn--primary"
            :disabled="store.isLayoutRunning || !store.project?.stations?.length"
            @click="store.runAutoLayout()"
          >
            {{ store.isLayoutRunning ? '排版中...' : '自动生成官方风' }}
          </button>
        </section>
      </template>

      <template v-else-if="activeTab === 'object'">
        <section class="toolbar__section">
          <h3>站点属性</h3>
          <p class="toolbar__section-intro">编辑当前选中站点，或对多站点做批量操作。</p>
          <template v-if="selectedStation && selectedStationCount === 1">
            <p class="toolbar__hint">当前站点 ID: {{ selectedStation.id }}</p>
            <input v-model="stationForm.nameZh" class="toolbar__input" placeholder="车站中文名" />
            <input v-model="stationForm.nameEn" class="toolbar__input" placeholder="Station English Name" />
            <div class="toolbar__row">
              <button class="toolbar__btn toolbar__btn--primary" @click="applyStationRename">保存站名</button>
              <button class="toolbar__btn toolbar__btn--danger" @click="deleteSelectedStations">删除选中站点</button>
            </div>
          </template>
          <template v-else-if="selectedStationCount > 1">
            <p class="toolbar__hint">已选 {{ selectedStationCount }} 个站点，可用模板批量重命名（`{n}` 为序号）。</p>
            <input v-model="stationBatchForm.zhTemplate" class="toolbar__input" placeholder="中文模板，例如：站点 {n}" />
            <input
              v-model="stationBatchForm.enTemplate"
              class="toolbar__input"
              placeholder="English template, e.g. Station {n}"
            />
            <label class="toolbar__label">起始序号</label>
            <input v-model.number="stationBatchForm.startIndex" type="number" min="1" class="toolbar__input" />
            <div class="toolbar__row">
              <button class="toolbar__btn toolbar__btn--primary" @click="applyBatchStationRename">批量重命名</button>
              <button class="toolbar__btn toolbar__btn--danger" @click="deleteSelectedStations">删除选中站点</button>
            </div>
            <div class="toolbar__divider"></div>
            <p class="toolbar__hint">
              手动换乘工具：请选择 2 个站点后，可将其视作换乘（不改原线路拓扑）。
            </p>
            <div class="toolbar__row">
              <button
                class="toolbar__btn"
                :disabled="!canEditSelectedManualTransfer || selectedManualTransferExists"
                @click="addManualTransferForSelectedStations"
              >
                设为换乘
              </button>
              <button
                class="toolbar__btn"
                :disabled="!canEditSelectedManualTransfer || !selectedManualTransferExists"
                @click="removeManualTransferForSelectedStations"
              >
                取消换乘
              </button>
            </div>
          </template>
          <p v-else class="toolbar__hint">请先在地图中选择站点</p>
        </section>

        <section class="toolbar__section">
          <h3>线段属性</h3>
          <p class="toolbar__section-intro">查看线段连接关系和所属线路，执行线段级操作。</p>
          <template v-if="selectedEdge">
            <p class="toolbar__hint">线段 ID: {{ selectedEdge.id }}</p>
            <p class="toolbar__hint">
              连接:
              {{ selectedEdgeStations.from?.nameZh || selectedEdge.fromStationId }}
              ↔
              {{ selectedEdgeStations.to?.nameZh || selectedEdge.toStationId }}
            </p>
            <p class="toolbar__hint">所属线路:</p>
            <ul class="toolbar__line-tags">
              <li v-for="line in selectedEdgeLines" :key="line.id" :title="line.nameZh">
                <span class="toolbar__line-swatch" :style="{ backgroundColor: line.color }"></span>
                <span>{{ displayLineName(line) }}</span>
              </li>
            </ul>
            <div class="toolbar__row">
              <button class="toolbar__btn toolbar__btn--danger" @click="deleteSelectedEdge">删除当前线段</button>
            </div>
          </template>
          <p v-else class="toolbar__hint">在真实地图中点击线段可选中并删除。</p>
        </section>

        <section class="toolbar__section">
          <h3>线路属性</h3>
          <p class="toolbar__section-intro">管理线路对象及其状态、线型、颜色与环线标记。</p>
          <input v-model="newLineZh" class="toolbar__input" placeholder="中文线路名" />
          <input v-model="newLineEn" class="toolbar__input" placeholder="English line name" />
          <input v-model="newLineColor" type="color" class="toolbar__color" />
          <div class="toolbar__row">
            <select v-model="newLineStatus" class="toolbar__select">
              <option value="open">运营</option>
              <option value="construction">在建</option>
              <option value="proposed">规划</option>
            </select>
            <select v-model="newLineStyle" class="toolbar__select">
              <option v-for="style in LINE_STYLE_OPTIONS" :key="`new_${style.id}`" :value="style.id">
                {{ style.label }}
              </option>
            </select>
          </div>
          <label class="toolbar__checkbox">
            <input v-model="newLineIsLoop" type="checkbox" />
            环线（不显示从哪到哪）
          </label>
          <button class="toolbar__btn" @click="addLine">新增线路</button>
          <ul class="toolbar__line-list">
            <li v-for="line in store.project?.lines || []" :key="line.id">
              <button class="toolbar__line-item" :class="{ active: store.activeLineId === line.id }" @click="store.setActiveLine(line.id)">
                <span class="toolbar__line-swatch" :style="{ backgroundColor: line.color }"></span>
                <span>{{ displayLineName(line) }}</span>
              </button>
            </li>
          </ul>
          <template v-if="activeLine">
            <div class="toolbar__divider"></div>
            <p class="toolbar__hint">当前线路: {{ displayLineName(activeLine) }}</p>
            <input v-model="lineForm.nameZh" class="toolbar__input" placeholder="中文线路名" />
            <input v-model="lineForm.nameEn" class="toolbar__input" placeholder="English line name" />
            <input v-model="lineForm.color" type="color" class="toolbar__color" />
            <div class="toolbar__row">
              <select v-model="lineForm.status" class="toolbar__select">
                <option value="open">运营</option>
                <option value="construction">在建</option>
                <option value="proposed">规划</option>
              </select>
              <select v-model="lineForm.style" class="toolbar__select">
                <option v-for="style in LINE_STYLE_OPTIONS" :key="`edit_${style.id}`" :value="style.id">
                  {{ style.label }}
                </option>
              </select>
            </div>
            <label class="toolbar__checkbox">
              <input v-model="lineForm.isLoop" type="checkbox" />
              环线（不显示从哪到哪）
            </label>
            <div class="toolbar__row">
              <button class="toolbar__btn toolbar__btn--primary" @click="applyLineChanges">保存线路</button>
              <button class="toolbar__btn toolbar__btn--danger" @click="deleteActiveLine">删除线路</button>
            </div>
          </template>
        </section>
      </template>

      <template v-else>
        <section class="toolbar__section">
          <h3>发布导出</h3>
          <p class="toolbar__section-intro">按目标输出格式导出当前工程成果。</p>
          <label class="toolbar__label">车站显示</label>
          <select v-model="exportStationVisibilityMode" class="toolbar__input">
            <option value="interchange">仅显示换乘站</option>
            <option value="none">隐藏所有车站</option>
            <option value="all">显示所有车站</option>
          </select>
          <div class="toolbar__row">
            <button class="toolbar__btn" @click="store.exportActualRoutePng()">导出实际走向图 PNG</button>
            <button class="toolbar__btn" @click="store.exportOfficialSchematicPng()">导出官方风格图 PNG</button>
          </div>
          <div class="toolbar__row">
            <button class="toolbar__btn" @click="store.exportAllLineHudZip()">导出车辆 HUD 打包</button>
          </div>
        </section>
      </template>
    </div>
    <div v-else class="toolbar__collapsed-body">
      <p class="toolbar__hint">侧栏已收起</p>
      <button class="toolbar__btn toolbar__btn--small" type="button" @click="emit('toggle-collapse')">展开</button>
    </div>
  </aside>
</template>

<style scoped>
.toolbar {
  width: 100%;
  background: var(--toolbar-bg);
  color: var(--toolbar-text);
  overflow: hidden;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-right: 1px solid var(--toolbar-border);
}

.toolbar--collapsed {
  align-items: stretch;
}

.toolbar__header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.toolbar__content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-right: 2px;
}

.toolbar__content::-webkit-scrollbar,
.toolbar__line-list::-webkit-scrollbar,
.toolbar__project-list::-webkit-scrollbar {
  width: 8px;
}

.toolbar__content::-webkit-scrollbar-thumb,
.toolbar__line-list::-webkit-scrollbar-thumb,
.toolbar__project-list::-webkit-scrollbar-thumb {
  background: var(--toolbar-scrollbar-thumb);
  border-radius: 999px;
}

.toolbar__section {
  border: 1px solid var(--toolbar-card-border);
  border-radius: 12px;
  padding: 12px;
  background: var(--toolbar-card-bg);
}

.toolbar__section--header {
  background: var(--toolbar-header-bg);
}

.toolbar__section--context {
  padding: 10px 12px;
}

.toolbar__brand {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.toolbar__collapse-btn {
  border: 1px solid var(--toolbar-input-border);
  color: var(--toolbar-text);
  background: var(--toolbar-input-bg);
  border-radius: 8px;
  width: 30px;
  height: 30px;
  line-height: 1;
  cursor: pointer;
}

.toolbar__section h1 {
  margin: 0;
  font-size: 24px;
  letter-spacing: 0.01em;
}

.toolbar__subtitle {
  margin: 0;
  color: var(--toolbar-muted);
  font-size: 12px;
}

.toolbar__theme-switch {
  margin-top: 10px;
  display: inline-flex;
  border: 1px solid var(--toolbar-input-border);
  border-radius: 9px;
  overflow: hidden;
  width: fit-content;
}

.toolbar__theme-btn {
  border: none;
  color: var(--toolbar-muted);
  background: var(--toolbar-input-bg);
  padding: 6px 12px;
  cursor: pointer;
  font-size: 12px;
}

.toolbar__theme-btn.active {
  background: var(--toolbar-tab-active-bg);
  color: var(--toolbar-tab-active-text);
}

.toolbar__status {
  margin: 10px 0 0;
  color: var(--toolbar-status);
  font-size: 12px;
  line-height: 1.45;
  padding: 8px 10px;
  border: 1px solid var(--toolbar-card-border);
  border-radius: 8px;
  background: var(--toolbar-item-bg);
}

.toolbar__hint {
  margin: 8px 0 0;
  color: var(--toolbar-hint);
  font-size: 12px;
  line-height: 1.45;
}

.toolbar__meta {
  font-size: 12px;
  color: var(--toolbar-muted);
  align-self: center;
}

.toolbar__section h3 {
  margin: 0 0 10px;
  font-size: 14px;
  color: var(--toolbar-text);
}

.toolbar__section-intro {
  margin: -4px 0 10px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--toolbar-muted);
}

.toolbar__tabs {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.toolbar__tab {
  border: 1px solid var(--toolbar-input-border);
  color: var(--toolbar-muted);
  background: var(--toolbar-tab-bg);
  border-radius: 10px;
  padding: 8px 10px;
  cursor: pointer;
  font-size: 12px;
  line-height: 1.3;
  font-weight: 600;
  text-align: center;
}

.toolbar__tab.active {
  background: var(--toolbar-tab-active-bg);
  border-color: var(--toolbar-tab-active-border);
  color: var(--toolbar-tab-active-text);
}

.toolbar__context-grid {
  display: grid;
  gap: 6px;
}

.toolbar__context-grid p {
  margin: 0;
  padding: 6px 8px;
  border: 1px solid var(--toolbar-input-border);
  border-radius: 8px;
  background: var(--toolbar-item-bg);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.toolbar__context-grid span {
  font-size: 11px;
  color: var(--toolbar-muted);
}

.toolbar__context-grid strong {
  min-width: 0;
  text-align: right;
  font-size: 12px;
  color: var(--toolbar-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toolbar__input {
  width: 100%;
  background: var(--toolbar-input-bg);
  border: 1px solid var(--toolbar-input-border);
  color: var(--toolbar-input-text);
  border-radius: 8px;
  padding: 8px 10px;
  margin-bottom: 8px;
}

.toolbar__label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--toolbar-hint);
}

.toolbar__range-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 2px;
}

.toolbar__range {
  width: 100%;
}

.toolbar__range-value {
  min-width: 34px;
  text-align: right;
  font-size: 12px;
  color: var(--toolbar-text);
}

.toolbar__row {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.toolbar__btn {
  border: 1px solid var(--toolbar-button-border);
  color: var(--toolbar-button-text);
  background: var(--toolbar-button-bg);
  border-radius: 8px;
  padding: 8px 10px;
  cursor: pointer;
  font-size: 12px;
  min-width: 0;
  flex: 1 1 120px;
}

.toolbar__btn:hover {
  border-color: var(--toolbar-button-hover-border);
}

.toolbar__btn:disabled {
  opacity: 0.48;
  cursor: not-allowed;
}

.toolbar__btn--primary {
  background: var(--toolbar-primary-bg);
  border-color: var(--toolbar-primary-border);
}

.toolbar__btn--danger {
  background: var(--toolbar-danger-bg);
  border-color: var(--toolbar-danger-border);
}

.toolbar__btn.active {
  background: var(--toolbar-active-bg);
  border-color: var(--toolbar-active-border);
}

.toolbar__btn--small {
  padding: 5px 8px;
  font-size: 11px;
  flex: 0 0 auto;
}

.toolbar__checkbox {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--toolbar-text);
}

.toolbar__color {
  width: 100%;
  height: 34px;
  border-radius: 8px;
  border: 1px solid var(--toolbar-input-border);
  margin-bottom: 8px;
}

.toolbar__select {
  width: 100%;
  background: var(--toolbar-input-bg);
  border: 1px solid var(--toolbar-input-border);
  color: var(--toolbar-input-text);
  border-radius: 8px;
  padding: 8px 10px;
}

.toolbar__divider {
  height: 1px;
  margin: 10px 0;
  background: var(--toolbar-divider);
}

.toolbar__line-list,
.toolbar__project-list {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 220px;
  overflow: auto;
}

.toolbar__line-tags {
  margin: 0 0 8px;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.toolbar__line-tags li {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--toolbar-muted);
  font-size: 12px;
}

.toolbar__line-item,
.toolbar__project-item {
  width: 100%;
  border: 1px solid var(--toolbar-input-border);
  border-radius: 8px;
  background: var(--toolbar-item-bg);
  color: var(--toolbar-text);
  padding: 8px;
  text-align: left;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  justify-content: space-between;
}

.toolbar__line-item.active,
.toolbar__project-item.active {
  border-color: var(--toolbar-active-border);
}

.toolbar__line-item {
  cursor: pointer;
  align-items: center;
}

.toolbar__line-swatch {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  flex-shrink: 0;
}

.toolbar__project-item {
  padding: 8px 9px;
}

.toolbar__project-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.toolbar__project-main span {
  word-break: break-word;
}

.toolbar__project-actions {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-shrink: 0;
}

.toolbar__project-item small {
  color: var(--toolbar-muted);
}

.hidden {
  display: none;
}

.toolbar__collapsed-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

@media (max-width: 1060px) {
  .toolbar {
    padding: 12px;
  }
}
</style>
