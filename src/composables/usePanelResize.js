import { onBeforeUnmount, ref } from 'vue'

const STORAGE_KEY = 'metro_studio_properties_panel_width'
const DEFAULT_WIDTH = 320
const MIN_WIDTH = 240
const MAX_WIDTH = 520

export function usePanelResize() {
  const width = ref(loadWidth())
  let dragging = false
  let startX = 0
  let startWidth = 0

  function loadWidth() {
    try {
      const saved = Number(window.localStorage.getItem(STORAGE_KEY))
      if (Number.isFinite(saved) && saved >= MIN_WIDTH && saved <= MAX_WIDTH) return saved
    } catch {
      // Ignore unavailable localStorage.
    }
    return DEFAULT_WIDTH
  }

  function saveWidth(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(Math.round(value)))
    } catch {
      // Ignore unavailable localStorage.
    }
  }

  function clamp(value) {
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, value))
  }

  function onPointerDown(event) {
    if (event.button !== 0) return
    event.preventDefault()
    dragging = true
    startX = event.clientX
    startWidth = width.value
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  function onPointerMove(event) {
    if (!dragging) return
    const delta = startX - event.clientX
    width.value = clamp(startWidth + delta)
  }

  function onPointerUp() {
    if (!dragging) return
    dragging = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    saveWidth(width.value)
  }

  onBeforeUnmount(() => {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  })

  return {
    width,
    minWidth: MIN_WIDTH,
    maxWidth: MAX_WIDTH,
    onPointerDown,
  }
}
