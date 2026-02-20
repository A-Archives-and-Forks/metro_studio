import { ref } from 'vue'
import maplibregl from 'maplibre-gl'

let getMapFn = null
let currentMarkerRemover = null
let mapClickHandler = null

export function setMapGetter(fn) {
  getMapFn = fn
}

function removeCurrentMarker() {
  if (currentMarkerRemover) {
    currentMarkerRemover()
    currentMarkerRemover = null
  }
}

function setupMapClickListener(map) {
  if (mapClickHandler) {
    map.off('click', mapClickHandler)
  }

  mapClickHandler = () => {
    removeCurrentMarker()
    map.off('click', mapClickHandler)
    mapClickHandler = null
  }

  map.on('click', mapClickHandler)
}

export function useMapSearch() {
  const searchVisible = ref(false)
  const mapViewbox = ref(null)

  function openSearchDialog() {
    updateMapViewbox()
    searchVisible.value = true
  }

  function closeSearchDialog() {
    searchVisible.value = false
    mapViewbox.value = null
  }

  function updateMapViewbox() {
    if (!getMapFn) return

    const map = getMapFn()
    if (!map) return

    const bounds = map.getBounds()
    if (!bounds) return

    mapViewbox.value = [
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth(),
    ]
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
    setupMapClickListener(map)

    if (result.name) {
      return `已跳转到: ${result.name}`
    }
    return '已跳转到搜索位置'
  }

  function createMarker(map, lng, lat) {
    const markerEl = document.createElement('div')
    markerEl.className = 'search-marker'
    markerEl.innerHTML = `
      <svg width="160" height="160" viewBox="0 0 160 160" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <line x1="80" y1="20" x2="80" y2="130" stroke="white" stroke-width="24"/>
        <line x1="80" y1="20" x2="80" y2="130" stroke="#ef4444" stroke-width="16"/>
        <polyline points="50 100 80 130 110 100" stroke="white" stroke-width="24"/>
        <polyline points="50 100 80 130 110 100" stroke="#ef4444" stroke-width="16"/>
      </svg>
    `
    markerEl.style.cursor = 'pointer'
    markerEl.style.color = '#ef4444'
    markerEl.style.filter = 'drop-shadow(0 10px 16px rgba(0, 0, 0, 0.3))'

    const marker = new maplibregl.Marker({
      element: markerEl,
      anchor: 'bottom',
    }).setLngLat([lng, lat]).addTo(map)

    const removeMarker = () => {
      marker.remove()
    }

    return removeMarker
  }

  return {
    searchVisible,
    mapViewbox,
    openSearchDialog,
    closeSearchDialog,
    onSearchResultSelect,
  }
}
