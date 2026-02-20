import { computed, ref, onMounted } from 'vue'
import { CITY_PRESETS } from '../lib/osm/cityPresets'
import {
  DEFAULT_UI_THEME,
  UI_THEME_STORAGE_KEY,
  normalizeUiTheme,
} from '../lib/uiPreferences'
import { useAnimationSettings } from './useAnimationSettings.js'
import { useDialog } from './useDialog.js'
import { getEffectiveBindings, formatBindingDisplay } from '../lib/shortcutRegistry'
import { getLocationIqApiKey, setLocationIqApiKey } from '../lib/osm/nominatimClient'

// ── City preset filtering ──

const CHINESE_CITY_IDS = new Set([
  'jinan', 'beijing', 'shanghai', 'guangzhou', 'shenzhen', 'chengdu', 'wuhan',
  'hangzhou', 'nanjing', 'chongqing', 'tianjin', 'suzhou', 'zhengzhou', 'xian',
  'changsha', 'kunming', 'dalian', 'qingdao', 'shenyang', 'harbin', 'fuzhou',
  'xiamen', 'hefei', 'nanchang', 'nanning', 'guiyang', 'urumqi', 'lanzhou',
  'taiyuan', 'shijiazhuang', 'changchun', 'wuxi', 'changzhou', 'xuzhou',
  'foshan', 'dongguan', 'ningbo', 'wenzhou', 'shaoxing', 'luoyang', 'wuhu',
  'hongkong', 'taipei',
])

const CHINESE_CITY_PRESETS = CITY_PRESETS.filter((p) => CHINESE_CITY_IDS.has(p.id))
const INTERNATIONAL_CITY_PRESETS = CITY_PRESETS.filter((p) => !CHINESE_CITY_IDS.has(p.id))

function buildCityMenuItems(presets, importing) {
  const items = presets.map((p) => ({
    type: 'item',
    label: `${p.name} ${p.nameEn}`,
    action: `importCity_${p.id}`,
    disabled: importing,
  }))
  return items
}

// ── UI theme / font ──

/**
 * Composable that provides menu structure definitions and action dispatch logic
 * for the MenuBar component.
 *
 * @param {Object} store - The project store instance (from useProjectStore)
 * @param {Function} emit - The component's emit function
 * @param {{ fileInputRef: import('vue').Ref }} refs - Refs needed by actions
 * @returns Menu item computeds, action handler, and UI preference helpers
 */
export function useMenuBarActions(store, emit, refs) {
  const uiTheme = ref(DEFAULT_UI_THEME)
  const { enabled: animationsEnabled, toggleAnimation } = useAnimationSettings()
  const { prompt } = useDialog()

  // ── UI preference helpers ──

  function applyUiTheme(theme) {
    const next = normalizeUiTheme(theme)
    uiTheme.value = next
    document.documentElement.setAttribute('data-ui-theme', next)
    try { window.localStorage.setItem(UI_THEME_STORAGE_KEY, next) } catch { /* noop */ }
  }

  function restoreUiPreferences() {
    try {
      applyUiTheme(window.localStorage.getItem(UI_THEME_STORAGE_KEY) || DEFAULT_UI_THEME)
    } catch {
      applyUiTheme(DEFAULT_UI_THEME)
    }
  }

  // ── Menu structure definitions ──

  const fileMenuItems = computed(() => {
    const importing = store.isImporting
    return [
      { type: 'item', label: '新建工程', action: 'createProject', icon: 'folder' },
      { type: 'item', label: '打开文件...', action: 'openFile', icon: 'upload' },
      { type: 'item', label: '打开本地库', action: 'showProjectList', icon: 'folder-open' },
      { type: 'item', label: '保存文件', action: 'exportFile', icon: 'download' },
      { type: 'item', label: '存入本地库', action: 'persistToDb', icon: 'save' },
      { type: 'separator' },
      { type: 'item', label: '复制当前工程', action: 'duplicateProject', icon: 'copy', disabled: !store.project },
      { type: 'item', label: '重命名工程', action: 'renameProject', icon: 'edit', disabled: !store.project },
      { type: 'item', label: '删除当前工程', action: 'deleteProject', icon: 'trash', disabled: !store.project },
      { type: 'separator' },
      { type: 'submenu', label: '导入线网', icon: 'route', children: [
        { type: 'item', label: '导入济南 OSM 线网', action: 'importOsm', icon: 'route', disabled: importing },
        { type: 'separator' },
        { type: 'submenu', label: '中国城市', icon: 'git-branch', children: buildCityMenuItems(CHINESE_CITY_PRESETS, importing) },
        { type: 'submenu', label: '国际城市', icon: 'git-branch', children: buildCityMenuItems(INTERNATIONAL_CITY_PRESETS, importing) },
      ]},
      { type: 'separator' },
      { type: 'item', label: '查看本地库', action: 'showProjectList', icon: 'layers' },
    ]
  })

  const editMenuItems = computed(() => {
    const bindings = getEffectiveBindings()
    const shortcutOf = (id) => {
      const b = bindings.find((x) => x.id === id)
      return b ? formatBindingDisplay(b.binding) : ''
    }
    return [
      { type: 'item', label: '撤销', action: 'undo', shortcut: shortcutOf('edit.undo'), icon: 'undo', disabled: !store.canUndo },
      { type: 'item', label: '重做', action: 'redo', shortcut: shortcutOf('edit.redo'), icon: 'redo', disabled: !store.canRedo },
      { type: 'separator' },
      { type: 'item', label: '全选站点', action: 'selectAll', shortcut: shortcutOf('edit.selectAll'), icon: 'check-circle' },
      { type: 'item', label: '全选所有线路', action: 'selectAllLines', shortcut: shortcutOf('edit.selectAllLines'), icon: 'check-circle' },
      { type: 'item', label: '清空选择', action: 'clearSelection', shortcut: shortcutOf('edit.escape'), icon: 'x-circle' },
      { type: 'separator' },
      { type: 'item', label: '复制选中', action: 'copy', shortcut: shortcutOf('edit.copy'), icon: 'copy', disabled: !(store.selectedEdgeIds?.length || store.selectedStationIds?.length) },
      { type: 'item', label: '粘贴', action: 'paste', shortcut: shortcutOf('edit.paste'), icon: 'clipboard' },
      { type: 'separator' },
      { type: 'item', label: '删除选中站点', action: 'deleteStations', shortcut: shortcutOf('edit.delete'), icon: 'trash', disabled: !store.selectedStationIds.length },
      { type: 'item', label: '删除选中线段', action: 'deleteEdges', shortcut: shortcutOf('edit.delete'), icon: 'trash', disabled: !(store.selectedEdgeIds?.length) },
      { type: 'separator' },
      { type: 'item', label: '批量编辑站名', action: 'batchNameEdit', icon: 'edit', disabled: !store.project?.stations?.length },
      { type: 'separator' },
      { type: 'item', label: '删除所有未命名新站', action: 'deleteNewStations', icon: 'trash', disabled: !store.project?.stations?.some((s) => s.nameZh?.startsWith('新站 ')) },
    ]
  })

  const aiMenuItems = computed(() => [
    { type: 'separator' },
    { type: 'item', label: 'AI全自动批量命名', action: 'aiAutoBatchNaming', icon: 'sparkles', disabled: !store.selectedStationIds.length },
    { type: 'separator' },
    { type: 'item', label: 'AI翻译选中站英文', action: 'aiTranslateSelected', icon: 'languages', disabled: !store.selectedStationIds.length || store.isStationEnglishRetranslating },
    { type: 'item', label: '按规范重译全图英文', action: 'aiTranslateAll', icon: 'languages', disabled: !store.project?.stations?.length || store.isStationEnglishRetranslating },
    { type: 'separator' },
    { type: 'item', label: '报站生成', action: 'ttsGeneration', icon: 'volume-2' },
  ])

  const exportMenuItems = computed(() => [
    { type: 'item', label: '导出实际走向图 PNG', action: 'exportActualRoute', icon: 'map' },
    { type: 'item', label: '导出官方风格图 PNG', action: 'exportSchematic', icon: 'layout' },
    { type: 'item', label: '导出车辆 HUD 打包', action: 'exportHudZip', icon: 'monitor' },
    { type: 'separator' },
    { type: 'submenu', label: '导出时间轴视频', icon: 'film', disabled: !store.timelineHasData, children: [
      { type: 'item', label: '1080p (1920×1080)', action: 'exportTimeline_1080p' },
      { type: 'item', label: '2K (2560×1440)', action: 'exportTimeline_2k' },
      { type: 'item', label: '4K (3840×2160)', action: 'exportTimeline_4k' },
    ]},
    { type: 'separator' },
    { type: 'submenu', label: '车站显示模式', icon: 'eye', children: [
      { type: 'toggle', label: '显示所有车站', checked: store.exportStationVisibilityMode === 'all', action: 'stationVisAll', icon: 'eye' },
      { type: 'toggle', label: '仅显示换乘站', checked: store.exportStationVisibilityMode === 'interchange', action: 'stationVisInterchange', icon: 'eye' },
      { type: 'toggle', label: '隐藏所有车站', checked: store.exportStationVisibilityMode === 'none', action: 'stationVisNone', icon: 'eye-off' },
    ]},
  ])

  const settingsMenuItems = computed(() => [
    { type: 'item', label: 'AI 配置', action: 'aiConfig', icon: 'settings' },
    { type: 'item', label: '快捷键绑定', action: 'shortcutSettings', icon: 'sliders' },
    { type: 'separator' },
    { type: 'toggle', label: '启用动画', checked: animationsEnabled.value, action: 'toggleAnimations', icon: 'zap' },
    { type: 'separator' },
    { type: 'submenu', label: '地图瓦片类型', icon: 'layers', children: [
      { type: 'toggle', label: 'OpenStreetMap 标准', checked: store.mapTileType === 'osm', action: 'mapTileOsm', icon: 'map' },
      { type: 'toggle', label: 'ESRI 卫星影像', checked: store.mapTileType === 'satellite', action: 'mapTileSatellite', icon: 'globe' },
      { type: 'toggle', label: 'OpenTopoMap 地形图', checked: store.mapTileType === 'topo', action: 'mapTileTopo', icon: 'mountain' },
      { type: 'toggle', label: 'CartoDB 浅色', checked: store.mapTileType === 'positron', action: 'mapTilePositron', icon: 'sun' },
      { type: 'toggle', label: 'CartoDB 深色', checked: store.mapTileType === 'dark', action: 'mapTileDark', icon: 'moon' },
    ]},
    { type: 'separator' },
    { type: 'toggle', label: '显示区域', checked: store.showLanduseOverlay, action: 'toggleLanduseOverlay', icon: 'map' },
    { type: 'toggle', label: '高亮火车站位置', checked: store.highlightStationLocations, action: 'toggleHighlightStations', icon: 'map-pin' },
    { type: 'separator' },
    { type: 'item', label: '配置 Protomaps API Key', action: 'configProtomapsKey', icon: 'key' },
    { type: 'item', label: '配置 LocationIQ API Key', action: 'configLocationIqKey', icon: 'key' },
    { type: 'separator' },
    { type: 'item', label: '统计信息', action: 'statistics', icon: 'bar-chart-2' },
    { type: 'separator' },
    { type: 'item', label: '关于项目', action: 'about', icon: 'info' },
  ])

  const menus = computed(() => [
    { key: 'file', label: '文件', items: fileMenuItems.value },
    { key: 'edit', label: '编辑', items: editMenuItems.value },
    { key: 'ai', label: 'AI', items: aiMenuItems.value },
    { key: 'export', label: '导出', items: exportMenuItems.value },
    { key: 'settings', label: '设置', items: settingsMenuItems.value },
  ])

  function toggleTheme() {
    applyUiTheme(uiTheme.value === 'light' ? 'dark' : 'light')
  }

  async function handleConfigProtomapsKey() {
    const key = await prompt({
      title: '配置 Protomaps API Key',
      message: '请输入您的 Protomaps API Key（非商业用途免费，从 https://protomaps.com/account 获取）：',
      placeholder: 'your-api-key-here',
      defaultValue: store.protomapsApiKey,
      confirmText: '保存',
      cancelText: '取消',
    })
    if (key !== null) {
      store.setProtomapsApiKey(key)
      try {
        window.localStorage.setItem('protomapsApiKey', key)
      } catch { /* noop */ }
    }
  }

  async function handleConfigLocationIqKey() {
    const key = await prompt({
      title: '配置 LocationIQ API Key',
      message: '配置后站点上下文抓取速度提升约 2 倍。免费注册：https://locationiq.com（每天 5000 次）',
      placeholder: 'pk.xxxxxxxxxxxxxxxx',
      defaultValue: getLocationIqApiKey(),
      confirmText: '保存',
      cancelText: '取消',
    })
    if (key !== null) setLocationIqApiKey(key)
  }

  // ── Action dispatch ──

  function handleAction(action) {
    if (!action) return

    if (action === 'openFile') {
      refs.fileInputRef.value?.click()
      return }
    if (action.startsWith('importCity_')) { emit('action', action); return }
    if (action.startsWith('exportTimeline_')) {
      const resolution = action.slice('exportTimeline_'.length)
      store.exportTimelineVideo({ resolution })
      return
    }
    if (action === 'stationVisAll') { store.setExportStationVisibilityMode('all'); return }
    if (action === 'stationVisInterchange') { store.setExportStationVisibilityMode('interchange'); return }
    if (action === 'stationVisNone') { store.setExportStationVisibilityMode('none'); return }
    if (action === 'mapTileOsm') { store.setMapTileType('osm'); return }
    if (action === 'mapTileSatellite') { store.setMapTileType('satellite'); return }
    if (action === 'mapTileTopo') { store.setMapTileType('topo'); return }
    if (action === 'mapTilePositron') { store.setMapTileType('positron'); return }
    if (action === 'mapTileDark') { store.setMapTileType('dark'); return }
    if (action === 'showProjectList') { emit('show-project-list'); return }
    if (action === 'aiConfig') { emit('show-ai-config'); return }
    if (action === 'ttsGeneration') { emit('show-tts-dialog'); return }
    if (action === 'shortcutSettings') { emit('show-shortcut-settings'); return }
    if (action === 'toggleAnimations') { toggleAnimation(); return }
    if (action === 'toggleLanduseOverlay') { store.toggleLanduseOverlay(); return }
    if (action === 'toggleHighlightStations') { store.toggleHighlightStationLocations(); return }
    if (action === 'configProtomapsKey') { handleConfigProtomapsKey(); return }
    if (action === 'configLocationIqKey') { handleConfigLocationIqKey(); return }
    if (action === 'statistics') { emit('show-statistics'); return }
    if (action === 'about') { emit('show-about'); return }
    if (action === 'batchNameEdit') { emit('show-batch-name-edit'); return }

    // Simple store actions
    const simpleActions = {
      undo: () => store.undo(),
      redo: () => store.redo(),
      selectAll: () => store.selectAllStations(),
      selectAllLines: () => store.selectAllLines(),
      clearSelection: () => store.clearSelection(),
      copy: () => store.copySelectedEdges(),
      paste: () => store.pasteEdges(),
      deleteStations: () => store.deleteSelectedStations(),
      deleteNewStations: () => store.deleteNewStations(),
      deleteEdges: () => store.deleteSelectedEdge(),
      exportActualRoute: () => store.exportActualRoutePng(),
      exportSchematic: () => store.exportOfficialSchematicPng(),
      exportHudZip: () => store.exportAllLineHudZip(),
      exportTimeline: () => store.exportTimelineVideo(),
      exportFile: () => store.exportProjectFile(),
      persistToDb: () => store.persistNow(),
      aiTranslateSelected: () => store.retranslateSelectedStationEnglishNamesWithAi(),
      aiTranslateAll: () => store.retranslateAllStationEnglishNamesWithAi(),
    }

    if (simpleActions[action]) {
      simpleActions[action]()
      return
    }

    // Actions that need prompts or emit to parent
    emit('action', action)
  }

  onMounted(() => {
    restoreUiPreferences()
  })

  return {
    uiTheme,
    menus,
    fileMenuItems,
    editMenuItems,
    aiMenuItems,
    exportMenuItems,
    handleAction,
    applyUiTheme,
    restoreUiPreferences,
    toggleTheme,
  }
}
