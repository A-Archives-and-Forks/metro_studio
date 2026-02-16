import { ref } from 'vue'
import { ANIMATION_CONFIG } from '../lib/animation/config.js'

export function useAnimationSettings() {
  const enabled = ref(true)

  function loadSettings() {
    try {
      const saved = localStorage.getItem(ANIMATION_CONFIG.storageKey)
      if (saved !== null) enabled.value = saved === 'true'
    } catch { }
  }

  function toggleAnimation(value) {
    enabled.value = value ?? !enabled.value
    try {
      localStorage.setItem(ANIMATION_CONFIG.storageKey, enabled.value)
    } catch { }
  }

  function getAutoAnimateConfig() {
    if (!enabled.value) return { duration: 0 }
    return {
      duration: ANIMATION_CONFIG.duration.fast,
      easing: ANIMATION_CONFIG.easing,
    }
  }

  loadSettings()
  return { enabled, toggleAnimation, getAutoAnimateConfig }
}
