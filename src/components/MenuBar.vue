<script setup>
import { computed, ref, watch } from 'vue'
import IconBase from './IconBase.vue'
import DropdownMenu from './DropdownMenu.vue'
import TooltipWrapper from './TooltipWrapper.vue'
import { useProjectStore } from '../stores/projectStore'
import { getDisplayLineName } from '../lib/lineNaming'
import { useMenuBarActions } from '../composables/useMenuBarActions'

const props = defineProps({
  activeView: { type: String, default: 'map' },
})

const emit = defineEmits(['set-view', 'action', 'show-project-list', 'show-ai-config', 'show-shortcut-settings'])

const store = useProjectStore()
const openMenuKey = ref(null)
const menuBarRef = ref(null)
const menuButtonRects = ref({})
const lineDropdownOpen = ref(false)
const lineButtonRef = ref(null)
const lineDropdownRect = ref(null)
const fileInputRef = ref(null)

const { menus, handleAction, uiTheme, toggleTheme } = useMenuBarActions(store, emit, { fileInputRef })

const MIN_YEAR = 1900
const MAX_YEAR = 2100
const editYearInput = ref(store.currentEditYear)

watch(() => store.currentEditYear, (v) => { editYearInput.value = v })

function normalizeEditYear(year) {
  const num = Number.isFinite(+year) ? Math.floor(+year) : 2010
  return Math.max(MIN_YEAR, Math.min(MAX_YEAR, num))
}

function onEditYearInput(event) {
  const year = normalizeEditYear(event.target.value)
  store.setCurrentEditYear(year)
  editYearInput.value = year
}

function incrementEditYear() {
  const y = normalizeEditYear(store.currentEditYear + 1)
  store.setCurrentEditYear(y)
  editYearInput.value = y
}

function decrementEditYear() {
  const y = normalizeEditYear(store.currentEditYear - 1)
  store.setCurrentEditYear(y)
  editYearInput.value = y
}

const lines = computed(() => store.project?.lines || [])
const activeLine = computed(() => {
  if (!store.project || !store.activeLineId) return null
  return store.project.lines.find((l) => l.id === store.activeLineId) || null
})
const activeLineName = computed(() => {
  if (!activeLine.value) return '无线路'
  return getDisplayLineName(activeLine.value, 'zh') || activeLine.value.nameZh || '未命名'
})

const viewButtons = [
  { view: 'map', icon: 'map', label: '地图' },
  { view: 'schematic', icon: 'layout', label: '版式' },
  { view: 'hud', icon: 'monitor', label: 'HUD' },
  { view: 'preview', icon: 'film', label: '预览' },
]

function toggleMenu(key) {
  if (openMenuKey.value === key) {
    openMenuKey.value = null
    return
  }
  openMenuKey.value = key
  captureMenuButtonRect(key)
}

function onMenuBarMouseEnter(key) {
  if (openMenuKey.value && openMenuKey.value !== key) {
    openMenuKey.value = key
    captureMenuButtonRect(key)
  }
}

function captureMenuButtonRect(key) {
  const btn = menuBarRef.value?.querySelector(`[data-menu-key="${key}"]`)
  if (btn) {
    menuButtonRects.value[key] = btn.getBoundingClientRect()
  }
}

function closeMenu() {
  openMenuKey.value = null
}

function onMenuSelect(item) {
  closeMenu()
  handleAction(item.action)
}

async function onFileSelected(event) {
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

function toggleLineDropdown() {
  openMenuKey.value = null
  lineDropdownOpen.value = !lineDropdownOpen.value
  if (lineDropdownOpen.value && lineButtonRef.value) {
    lineDropdownRect.value = lineButtonRef.value.getBoundingClientRect()
  }
}

function onLineSelect(item) {
  lineDropdownOpen.value = false
  if (item.action?.startsWith('line_')) {
    store.setActiveLine(item.action.slice(5))
  }
}

const lineMenuItems = computed(() =>
  lines.value.map((line) => ({
    type: 'item',
    label: getDisplayLineName(line, 'zh') || line.nameZh || '未命名',
    action: `line_${line.id}`,
  })),
)

function toggleNavigation() {
  if (store.navigation.active) {
    store.exitNavigation()
  } else {
    store.enterNavigation()
  }
}
</script>

<template>
  <header ref="menuBarRef" class="menu-bar">
    <div class="menu-bar__left">
      <span class="menu-bar__brand">Metro Studio</span>
      <span class="menu-bar__brand-sep" />

      <nav class="menu-bar__menus">
        <button
          v-for="menu in menus"
          :key="menu.key"
          :data-menu-key="menu.key"
          class="menu-bar__menu-btn"
          :class="{ 'menu-bar__menu-btn--open': openMenuKey === menu.key }"
          type="button"
          @click="toggleMenu(menu.key)"
          @mouseenter="onMenuBarMouseEnter(menu.key)"
        >
          {{ menu.label }}
        </button>
      </nav>

      <template v-for="menu in menus" :key="`dropdown_${menu.key}`">
        <DropdownMenu
          v-if="openMenuKey === menu.key && menuButtonRects[menu.key]"
          :items="menu.items"
          :visible="true"
          :anchor-rect="menuButtonRects[menu.key]"
          @select="onMenuSelect"
          @close="closeMenu"
        />
      </template>
    </div>

    <div class="menu-bar__right">
      <TooltipWrapper text="导航" placement="bottom" :delay="300">
        <button
          class="menu-bar__nav-btn"
          :class="{ 'menu-bar__nav-btn--active': store.navigation.active }"
          type="button"
          @click="toggleNavigation"
          aria-label="导航"
        >
          <IconBase name="navigation" :size="16" />
        </button>
      </TooltipWrapper>

      <div class="menu-bar__line-switcher">
        <button
          ref="lineButtonRef"
          class="menu-bar__line-btn"
          type="button"
          @click="toggleLineDropdown"
        >
          <span
            class="menu-bar__line-swatch"
            :style="{ backgroundColor: activeLine?.color || '#555' }"
          />
          <span class="menu-bar__line-name">{{ activeLineName }}</span>
          <IconBase name="chevron-down" :size="12" class="menu-bar__line-chevron" :class="{ 'menu-bar__line-chevron--open': lineDropdownOpen }" />
        </button>
        <DropdownMenu
          v-if="lineDropdownOpen && lineDropdownRect"
          :items="lineMenuItems"
          :visible="true"
          :anchor-rect="lineDropdownRect"
          @select="onLineSelect"
          @close="lineDropdownOpen = false"
        />
      </div>

      <div class="menu-bar__year-selector">
        <span class="menu-bar__year-label">建设年份</span>
        <button
          class="menu-bar__year-btn"
          type="button"
          :disabled="store.currentEditYear <= MIN_YEAR"
          @click="decrementEditYear"
          aria-label="减少年份"
        >−</button>
        <input
          type="number"
          class="menu-bar__year-input"
          :value="editYearInput"
          :min="MIN_YEAR"
          :max="MAX_YEAR"
          step="1"
          @change="onEditYearInput"
        />
        <button
          class="menu-bar__year-btn"
          type="button"
          :disabled="store.currentEditYear >= MAX_YEAR"
          @click="incrementEditYear"
          aria-label="增加年份"
        >+</button>
      </div>

      <div class="menu-bar__view-switcher">
        <TooltipWrapper
          v-for="btn in viewButtons"
          :key="btn.view"
          :text="btn.label"
          placement="bottom"
          :delay="300"
        >
          <button
            class="menu-bar__view-btn"
            :class="{ 'menu-bar__view-btn--active': activeView === btn.view }"
            type="button"
            @click="emit('set-view', btn.view)"
          >
            <IconBase :name="btn.icon" :size="16" />
          </button>
        </TooltipWrapper>
      </div>

      <TooltipWrapper text="切换主题" placement="bottom" :delay="300">
        <button
          class="menu-bar__theme-btn"
          type="button"
          @click="toggleTheme"
          aria-label="切换主题"
        >
          <IconBase :name="uiTheme === 'light' ? 'moon' : 'sun'" :size="16" />
        </button>
      </TooltipWrapper>
    </div>

    <input
      ref="fileInputRef"
      type="file"
      accept=".json,.railmap.json"
      class="menu-bar__file-input"
      @change="onFileSelected"
    />
  </header>
</template>

<style scoped>
.menu-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 8px;
  background: var(--toolbar-header-bg);
  border-bottom: 1px solid var(--toolbar-border);
  flex-shrink: 0;
  z-index: 100;
}

.menu-bar__left {
  display: flex;
  align-items: center;
  gap: 4px;
}

.menu-bar__brand {
  font-size: 14px;
  font-weight: 700;
  color: var(--toolbar-text);
  padding: 0 8px 0 4px;
  letter-spacing: 0.05em;
}

.menu-bar__brand-sep {
  width: 1px;
  height: 16px;
  background: var(--toolbar-divider);
  margin-right: 4px;
  flex-shrink: 0;
}

.menu-bar__menus {
  display: flex;
  align-items: center;
  gap: 0;
}

.menu-bar__menu-btn {
  position: relative;
  border: none;
  background: transparent;
  color: var(--toolbar-muted);
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  transition: color var(--transition-fast, 0.1s ease), background var(--transition-fast, 0.1s ease);
}

.menu-bar__menu-btn:hover {
  backdrop-filter: brightness(1.2);
  color: var(--toolbar-text);
}

.menu-bar__menu-btn--open {
  color: var(--toolbar-text);
  background: var(--toolbar-tab-active-bg);
}

.menu-bar__menu-btn--open::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: calc(100% - 16px);
  height: 2px;
  background: var(--indicator-color, var(--toolbar-primary-bg));
  border-radius: 1px 1px 0 0;
}

.menu-bar__right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.menu-bar__line-switcher {
  position: relative;
}

.menu-bar__line-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--toolbar-input-border);
  background: var(--toolbar-input-bg);
  color: var(--toolbar-text);
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
  transition: border-color var(--transition-fast);
  max-width: 180px;
}

.menu-bar__line-btn:hover {
  border-color: var(--toolbar-button-hover-border);
}

.menu-bar__line-swatch {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.menu-bar__line-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menu-bar__line-chevron {
  transition: transform var(--transition-normal, 0.15s ease);
  flex-shrink: 0;
}

.menu-bar__line-chevron--open {
  transform: rotate(180deg);
}

.menu-bar__view-switcher {
  display: flex;
  align-items: center;
  gap: 0;
  border: 1px solid var(--toolbar-input-border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--toolbar-input-bg);
}

.menu-bar__view-btn {
  position: relative;
  border: none;
  background: transparent;
  color: var(--toolbar-muted);
  padding: 5px 10px;
  cursor: pointer;
  transition: color var(--transition-fast, 0.1s ease), background var(--transition-fast, 0.1s ease);
  display: flex;
  align-items: center;
}

.menu-bar__view-btn:hover {
  color: var(--toolbar-text);
  background: rgba(255, 255, 255, 0.04);
}

.menu-bar__view-btn--active {
  background: var(--toolbar-tab-active-bg);
  color: var(--toolbar-tab-active-text);
}

.menu-bar__year-selector {
  display: flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--toolbar-input-border);
  border-radius: 6px;
  background: var(--toolbar-input-bg);
  padding: 2px 4px;
}

.menu-bar__year-label {
  font-size: 11px;
  color: var(--toolbar-muted);
  padding: 0 4px 0 2px;
  white-space: nowrap;
}

.menu-bar__year-btn {
  border: none;
  background: transparent;
  color: var(--toolbar-muted);
  font-size: 14px;
  font-weight: 600;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  transition: color var(--transition-fast), background var(--transition-fast);
}

.menu-bar__year-btn:hover:not(:disabled) {
  color: var(--toolbar-text);
  background: rgba(255, 255, 255, 0.08);
}

.menu-bar__year-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.menu-bar__year-input {
  width: 52px;
  border: none;
  background: transparent;
  color: var(--toolbar-text);
  font-size: 12px;
  font-weight: 600;
  text-align: center;
  padding: 2px 0;
  font-variant-numeric: tabular-nums;
  -moz-appearance: textfield;
}

.menu-bar__year-input:focus {
  outline: none;
}

.menu-bar__year-input::-webkit-inner-spin-button,
.menu-bar__year-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.menu-bar__file-input {
  display: none;
}

.menu-bar__theme-btn {
  border: 1px solid var(--toolbar-input-border);
  background: var(--toolbar-input-bg);
  color: var(--toolbar-muted);
  padding: 6px 10px;
  cursor: pointer;
  transition: color var(--transition-fast, 0.1s ease), background var(--transition-fast, 0.1s ease);
  display: flex;
  align-items: center;
  border-radius: 6px;
}

.menu-bar__theme-btn:hover {
  color: var(--toolbar-text);
  background: rgba(255, 255, 255, 0.04);
}

.menu-bar__nav-btn {
  border: 1px solid var(--toolbar-input-border);
  background: var(--toolbar-input-bg);
  color: var(--toolbar-muted);
  padding: 6px 10px;
  cursor: pointer;
  transition: color var(--transition-fast, 0.1s ease), background var(--transition-fast, 0.1s ease), border-color var(--transition-fast, 0.1s ease);
  display: flex;
  align-items: center;
  border-radius: 6px;
}

.menu-bar__nav-btn:hover {
  color: var(--toolbar-text);
  background: rgba(255, 255, 255, 0.04);
}

.menu-bar__nav-btn--active {
  color: var(--toolbar-tab-active-text);
  background: var(--toolbar-primary-bg, #2563eb);
  border-color: var(--toolbar-primary-bg, #2563eb);
}

.menu-bar__nav-btn--active:hover {
  background: var(--toolbar-primary-bg, #2563eb);
  opacity: 0.9;
}
</style>
