<script setup>
import { computed } from 'vue'
import { useProjectStore } from '../../stores/projectStore'
import IconBase from '../IconBase.vue'
import TooltipWrapper from '../TooltipWrapper.vue'

const store = useProjectStore()

const annotations = computed(() => store.project?.annotations || [])

const annotationText = computed(() => {
  return annotations.value.find((a) => a.id === store.selectedAnnotationId)?.text || ''
})

function updateAnnotationText(text) {
  if (store.selectedAnnotationId) {
    store.updateAnnotationText(store.selectedAnnotationId, text)
  }
}

function deleteAnnotation() {
  if (store.selectedAnnotationId) {
    store.deleteAnnotation(store.selectedAnnotationId)
    store.selectedAnnotationId = null
  }
}
</script>

<template>
  <div class="panel-annotation">
    <div class="panel-section">
      <h4 class="panel-section__title">注释列表</h4>
      <div class="annotation-list">
        <div
          v-for="anno in annotations"
          :key="anno.id"
          class="annotation-item"
          :class="{ active: anno.id === store.selectedAnnotationId }"
          @click="store.selectedAnnotationId = anno.id"
        >
          <div class="annotation-item__text">{{ anno.text || '(无内容)' }}</div>
          <div class="annotation-item__actions">
            <TooltipWrapper text="删除" placement="left">
              <button class="annotation-item__btn" type="button" @click.stop="deleteAnnotation">
                <IconBase name="x" :size="14" />
              </button>
            </TooltipWrapper>
          </div>
        </div>
        <div v-if="!annotations.length" class="annotation-empty">暂无注释</div>
      </div>
    </div>

    <div v-if="store.selectedAnnotationId" class="panel-section">
      <h4 class="panel-section__title">编辑注释</h4>
      <textarea
        :value="annotationText"
        @input="updateAnnotationText($event.target.value)"
        class="panel-input panel-textarea"
        placeholder="输入注释内容..."
        rows="4"
      />
    </div>

    <div class="panel-section">
      <button class="panel-btn panel-btn--danger" @click="store.clearAnnotations()">清空所有注释</button>
    </div>
  </div>
</template>

<style scoped>
.panel-annotation {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.panel-section__title {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--toolbar-text);
}

.annotation-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 300px;
  overflow-y: auto;
}

.annotation-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border: 1px solid var(--toolbar-input-border);
  border-radius: 8px;
  background: var(--toolbar-item-bg);
  cursor: pointer;
  transition: all 0.1s ease;
}

.annotation-item:hover {
  border-color: var(--toolbar-button-hover-border);
}

.annotation-item.active {
  border-color: var(--toolbar-primary-bg);
  background: var(--toolbar-tab-active-bg);
}

.annotation-item__text {
  flex: 1;
  font-size: 12px;
  color: var(--toolbar-text);
  word-break: break-word;
  min-width: 0;
}

.annotation-item__actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.annotation-item__btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--toolbar-muted);
  cursor: pointer;
  transition: all 0.1s ease;
}

.annotation-item__btn:hover {
  background: rgba(0, 0, 0, 0.08);
  color: var(--toolbar-text);
}

.annotation-empty {
  padding: 20px;
  text-align: center;
  color: var(--toolbar-muted);
  font-size: 12px;
}

.panel-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--toolbar-input-border);
  border-radius: 8px;
  background: var(--toolbar-input-bg);
  color: var(--toolbar-text);
  font-size: 13px;
  transition: all 0.15s ease;
}

.panel-input:focus {
  outline: none;
  border-color: var(--toolbar-active-border);
}

.panel-textarea {
  resize: vertical;
  min-height: 80px;
  font-family: inherit;
}

.panel-btn {
  width: 100%;
  padding: 8px 12px;
  border: none;
  border-radius: 8px;
  background: var(--toolbar-input-bg);
  color: var(--toolbar-text);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.1s ease;
}

.panel-btn--danger {
  background: #FEE2E2;
  color: #DC2626;
}

.panel-btn--danger:hover {
  background: #FECACA;
}
</style>
