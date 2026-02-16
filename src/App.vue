<script setup>
import { nextTick, onBeforeUnmount, onMounted, provide, ref } from 'vue'
import { useAutoAnimate } from '@formkit/auto-animate/vue'
import IconSprite from './components/IconSprite.vue'
import MenuBar from './components/MenuBar.vue'
import ToolStrip from './components/ToolStrip.vue'
import PropertiesPanel from './components/PropertiesPanel.vue'
import LayoutControlsPanel from './components/LayoutControlsPanel.vue'
import MapEditor from './components/MapEditor.vue'
import SchematicView from './components/SchematicView.vue'
import VehicleHudView from './components/VehicleHudView.vue'
import TimelinePreviewView from './components/TimelinePreviewView.vue'
import ErrorBoundary from './components/ErrorBoundary.vue'
import StatusBar from './components/StatusBar.vue'
import ProjectListDialog from './components/ProjectListDialog.vue'
import ToastContainer from './components/ToastContainer.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import PromptDialog from './components/PromptDialog.vue'
import ProgressBar from './components/ProgressBar.vue'
import AiConfigDialog from './components/AiConfigDialog.vue'
import ShortcutSettingsDialog from './components/ShortcutSettingsDialog.vue'
import StatisticsDialog from './components/StatisticsDialog.vue'
import { useProjectStore } from './stores/projectStore'
import { useAutoSave } from './composables/useAutoSave'
import { useDialog } from './composables/useDialog.js'
import { useAnimationSettings } from './composables/useAnimationSettings.js'
import { useShortcuts } from './composables/useShortcuts.js'

const store = useProjectStore()
const { saveState, lastSavedAt, saveNow } = useAutoSave()
const { confirm, prompt } = useDialog()
const { enabled, getAutoAnimateConfig } = useAnimationSettings()

provide('autoSaveSaveState', saveState)
provide('autoSaveLastSavedAt', lastSavedAt)
provide('autoSaveSaveNow', saveNow)

const stationRenameTrigger = ref(0)
provide('stationRenameTrigger', stationRenameTrigger)

// ── Escape callback registry ──
// MapEditor (and other components) can register callbacks to handle Escape
// in their own context (e.g. close context menu, close AI menu).
const escapeCallbacks = new Set()
provide('registerEscapeCallback', (cb) => escapeCallbacks.add(cb))
provide('unregisterEscapeCallback', (cb) => escapeCallbacks.delete(cb))

const WORKSPACE_VIEW_STORAGE_KEY = 'metro_studio_workspace_active_view'
const activeView = ref('map')
const projectListVisible = ref(false)
const aiConfigVisible = ref(false)
const shortcutSettingsVisible = ref(false)
const statisticsVisible = ref(false)
const globalFileInputRef = ref(null)
const canvasContainer = ref(null)
const viewChanging = ref(false)
const viewChangeProgress = ref(0)

useAutoAnimate(canvasContainer, getAutoAnimateConfig())

function handleBeforeUnload(event) {
  event.preventDefault()
  event.returnValue = ''
}

function loadWorkspaceViewState() {
  try {
    const saved = window.localStorage.getItem(WORKSPACE_VIEW_STORAGE_KEY)
    if (saved && ['map', 'schematic', 'hud', 'preview'].includes(saved)) {
      activeView.value = saved
    }
  } catch {
    activeView.value = 'map'
  }
}

async function setActiveView(viewKey) {
  if (!['map', 'schematic', 'hud', 'preview'].includes(viewKey)) return

  viewChanging.value = true
  viewChangeProgress.value = 0

  const progressInterval = setInterval(() => {
    if (viewChangeProgress.value < 90) {
      viewChangeProgress.value += 30
    }
  }, 50)

  activeView.value = viewKey
  try {
    window.localStorage.setItem(WORKSPACE_VIEW_STORAGE_KEY, viewKey)
  } catch { /* noop */ }

  await nextTick()

  clearInterval(progressInterval)
  viewChangeProgress.value = 100
  setTimeout(() => {
    viewChanging.value = false
    viewChangeProgress.value = 0
  }, 200)

  if (viewKey === 'schematic') {
    if (!store.project?.meta?.hasAutoLayoutTriggered && store.project?.stations?.length >= 2 && !store.isLayoutRunning) {
      store.project.meta.hasAutoLayoutTriggered = true
      store.touchProject('')
      store.runAutoLayout()
    }
  }
}

function handleMenuAction(action) {
  console.log('[handleMenuAction] Action triggered:', action)

  if (!action) return

  const actionMap = {
    createProject: async () => {
      const name = await prompt({ title: '新建工程', message: '请输入工程名称', defaultValue: '新建工程', placeholder: '工程名称' })
      if (name === null) return
      await store.createNewProject(name.trim() || '新建工程')
    },
    duplicateProject: async () => {
      if (!store.project) return
      const name = await prompt({ title: '复制工程', message: '请输入副本名称', defaultValue: `${store.project.name} 副本`, placeholder: '副本名称' })
      if (name === null) return
      await store.duplicateCurrentProject(name.trim() || `${store.project.name} 副本`)
    },
    renameProject: async () => {
      if (!store.project) return
      const name = await prompt({ title: '重命名工程', message: '请输入新名称', defaultValue: store.project.name, placeholder: '工程名称' })
      if (name === null) return
      await store.renameCurrentProject(name.trim() || store.project.name)
    },
    deleteProject: async () => {
      if (!store.project) return
      const ok = await confirm({ title: '删除工程', message: `确认删除工程「${store.project.name}」吗？此操作不可撤销。`, confirmText: '删除', danger: true })
      if (!ok) return
      await store.deleteProjectById(store.project.id)
    },
    importOsm: () => {
      console.log('[handleMenuAction] Calling importJinanNetwork')
      store.importJinanNetwork()
    },
    aiAutoBatchNaming: () => { /* handled in PanelStationMulti */ },
    aiConfig: () => {
      aiConfigVisible.value = true
    },
    shortcutSettings: () => {
      shortcutSettingsVisible.value = true
    },
  }

  if (action.startsWith('importCity_')) {
    const cityId = action.slice('importCity_'.length)
    console.log('[handleMenuAction] Detected importCity action, cityId:', cityId)
    console.log('[handleMenuAction] Calling store.importCityNetwork')
    store.importCityNetwork(cityId)
    return
  }

  if (actionMap[action]) {
    actionMap[action]()
  }
}

async function onGlobalFileSelected(event) {
  const file = event.target.files?.[0]
  if (!file) return
  try {
    await store.importProjectFile(file)
  } catch (error) {
    store.statusText = `加载工程失败: ${error.message || '未知错误'}`
  } finally {
    event.target.value = ''
  }
}

// ── Shortcut system ──

function getShortcutContext() {
  if (store.navigation?.active) return 'navigation'
  if (activeView.value === 'map') return 'mapEditor'
  return 'global'
}

const { rebuildBindings } = useShortcuts({
  // 文件
  'file.save': () => {
    store.persistNow().then(() => {
      store.statusText = '已保存到本地库'
    }).catch(() => {})
  },
  'file.exportFile': () => store.exportProjectFile(),
  'file.newProject': () => handleMenuAction('createProject'),
  'file.openFile': () => globalFileInputRef.value?.click(),
  'file.exportPng': () => store.exportOfficialSchematicPng(),

  // 编辑
  'edit.undo': () => store.undo(),
  'edit.redo': () => store.redo(),
  'edit.redoAlt': () => store.redo(),
  'edit.selectAll': () => store.selectAllStations(),
  'edit.escape': () => {
    // Let registered escape callbacks handle first (context menus, AI menus, etc.)
    for (const cb of escapeCallbacks) {
      if (cb()) return
    }
    // 退出样式刷模式
    if (store.styleBrush.active) {
      store.deactivateStyleBrush()
      return
    }
    store.cancelPendingEdgeStart()
    store.clearSelection()
  },
  'edit.delete': () => {
    if (store.selectedEdgeAnchor) { store.removeSelectedEdgeAnchor(); return }
    if (store.selectedStationIds.length) { store.deleteSelectedStations(); return }
    if ((store.selectedEdgeIds?.length || 0) > 0) { store.deleteSelectedEdge() }
  },
  'edit.deleteAlt': () => {
    if (store.selectedEdgeAnchor) { store.removeSelectedEdgeAnchor(); return }
    if (store.selectedStationIds.length) { store.deleteSelectedStations(); return }
    if ((store.selectedEdgeIds?.length || 0) > 0) { store.deleteSelectedEdge() }
  },
  'edit.renameStation': () => {
    if (store.selectedStationIds.length === 1) {
      stationRenameTrigger.value += 1
    }
  },

  // 视图
  'view.map': () => setActiveView('map'),
  'view.schematic': () => setActiveView('schematic'),
  'view.hud': () => setActiveView('hud'),
  'view.preview': () => setActiveView('preview'),

  // 工具
  'tool.select': () => store.setMode('select'),
  'tool.addStation': () => store.setMode('add-station'),
  'tool.aiAddStation': () => store.setMode('ai-add-station'),
  'tool.addEdge': () => store.setMode('add-edge'),
  'tool.routeDraw': () => store.setMode('route-draw'),
  'tool.styleBrush': () => store.setMode('style-brush'),

  // 导航
  'nav.exit': () => {
    if (store.navigation?.active) store.exitNavigation()
  },
}, { getContext: getShortcutContext })

onMounted(async () => {
  loadWorkspaceViewState()
  window.addEventListener('beforeunload', handleBeforeUnload)
  await store.initialize()
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
})
</script>

<template>
  <IconSprite />
  <main class="app">
    <MenuBar
      :active-view="activeView"
      @set-view="setActiveView"
      @action="handleMenuAction"
      @show-project-list="projectListVisible = true"
      @show-ai-config="aiConfigVisible = true"
      @show-shortcut-settings="shortcutSettingsVisible = true"
      @show-statistics="statisticsVisible = true"
    />
    <div class="app__body">
      <ToolStrip
        :mode="store.mode"
        :can-undo="store.canUndo"
        :can-redo="store.canRedo"
        @set-mode="store.setMode($event)"
        @undo="store.undo()"
        @redo="store.redo()"
      />
      <div ref="canvasContainer" class="app__canvas">
        <ProgressBar :visible="viewChanging" :progress="viewChangeProgress" />
        <section
          class="app__panel"
          :class="{ 'app__panel--active': activeView === 'map' }"
          :aria-hidden="activeView !== 'map'"
        >
          <ErrorBoundary><MapEditor /></ErrorBoundary>
        </section>
        <section
          class="app__panel"
          :class="{ 'app__panel--active': activeView === 'schematic' }"
          :aria-hidden="activeView !== 'schematic'"
        >
          <ErrorBoundary><SchematicView /></ErrorBoundary>
        </section>
        <section
          class="app__panel"
          :class="{ 'app__panel--active': activeView === 'hud' }"
          :aria-hidden="activeView !== 'hud'"
        >
          <ErrorBoundary><VehicleHudView /></ErrorBoundary>
        </section>
        <section
          class="app__panel"
          :class="{ 'app__panel--active': activeView === 'preview' }"
          :aria-hidden="activeView !== 'preview'"
        >
          <ErrorBoundary><TimelinePreviewView :active="activeView === 'preview'" /></ErrorBoundary>
        </section>
      </div>
      <PropertiesPanel v-if="activeView !== 'schematic'" />
      <LayoutControlsPanel v-if="activeView === 'schematic'" />
    </div>
    <StatusBar />
  </main>
  <ProjectListDialog :visible="projectListVisible" @close="projectListVisible = false" />
  <AiConfigDialog :visible="aiConfigVisible" @close="aiConfigVisible = false" @save="store.statusText = 'AI 配置已保存'" />
  <ShortcutSettingsDialog
    :visible="shortcutSettingsVisible"
    @close="shortcutSettingsVisible = false"
    @bindings-changed="rebuildBindings()"
  />
  <StatisticsDialog :visible="statisticsVisible" @close="statisticsVisible = false" />
  <ToastContainer />
  <ConfirmDialog />
  <PromptDialog />
  <input
    ref="globalFileInputRef"
    type="file"
      accept=".json,.metro-studio.json"
    style="display: none"
    @change="onGlobalFileSelected"
  />
</template>

<style scoped>
.app {
  min-height: 100vh;
  height: 100vh;
  display: grid;
  grid-template-rows: auto 1fr auto;
  background: var(--app-shell-gradient);
  color: var(--app-text);
}

.app__body {
  display: flex;
  min-height: 0;
  overflow: hidden;
}

.app__canvas {
  flex: 1;
  position: relative;
  min-width: 0;
  min-height: 0;
  background: var(--workspace-bg);
}

.app__panel {
  position: absolute;
  inset: 0;
  opacity: 0;
  pointer-events: none;
  visibility: hidden;
  transition: opacity var(--transition-normal);
}

.app__panel > * {
  width: 100%;
  height: 100%;
}

.app__panel--active {
  opacity: 1;
  pointer-events: auto;
  visibility: visible;
}
</style>
