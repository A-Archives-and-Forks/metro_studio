import { ref } from 'vue'

let getMapFn = null

export function setMapGetter(fn) {
  getMapFn = fn
}

export function useMapSearch() {
  const searchVisible = ref(false)

  function openSearchDialog() {
    searchVisible.value = true
  }

  function closeSearchDialog() {
    searchVisible.value = false
  }

  function onSearchResultSelect(result) {
    if (!result || !result.lngLat || !getMapFn) return

    const map = getMapFn()
    if (!map) return

    const [lng, lat] = result.lngLat
    const zoom = 15

    map.easeTo({
      center: [lng, lat],
      zoom,
      duration: 1000,
    })

    if (result.name) {
      return `已跳转到: ${result.name}`
    }
    return '已跳转到搜索位置'
  }

  return {
    searchVisible,
    openSearchDialog,
    closeSearchDialog,
    onSearchResultSelect,
  }
}
