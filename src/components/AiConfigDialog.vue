<script setup>
import { nextTick, ref, watch } from 'vue'
import { getAiConfig, setAiConfig } from '../lib/ai/aiConfig.js'

const props = defineProps({
  visible: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'save'])

const dialogRef = ref(null)
const baseUrlInputRef = ref(null)
const apiKeyInputRef = ref(null)

const baseUrl = ref('')
const apiKey = ref('')

function loadConfig() {
  const config = getAiConfig()
  baseUrl.value = config.baseUrl
  apiKey.value = config.apiKey
}

function doSave() {
  const trimmedBaseUrl = String(baseUrl.value || '').trim()
  const trimmedApiKey = String(apiKey.value || '').trim()

  if (!trimmedBaseUrl) {
    baseUrlInputRef.value?.focus()
    return
  }

  const success = setAiConfig({
    baseUrl: trimmedBaseUrl,
    apiKey: trimmedApiKey,
  })

  if (success) {
    emit('save')
    emit('close')
  }
}

function doCancel() {
  emit('close')
}

function onKeydown(e) {
  if (e.key === 'Escape') {
    doCancel()
  }
  if (e.key === 'Enter') {
    if (e.target === baseUrlInputRef.value || e.target === apiKeyInputRef.value) {
      doSave()
    }
  }
  if (e.key === 'Tab' && dialogRef.value) {
    const focusable = dialogRef.value.querySelectorAll(
      'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault()
        last.focus()
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }
}

watch(
  () => props.visible,
  async (visible) => {
    if (visible) {
      loadConfig()
      await nextTick()
      if (apiKey.value) {
        baseUrlInputRef.value?.focus()
      } else {
        baseUrlInputRef.value?.focus()
      }
    }
  }
)
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog-transition">
      <div
        v-if="visible"
        class="ai-config-overlay"
        @mousedown.self="doCancel"
        @keydown="onKeydown"
      >
        <div
          ref="dialogRef"
          class="ai-config-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="AI 配置"
        >
          <header class="ai-config-dialog__header">
            <h2 class="ai-config-dialog__title">AI 配置</h2>
          </header>
          <div class="ai-config-dialog__body">
            <div class="ai-config-dialog__field">
              <label class="ai-config-dialog__label" for="ai-config-base-url">API Base URL</label>
              <input
                id="ai-config-base-url"
                ref="baseUrlInputRef"
                v-model="baseUrl"
                type="text"
                class="pp-input ai-config-dialog__input"
                placeholder="https://api.bltcy.ai"
              />
              <p class="ai-config-dialog__hint">兼容 OpenAI 格式的 API 地址</p>
            </div>
            <div class="ai-config-dialog__field">
              <label class="ai-config-dialog__label" for="ai-config-api-key">API Key</label>
              <input
                id="ai-config-api-key"
                ref="apiKeyInputRef"
                v-model="apiKey"
                type="password"
                class="pp-input ai-config-dialog__input"
                placeholder="sk-..."
              />
              <p class="ai-config-dialog__hint">用于 AI 站点命名和翻译功能</p>
            </div>
          </div>
          <footer class="ai-config-dialog__footer">
            <button
              class="ai-config-dialog__btn ai-config-dialog__btn--cancel"
              type="button"
              @click="doCancel"
            >
              取消
            </button>
            <button
              class="ai-config-dialog__btn ai-config-dialog__btn--primary"
              type="button"
              @click="doSave"
            >
              保存
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ai-config-overlay {
  position: fixed;
  inset: 0;
  z-index: 9500;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
}

.ai-config-dialog {
  width: 440px;
  max-width: calc(100vw - 32px);
  background: var(--toolbar-card-bg);
  border: 1px solid var(--toolbar-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ai-config-dialog__header {
  padding: 16px 20px 0;
}

.ai-config-dialog__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--toolbar-text);
  line-height: 1.4;
}

.ai-config-dialog__body {
  padding: 14px 20px 4px;
}

.ai-config-dialog__field {
  margin-bottom: 16px;
}

.ai-config-dialog__field:last-child {
  margin-bottom: 0;
}

.ai-config-dialog__label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--toolbar-text);
}

.ai-config-dialog__input {
  width: 100%;
  box-sizing: border-box;
}

.ai-config-dialog__hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--toolbar-muted);
  line-height: 1.4;
}

.ai-config-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 20px 16px;
}

.ai-config-dialog__btn {
  padding: 7px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all var(--transition-normal);
  outline: none;
}

.ai-config-dialog__btn:focus-visible {
  box-shadow: var(--focus-ring);
}

.ai-config-dialog__btn--cancel {
  background: var(--toolbar-button-bg);
  border-color: var(--toolbar-button-border);
  color: var(--toolbar-button-text);
}

.ai-config-dialog__btn--cancel:hover {
  border-color: var(--toolbar-button-hover-border);
}

.ai-config-dialog__btn--primary {
  background: linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%);
  border-color: var(--toolbar-primary-border);
  color: #fff;
}

.ai-config-dialog__btn--primary:hover {
  background: linear-gradient(180deg, #3b82f6 0%, #2563eb 100%);
  box-shadow: 0 2px 8px rgba(29, 78, 216, 0.35);
}
</style>
