<script setup>
import { onMounted, ref, computed, watch } from 'vue'
import IconBase from './IconBase.vue'
import { NTooltip, NModal } from 'naive-ui'
import { useProjectStore } from '../stores/projectStore'
import { useDialog } from '../composables/useDialog.js'

const props = defineProps({
  visible: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])

const store = useProjectStore()
const { confirm } = useDialog()
const projectOptions = ref([])
const projectFilter = ref('')

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

async function refreshList() {
  projectOptions.value = await store.listProjects()
}

async function loadProject(projectId) {
  await store.loadProjectById(projectId)
  await refreshList()
  emit('close')
}

async function deleteProject(projectId) {
  const target = projectOptions.value.find((p) => p.id === projectId)
  const targetName = target?.name || projectId
  const ok = await confirm({ title: '删除工程', message: `确认删除工程「${targetName}」吗？此操作不可撤销。`, confirmText: '删除', danger: true })
  if (!ok) return
  await store.deleteProjectById(projectId)
  await refreshList()
}

function isCurrentProject(projectId) {
  return currentProjectId.value === projectId
}

watch(() => props.visible, (v) => { if (v) refreshList() })

onMounted(() => {
  refreshList()
})
</script>

<template>
  <NModal :show="visible" preset="card" title="本地库" style="width:520px;max-width:calc(100vw - 32px)" @close="emit('close')" @mask-click="emit('close')">
        <div class="dialog__body">
          <div class="dialog__search-row">
            <div class="dialog__search-wrap">
              <IconBase name="search" :size="14" class="dialog__search-icon" />
              <input
                v-model="projectFilter"
                class="dialog__search"
                placeholder="搜索工程名或 ID..."
              />
              <NTooltip v-if="projectFilter" placement="bottom">
                <template #trigger>
                  <button class="dialog__search-clear" type="button" @click="projectFilter = ''">
                    <IconBase name="x" :size="12" />
                  </button>
                </template>
                清除搜索
              </NTooltip>
            </div>
            <NTooltip placement="bottom">
              <template #trigger>
                <button class="dialog__refresh-btn" type="button" @click="refreshList">刷新</button>
              </template>
              刷新本地库
            </NTooltip>
          </div>
          <ul class="dialog__list">
            <li v-for="project in filteredProjectOptions" :key="project.id">
              <div class="dialog__item" :class="{ 'dialog__item--active': isCurrentProject(project.id) }">
                <div class="dialog__item-main">
                  <span class="dialog__item-name">{{ project.name }}</span>
                  <small class="dialog__item-meta">{{ new Date(project.meta.updatedAt).toLocaleString() }}</small>
                </div>
                <div class="dialog__item-actions">
                  <NTooltip placement="bottom">
                    <template #trigger>
                      <button class="dialog__action-btn" @click="loadProject(project.id)">加载</button>
                    </template>
                    加载此工程
                  </NTooltip>
                  <NTooltip placement="bottom">
                    <template #trigger>
                      <button class="dialog__action-btn dialog__action-btn--danger" @click="deleteProject(project.id)">删除</button>
                    </template>
                    删除此工程
                  </NTooltip>
                </div>
              </div>
            </li>
            <li v-if="!filteredProjectOptions.length" class="dialog__empty">
              <IconBase name="layers" :size="32" class="dialog__empty-icon" />
              <span>无匹配工程</span>
            </li>
          </ul>
        </div>
  </NModal>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 8000;
  background: rgba(0, 0, 0, 0);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: backdrop-fade-in var(--transition-normal) forwards;
}

@keyframes backdrop-fade-in {
  to {
    background: rgba(0, 0, 0, 0.45);
  }
}

.dialog {
  width: 520px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 64px);
  background: var(--toolbar-card-bg);
  border: 1px solid var(--toolbar-border);
  border-radius: 12px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: dialog-enter var(--transition-normal);
}

@keyframes dialog-enter {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--toolbar-border);
}

.dialog__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--toolbar-text);
}

.dialog__close {
  border: none;
  background: transparent;
  color: var(--toolbar-muted);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  transition: color var(--transition-fast, 0.1s ease), background var(--transition-fast, 0.1s ease);
}

.dialog__close:hover {
  background: var(--toolbar-button-bg);
  color: var(--toolbar-text);
}

.dialog__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 16px;
}

.dialog__search-row {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.dialog__search-wrap {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
}

.dialog__search-icon {
  position: absolute;
  left: 10px;
  color: var(--toolbar-muted);
  pointer-events: none;
}

.dialog__search {
  width: 100%;
  padding: 7px 30px 7px 32px;
  border: 1px solid var(--toolbar-input-border);
  border-radius: 6px;
  background: var(--toolbar-input-bg);
  color: var(--toolbar-text);
  font-size: 12px;
  outline: none;
  transition: box-shadow var(--transition-normal, 0.15s ease), border-color var(--transition-normal, 0.15s ease);
}

.dialog__search:focus {
  border-color: var(--toolbar-tab-active-border);
  box-shadow: var(--focus-ring, 0 0 0 2px rgba(29, 78, 216, 0.2));
}

.dialog__search-clear {
  position: absolute;
  right: 6px;
  border: none;
  background: transparent;
  color: var(--toolbar-muted);
  cursor: pointer;
  padding: 2px;
  border-radius: 3px;
  display: flex;
  align-items: center;
}

.dialog__search-clear:hover {
  color: var(--toolbar-text);
}

.dialog__refresh-btn {
  padding: 7px 12px;
  border: 1px solid var(--toolbar-input-border);
  border-radius: 6px;
  background: var(--toolbar-input-bg);
  color: var(--toolbar-text);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color var(--transition-fast, 0.1s ease);
}

.dialog__refresh-btn:hover {
  border-color: var(--toolbar-button-hover-border);
}

.dialog__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dialog__item {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px 8px 14px;
  border: 1px solid var(--toolbar-input-border);
  border-radius: 8px;
  background: var(--toolbar-input-bg);
  transition: border-color var(--transition-fast, 0.1s ease), background var(--transition-fast, 0.1s ease);
}

.dialog__item:hover {
  border-color: var(--toolbar-button-hover-border);
}

.dialog__item:hover::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: var(--indicator-width, 2px);
  height: 20px;
  background: var(--indicator-color, var(--toolbar-primary-bg));
  border-radius: 0 1px 1px 0;
}

.dialog__item--active {
  border-color: var(--toolbar-tab-active-border);
  background: var(--toolbar-tab-active-bg);
}

.dialog__item--active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: var(--indicator-width, 2px);
  height: 20px;
  background: var(--indicator-color, var(--toolbar-primary-bg));
  border-radius: 0 1px 1px 0;
}

.dialog__item-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.dialog__item-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--toolbar-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dialog__item-meta {
  font-size: 11px;
  color: var(--toolbar-muted);
}

.dialog__item-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity var(--transition-fast, 0.1s ease);
}

.dialog__item:hover .dialog__item-actions,
.dialog__item--active .dialog__item-actions {
  opacity: 1;
}

.dialog__action-btn {
  padding: 4px 10px;
  border: 1px solid var(--toolbar-input-border);
  border-radius: 5px;
  background: var(--toolbar-input-bg);
  color: var(--toolbar-text);
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color var(--transition-fast, 0.1s ease);
}

.dialog__action-btn:hover {
  border-color: var(--toolbar-button-hover-border);
}

.dialog__action-btn--danger {
  color: var(--toolbar-danger, #e74c3c);
}

.dialog__action-btn--danger:hover {
  border-color: var(--toolbar-danger, #e74c3c);
}

.dialog__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
  padding: 32px 24px;
  color: var(--toolbar-muted);
  font-size: 13px;
}

.dialog__empty-icon {
  opacity: 0.4;
}
</style>
