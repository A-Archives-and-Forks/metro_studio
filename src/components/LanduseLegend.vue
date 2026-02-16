<script setup>
import { ref, computed } from 'vue'
import { COMMON_LANDUSE_TYPES, LANDUSE_COLORS } from './map-editor/mapLayers'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
})

const isCollapsed = ref(false)

const legendItems = computed(() => {
  const labels = {
    residential: '居民区',
    commercial: '商业区',
    industrial: '工业区',
    retail: '零售区',
    school: '学校',
    university: '大学',
    cemetery: '墓地',
    military: '军事区',
    railway: '铁路用地',
    garages: '车库',
    bus_station: '公交站',
    stadium: '体育场',
  }

  return COMMON_LANDUSE_TYPES.map((type) => ({
    type,
    label: labels[type] || type,
    color: LANDUSE_COLORS[type] || '#cccccc',
  }))
})

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value
}
</script>

<template>
  <div class="landuse-legend" v-if="visible">
    <button
      class="landuse-legend__toggle"
      @click="toggleCollapse"
      :title="isCollapsed ? '展开图例' : '折叠图例'"
    >
      <span v-if="!isCollapsed" class="landuse-legend__toggle-icon">▼</span>
      <span v-else class="landuse-legend__toggle-icon">▲</span>
      <span v-if="!isCollapsed" class="landuse-legend__title">区域类型</span>
    </button>
    <div v-if="!isCollapsed" class="landuse-legend__content">
      <div class="landuse-legend__item" v-for="item in legendItems" :key="item.type">
        <span class="landuse-legend__color" :style="{ background: item.color }"></span>
        <span class="landuse-legend__label">{{ item.label }}</span>
      </div>
    </div>
  </div>
</template>

<style src="./LanduseLegend.css"></style>
