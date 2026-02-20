import { ref } from 'vue'

let getMapFn = null
let currentMarkerRemover = null

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

    if (currentMarkerRemover) {
      currentMarkerRemover()
      currentMarkerRemover = null
    }

    map.easeTo({
      center: [lng, lat],
      zoom,
      duration: 1000,
    })

    currentMarkerRemover = createMarker(map, lng, lat)

    if (result.name) {
      return `已跳转到: ${result.name}`
    }
    return '已跳转到搜索位置'
  }

  function createMarker(map, lng, lat) {
    const markerEl = document.createElement('div')
    markerEl.className = 'search-marker'
    markerEl.innerHTML = `
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
        <circle cx="12" cy="10" r="3"/>
      </svg>
    `
    markerEl.style.cursor = 'pointer'
    markerEl.style.color = '#ef4444'

    const marker = new maplibregl.Marker({
      element: markerEl,
      anchor: 'bottom',
    }).setLngLat([lng, lat]).addTo(map)

    const removeMarker = () => {
      marker.remove()
    }

    markerEl.addEventListener('click', () => {
      removeMarker()
      if (currentMarkerRemover === removeMarker) {
        currentMarkerRemover = null
      }
    })

    return removeMarker
  }

  return {
    searchVisible,
    openSearchDialog,
    closeSearchDialog,
    onSearchResultSelect,
  }
}
