import { nextTick, reactive } from 'vue'

/**
 * Line selection menu state and logic for edges shared by multiple lines.
 *
 * @param {Object} deps
 * @param {import('pinia').Store} deps.store - The project store
 * @param {import('vue').Ref<HTMLElement|null>} deps.mapContainerRef - Ref to the map container element
 * @param {() => void} deps.closeContextMenu - Function to close the context menu
 */
export function useMapLineSelectionMenu({ store, mapContainerRef, closeContextMenu }) {
  const lineSelectionMenu = reactive({
    visible: false,
    x: 0,
    y: 0,
    lineOptions: [],
    stationsOnly: false,
  })

  function closeLineSelectionMenu() {
    lineSelectionMenu.visible = false
    lineSelectionMenu.lineOptions = []
  }

  async function adjustLineSelectionMenuPosition() {
    await nextTick()
    if (!mapContainerRef.value || !lineSelectionMenu.visible) return
    const menuWidth = 268
    const menuHeight = Math.min(lineSelectionMenu.lineOptions.length * 60 + 80, 400)
    const containerRect = mapContainerRef.value.getBoundingClientRect()
    const padding = 8
    const maxX = Math.max(padding, containerRect.width - menuWidth - padding)
    const maxY = Math.max(padding, containerRect.height - menuHeight - padding)
    lineSelectionMenu.x = Math.max(padding, Math.min(lineSelectionMenu.x, maxX))
    lineSelectionMenu.y = Math.max(padding, Math.min(lineSelectionMenu.y, maxY))
  }

  function openLineSelectionMenu({ x, y, lineOptions, stationsOnly = false }) {
    closeContextMenu()
    lineSelectionMenu.visible = true
    lineSelectionMenu.x = Number.isFinite(x) ? x : 0
    lineSelectionMenu.y = Number.isFinite(y) ? y : 0
    lineSelectionMenu.lineOptions = Array.isArray(lineOptions) ? lineOptions : []
    lineSelectionMenu.stationsOnly = stationsOnly
    adjustLineSelectionMenuPosition()
  }

  function selectLineFromMenu(lineId) {
    if (lineSelectionMenu.stationsOnly) {
      store.selectLineStationsOnly(lineId)
    } else {
      store.selectLine(lineId)
    }
    closeLineSelectionMenu()
  }

  function onLineSelectionMenuOverlayMouseDown(event) {
    if (event.button !== 0 && event.button !== 2) return
    closeLineSelectionMenu()
  }

  return {
    lineSelectionMenu,
    closeLineSelectionMenu,
    openLineSelectionMenu,
    selectLineFromMenu,
    onLineSelectionMenuOverlayMouseDown,
  }
}
