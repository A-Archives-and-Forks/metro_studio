<script setup>
defineProps({ visible: Boolean, progress: { type: Number, default: 0 } })
</script>

<template>
  <Transition name="progress-fade">
    <div v-if="visible" class="progress-bar">
      <div class="progress-bar__track">
        <div class="progress-bar__fill" :style="{ width: `${progress}%` }" />
      </div>
      <span class="progress-bar__label">{{ progress }}%</span>
    </div>
  </Transition>
</template>

<style scoped>
.progress-bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; }
.progress-bar__track { flex: 1; height: 4px; background: var(--toolbar-divider); border-radius: 2px; overflow: hidden; }
.progress-bar__fill { height: 100%; background: var(--toolbar-primary-bg); border-radius: 2px; transition: width 0.3s ease; }
.progress-bar__label { font-size: 11px; color: var(--toolbar-muted); min-width: 36px; text-align: right; }

.progress-fade-enter-active, .progress-fade-leave-active { transition: all 0.12s ease; }
.progress-fade-enter-from, .progress-fade-leave-to { opacity: 0; transform: translateY(-8px); }
</style>
