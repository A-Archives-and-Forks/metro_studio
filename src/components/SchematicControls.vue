<script setup>
import { computed } from 'vue'
import AccordionSection from './AccordionSection.vue'
import TooltipWrapper from './TooltipWrapper.vue'
import { useProjectStore } from '../stores/projectStore'

const store = useProjectStore()

const displayConfig = computed(() => store.project?.layoutConfig?.displayConfig || {})

function updateConfig(key, value) {
  if (!store.project?.layoutConfig?.displayConfig) return
  store.project.layoutConfig.displayConfig[key] = value
}
</script>

<template>
  <div class="schematic-controls">
    <AccordionSection title="站点显示" :default-open="true">
      <label class="pp-row">
        <input
          type="checkbox"
          :checked="displayConfig.showStationNumbers ?? false"
          @change="updateConfig('showStationNumbers', $event.target.checked)"
        />
        <span>显示站点编号</span>
      </label>
      <label class="pp-row">
        <input
          type="checkbox"
          :checked="displayConfig.showInterchangeMarkers ?? true"
          @change="updateConfig('showInterchangeMarkers', $event.target.checked)"
        />
        <span>显示换乘站标记</span>
      </label>
      <label class="pp-label">站点图标大小</label>
      <div class="pp-range-row">
        <input
          type="range"
          min="0.5"
          max="2.0"
          step="0.1"
          :value="displayConfig.stationIconSize ?? 1.0"
          @input="updateConfig('stationIconSize', parseFloat($event.target.value))"
        />
        <span class="pp-range-value">{{ (displayConfig.stationIconSize ?? 1.0).toFixed(1) }}x</span>
      </div>
      <label class="pp-label">站点样式</label>
      <select
        class="pp-select"
        :value="displayConfig.stationIconStyle ?? 'circle'"
        @change="updateConfig('stationIconStyle', $event.target.value)"
      >
        <option value="circle">圆形</option>
        <option value="square">方形</option>
      </select>
    </AccordionSection>

    <AccordionSection title="线路显示" :default-open="true">
      <label class="pp-row">
        <input
          type="checkbox"
          :checked="displayConfig.showLineBadges ?? true"
          @change="updateConfig('showLineBadges', $event.target.checked)"
        />
        <span>显示线路编号</span>
      </label>
      <label class="pp-label">线条粗细</label>
      <div class="pp-range-row">
        <input
          type="range"
          min="0.5"
          max="2.0"
          step="0.1"
          :value="displayConfig.edgeWidthScale ?? 1.0"
          @input="updateConfig('edgeWidthScale', parseFloat($event.target.value))"
        />
        <span class="pp-range-value">{{ (displayConfig.edgeWidthScale ?? 1.0).toFixed(1) }}x</span>
      </div>
      <label class="pp-label">线条透明度</label>
      <div class="pp-range-row">
        <input
          type="range"
          min="0.3"
          max="1.0"
          step="0.05"
          :value="displayConfig.edgeOpacity ?? 1.0"
          @input="updateConfig('edgeOpacity', parseFloat($event.target.value))"
        />
        <span class="pp-range-value">{{ Math.round((displayConfig.edgeOpacity ?? 1.0) * 100) }}%</span>
      </div>
    </AccordionSection>



    <AccordionSection title="布局参数" :default-open="false">
      <label class="pp-label">转角圆滑度</label>
      <div class="pp-range-row">
        <input
          type="range"
          min="0"
          max="30"
          step="1"
          :value="displayConfig.cornerRadius ?? 10"
          @input="updateConfig('cornerRadius', parseInt($event.target.value, 10))"
        />
        <span class="pp-range-value">{{ displayConfig.cornerRadius ?? 10 }}px</span>
      </div>
      <p class="pp-hint">值越大，线路转角越圆滑。设为 0 时为直角。</p>
    </AccordionSection>
  </div>
</template>

<style scoped>
.schematic-controls {
  background: var(--toolbar-bg);
  border: 1px solid var(--toolbar-border);
  border-radius: 8px;
  padding: 12px 14px;
  margin: 8px 12px;
  max-height: 500px;
  overflow-y: auto;
}

.pp-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  cursor: pointer;
}

.pp-row input[type="checkbox"] {
  cursor: pointer;
}

.pp-row span {
  font-size: 12px;
  color: var(--toolbar-text);
  cursor: pointer;
}

.pp-label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: var(--toolbar-muted);
  margin: 12px 0 6px;
}

.pp-range-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.pp-range {
  flex: 1;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--toolbar-input-border);
  border-radius: 2px;
  cursor: pointer;
}

.pp-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--toolbar-primary-bg);
  cursor: pointer;
  transition: transform 0.1s ease;
}

.pp-range::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}

.pp-range::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--toolbar-primary-bg);
  cursor: pointer;
  border: none;
  transition: transform 0.1s ease;
}

.pp-range::-moz-range-thumb:hover {
  transform: scale(1.2);
}

.pp-range-value {
  font-size: 11px;
  color: var(--toolbar-muted);
  min-width: 48px;
  text-align: right;
}

.pp-select {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--toolbar-input-border);
  border-radius: 4px;
  background: var(--toolbar-input-bg);
  color: var(--toolbar-text);
  font-size: 12px;
  cursor: pointer;
}

.pp-select:focus {
  outline: none;
  border-color: var(--toolbar-primary-bg);
}

.pp-hint {
  font-size: 11px;
  color: var(--toolbar-muted);
  margin: 4px 0 0;
}

.schematic-controls::-webkit-scrollbar {
  width: 6px;
}

.schematic-controls::-webkit-scrollbar-thumb {
  background: var(--toolbar-scrollbar-thumb);
  border-radius: 999px;
}
</style>
