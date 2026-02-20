<script setup>
import { ref, watch, nextTick } from 'vue'
import IconBase from './IconBase.vue'
import { searchLocation } from '../lib/osm/nominatimSearch'

const props = defineProps({
  visible: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'select'])

const searchInputRef = ref(null)
const searchQuery = ref('')
const searchResults = ref([])
const isSearching = ref(false)
const searchError = ref(null)
const selectedIndex = ref(-1)

watch(() => props.visible, async (visible) => {
  if (visible) {
    searchQuery.value = ''
    searchResults.value = []
    searchError.value = null
    selectedIndex.value = -1
    await nextTick()
    searchInputRef.value?.focus()
  }
})

async function performSearch() {
  const query = searchQuery.value.trim()
  if (!query) {
    searchResults.value = []
    searchError.value = null
    return
  }

  isSearching.value = true
  searchError.value = null
  searchResults.value = []
  selectedIndex.value = -1

  try {
    const results = await searchLocation(query, { limit: 10 })
    searchResults.value = results.map((item, index) => ({
      id: item.place_id || item.osm_type + item.osm_id || index,
      lat: parseFloat(item.lat),
      lon: parseFloat(item.lon),
      displayName: item.display_name || '',
      address: item.address || {},
      name: item.namedetails?.name || item.name || '',
      type: item.type || '',
      class: item.class || '',
      importance: item.importance || 0,
    }))
    if (searchResults.value.length === 0) {
      searchError.value = '未找到匹配的地点'
    }
  } catch (error) {
    searchError.value = error.message || '搜索失败'
    searchResults.value = []
  } finally {
    isSearching.value = false
  }
}

let searchDebounceTimer = null

function onSearchInput() {
  clearTimeout(searchDebounceTimer)
  searchDebounceTimer = setTimeout(() => {
    performSearch()
  }, 300)
}

function handleKeyDown(event) {
  if (searchResults.value.length === 0) return

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    selectedIndex.value = (selectedIndex.value + 1) % searchResults.value.length
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    selectedIndex.value = selectedIndex.value <= 0 ? searchResults.value.length - 1 : selectedIndex.value - 1
  } else if (event.key === 'Enter' && selectedIndex.value >= 0) {
    event.preventDefault()
    onSelectResult(searchResults.value[selectedIndex.value])
  } else if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
  }
}

function onSelectResult(result) {
  emit('select', {
    lngLat: [result.lon, result.lat],
    name: result.name || result.displayName.split(',')[0],
  })
  emit('close')
}

function formatResultType(result) {
  const typeMap = {
    'relation': '区域',
    'way': '道路',
    'node': '地点',
  }
  if (result.type === 'station') return '站点'
  if (result.class === 'highway') return '道路'
  if (result.class === 'railway') return '铁路'
  if (result.class === 'amenity') return '设施'
  if (result.class === 'building') return '建筑'
  if (result.class === 'shop') return '商店'
  if (result.class === 'leisure') return '休闲'
  if (result.class === 'tourism') return '景点'
  return typeMap[result.type] || '地点'
}
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog-backdrop">
      <div
        v-if="visible"
        class="map-search-dialog__backdrop"
        @mousedown.self="emit('close')"
      >
        <div class="map-search-dialog__container" @mousedown.stop>
          <div class="map-search-dialog__header">
            <h3>搜索地点</h3>
            <button
              class="map-search-dialog__close"
              type="button"
              @click="emit('close')"
              aria-label="关闭"
            >
              <IconBase name="x" :size="18" />
            </button>
          </div>

          <div class="map-search-dialog__search">
            <input
              ref="searchInputRef"
              v-model="searchQuery"
              type="text"
              class="map-search-dialog__input"
              placeholder="输入地名、街道、地标..."
              @input="onSearchInput"
              @keydown="handleKeyDown"
            />
            <div class="map-search-dialog__status">
              <span v-if="isSearching" class="map-search-dialog__loading">搜索中...</span>
              <span v-else-if="searchError" class="map-search-dialog__error">{{ searchError }}</span>
              <span v-else-if="searchQuery && !isSearching && searchResults.length === 0" class="map-search-dialog__hint">
                请输入更详细的搜索词
              </span>
              <span v-else-if="!searchQuery" class="map-search-dialog__hint">
                支持搜索地名、街道、建筑、景点等
              </span>
            </div>
          </div>

          <div class="map-search-dialog__results">
            <div
              v-for="(result, index) in searchResults"
              :key="result.id"
              class="map-search-dialog__result"
              :class="{ 'map-search-dialog__result--selected': index === selectedIndex }"
              @click="onSelectResult(result)"
              @mouseenter="selectedIndex = index"
            >
              <div class="map-search-dialog__result-icon">
                <IconBase name="map-pin" :size="16" />
              </div>
              <div class="map-search-dialog__result-content">
                <div class="map-search-dialog__result-name">
                  {{ result.name || result.displayName.split(',')[0] }}
                </div>
                <div class="map-search-dialog__result-address">
                  {{ result.displayName }}
                </div>
                <div class="map-search-dialog__result-meta">
                  <span class="map-search-dialog__result-type">{{ formatResultType(result) }}</span>
                </div>
              </div>
            </div>

            <div v-if="searchResults.length === 0 && !isSearching && !searchError && searchQuery" class="map-search-dialog__empty">
              未找到匹配的地点
            </div>
          </div>

          <div class="map-search-dialog__footer">
            <span class="map-search-dialog__powered">Powered by OpenStreetMap & Nominatim</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.map-search-dialog__backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.map-search-dialog__container {
  width: 100%;
  max-width: 480px;
  max-height: 80vh;
  border: 1px solid var(--toolbar-border);
  border-radius: 12px;
  background: var(--toolbar-card-bg);
  color: var(--toolbar-text);
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}

.map-search-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid var(--toolbar-divider);
  flex-shrink: 0;
}

.map-search-dialog__header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.map-search-dialog__close {
  border: none;
  background: transparent;
  color: var(--toolbar-muted);
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color var(--transition-fast), background-color var(--transition-fast);
}

.map-search-dialog__close:hover {
  color: var(--toolbar-text);
  background: rgba(0, 0, 0, 0.08);
}

.map-search-dialog__search {
  padding: 16px;
  flex-shrink: 0;
}

.map-search-dialog__input {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--toolbar-input-border);
  border-radius: 8px;
  background: var(--toolbar-input-bg);
  color: var(--toolbar-text);
  font-size: 14px;
  outline: none;
  transition: border-color var(--transition-fast);
}

.map-search-dialog__input:focus {
  border-color: var(--toolbar-primary-border);
}

.map-search-dialog__status {
  margin-top: 8px;
  min-height: 20px;
  font-size: 12px;
}

.map-search-dialog__loading {
  color: var(--toolbar-muted);
}

.map-search-dialog__error {
  color: var(--toolbar-danger-border);
}

.map-search-dialog__hint {
  color: var(--toolbar-hint);
}

.map-search-dialog__results {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.map-search-dialog__result {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color var(--transition-fast);
}

.map-search-dialog__result:hover,
.map-search-dialog__result--selected {
  background: var(--toolbar-hover-bg);
}

.map-search-dialog__result-icon {
  flex-shrink: 0;
  padding-top: 2px;
  color: var(--toolbar-muted);
}

.map-search-dialog__result-content {
  flex: 1;
  min-width: 0;
}

.map-search-dialog__result-name {
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.map-search-dialog__result-address {
  font-size: 12px;
  color: var(--toolbar-muted);
  margin-bottom: 4px;
  line-height: 1.4;
}

.map-search-dialog__result-meta {
  display: flex;
  gap: 8px;
  align-items: center;
}

.map-search-dialog__result-type {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--toolbar-badge-bg);
  color: var(--toolbar-badge-text);
}

.map-search-dialog__empty {
  text-align: center;
  padding: 32px 16px;
  color: var(--toolbar-muted);
  font-size: 14px;
}

.map-search-dialog__footer {
  padding: 10px 16px;
  border-top: 1px solid var(--toolbar-divider);
  flex-shrink: 0;
}

.map-search-dialog__powered {
  font-size: 11px;
  color: var(--toolbar-hint);
  text-align: center;
  display: block;
}

.dialog-backdrop-enter-active,
.dialog-backdrop-leave-active {
  transition: opacity 0.2s ease;
}

.dialog-backdrop-enter-from,
.dialog-backdrop-leave-to {
  opacity: 0;
}

.dialog-backdrop-enter-active .map-search-dialog__container,
.dialog-backdrop-leave-active .map-search-dialog__container {
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.dialog-backdrop-enter-from .map-search-dialog__container,
.dialog-backdrop-leave-to .map-search-dialog__container {
  transform: scale(0.95);
  opacity: 0;
}
</style>
