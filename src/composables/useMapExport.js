import { LAYER_STATIONS } from '../components/map-editor/constants'
import { collectProjectBounds, sanitizeFileName } from '../components/map-editor/dataBuilders'
import { isTrial, TRIAL_LIMITS } from './useLicense'

/**
 * PNG export full workflow for the map editor.
 *
 * @param {Object} deps
 * @param {import('pinia').Store} deps.store - The project store
 * @param {() => maplibregl.Map|null} deps.getMap - Getter for the map instance
 */
export function useMapExport({ store, getMap }) {
  function traceActualExport(step, payload) {
    const suffix = payload == null ? '' : ` ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`
    store.statusText = `[实际走向图导出] ${step}${suffix}`
  }

  function waitForMapIdle() {
    const map = getMap()
    if (!map) return Promise.reject(new Error('真实地图未初始化'))
    if (map.loaded() && !map.isMoving()) return Promise.resolve()
    return new Promise((resolve) => {
      map.once('idle', resolve)
    })
  }

  function waitForMapRenderFrame() {
    const map = getMap()
    if (!map) return Promise.reject(new Error('真实地图未初始化'))
    return new Promise((resolve) => {
      map.once('render', resolve)
      map.triggerRepaint()
    })
  }

  async function fitMapToProjectForExport(project) {
    const map = getMap()
    const bounds = collectProjectBounds(project)
    if (!bounds) return

    const lngSpan = Math.abs(bounds.maxLng - bounds.minLng)
    const latSpan = Math.abs(bounds.maxLat - bounds.minLat)
    if (lngSpan < 1e-6 && latSpan < 1e-6) {
      map.jumpTo({
        center: [bounds.minLng, bounds.minLat],
        zoom: Math.max(map.getZoom(), 13.5),
        bearing: 0,
        pitch: 0,
      })
      await waitForMapRenderFrame()
      return
    }

    map.fitBounds(
      [
        [bounds.minLng, bounds.minLat],
        [bounds.maxLng, bounds.maxLat],
      ],
      {
        padding: { top: 52, bottom: 52, left: 52, right: 52 },
        maxZoom: 16,
        bearing: 0,
        pitch: 0,
        duration: 0,
      },
    )
    await waitForMapIdle()
  }

  function canvasToPngBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob)
          return
        }
        reject(new Error('实际走向图导出失败'))
      }, 'image/png')
    })
  }

  async function blobHasVisualContent(blob) {
    try {
      const probe = document.createElement('canvas')
      probe.width = 32
      probe.height = 32
      const context = probe.getContext('2d', { willReadFrequently: true })
      if (!context) return true

      if (typeof createImageBitmap === 'function') {
        const bitmap = await createImageBitmap(blob)
        try {
          context.drawImage(bitmap, 0, 0, probe.width, probe.height)
        } finally {
          bitmap.close?.()
        }
      } else {
        const image = await loadBlobAsImage(blob)
        context.drawImage(image, 0, 0, probe.width, probe.height)
      }

      const { data } = context.getImageData(0, 0, probe.width, probe.height)
      let nonTransparent = 0
      let minLum = 255
      let maxLum = 0

      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3]
        if (alpha <= 8) continue
        nonTransparent += 1
        const lum = Math.round((data[i] + data[i + 1] + data[i + 2]) / 3)
        if (lum < minLum) minLum = lum
        if (lum > maxLum) maxLum = lum
      }

      if (nonTransparent < 40) return false
      return maxLum - minLum > 18
    } catch {
      // If content probing is unsupported in current runtime, do not block export.
      return true
    }
  }

  function loadBlobAsImage(blob) {
    return new Promise((resolve, reject) => {
      const image = new Image()
      const objectUrl = URL.createObjectURL(blob)
      image.onload = () => {
        URL.revokeObjectURL(objectUrl)
        resolve(image)
      }
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl)
        reject(new Error('无法读取导出图像'))
      }
      image.src = objectUrl
    })
  }

  async function captureMapFrameBlob(maxAttempts = 6, stageName = '主流程') {
    const map = getMap()
    traceActualExport('开始抓帧', { stageName, maxAttempts })
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      traceActualExport('抓帧尝试', { stageName, attempt: attempt + 1 })
      await waitForMapRenderFrame()
      await new Promise((resolve) => requestAnimationFrame(resolve))
      const sourceCanvas = map.getCanvas()
      const exportCanvas = document.createElement('canvas')
      exportCanvas.width = sourceCanvas.width
      exportCanvas.height = sourceCanvas.height
      const context = exportCanvas.getContext('2d', { alpha: false })
      if (!context) {
        throw new Error('实际走向图导出失败: 无法创建画布上下文')
      }
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, exportCanvas.width, exportCanvas.height)
      context.drawImage(sourceCanvas, 0, 0)

      const blob = await canvasToPngBlob(exportCanvas)
      if (await blobHasVisualContent(blob)) {
        traceActualExport('抓帧成功', { stageName, attempt: attempt + 1, size: blob.size })
        return blob
      }
      traceActualExport('抓帧结果无有效内容，准备重试', { stageName, attempt: attempt + 1 })
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    traceActualExport('抓帧失败', { stageName })
    return null
  }

  async function exportActualRoutePngFromMap({ project, stationVisibilityMode = 'all' } = {}) {
    const map = getMap()
    if (!map) {
      throw new Error('真实地图未初始化')
    }

    traceActualExport('开始导出')
    const normalizedStationVisibilityMode = ['all', 'interchange', 'none'].includes(stationVisibilityMode)
      ? stationVisibilityMode
      : 'all'
    traceActualExport('应用导出站点模式', normalizedStationVisibilityMode)
    const cameraState = {
      center: map.getCenter(),
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    }
    const labelLayerId = 'railmap-stations-label'
    const stationLayerId = LAYER_STATIONS
    const hasLabelLayer = Boolean(map.getLayer(labelLayerId))
    const hasStationLayer = Boolean(map.getLayer(stationLayerId))
    const previousLabelVisibility = hasLabelLayer ? map.getLayoutProperty(labelLayerId, 'visibility') || 'visible' : 'visible'
    const previousStationVisibility = hasStationLayer ? map.getLayoutProperty(stationLayerId, 'visibility') || 'visible' : 'visible'
    const previousStationFilter = hasStationLayer ? map.getFilter(stationLayerId) : null

    let pngBlob = null
    try {
      traceActualExport('等待地图空闲')
      await waitForMapIdle()
      if (hasLabelLayer) {
        map.setLayoutProperty(labelLayerId, 'text-allow-overlap', true)
        traceActualExport('站名图层启用 allow-overlap')
      }
      if (hasStationLayer) {
        if (normalizedStationVisibilityMode === 'none') {
          map.setLayoutProperty(stationLayerId, 'visibility', 'none')
          traceActualExport('隐藏车站图层')
        } else if (normalizedStationVisibilityMode === 'interchange') {
          map.setLayoutProperty(stationLayerId, 'visibility', 'visible')
          map.setFilter(stationLayerId, ['==', ['get', 'isInterchange'], true])
          traceActualExport('车站图层仅保留换乘站')
        } else {
          map.setLayoutProperty(stationLayerId, 'visibility', 'visible')
          map.setFilter(stationLayerId, null)
          traceActualExport('显示全部车站')
        }
      }
      traceActualExport('定位全网范围')
      await fitMapToProjectForExport(project || store.project)
      pngBlob = await captureMapFrameBlob(6, '主流程')
      if (!pngBlob && map.getLayer('osm-base')) {
        traceActualExport('主流程抓帧失败，尝试隐藏底图回退')
        const previousVisibility = map.getLayoutProperty('osm-base', 'visibility') || 'visible'
        try {
          map.setLayoutProperty('osm-base', 'visibility', 'none')
          pngBlob = await captureMapFrameBlob(4, '隐藏底图回退')
        } finally {
          map.setLayoutProperty('osm-base', 'visibility', previousVisibility)
          await waitForMapRenderFrame()
          traceActualExport('恢复底图可见性')
        }
      }
    } finally {
      try {
        if (hasLabelLayer && map.getLayer(labelLayerId)) {
          map.setLayoutProperty(labelLayerId, 'text-allow-overlap', false)
        }
        if (hasStationLayer && map.getLayer(stationLayerId)) {
          map.setLayoutProperty(stationLayerId, 'visibility', previousStationVisibility)
          map.setFilter(stationLayerId, previousStationFilter || null)
        }
        map.jumpTo({
          center: cameraState.center,
          zoom: cameraState.zoom,
          bearing: cameraState.bearing,
          pitch: cameraState.pitch,
        })
        await waitForMapRenderFrame()
        traceActualExport('恢复原视角完成')
      } catch (restoreError) {
        traceActualExport('恢复阶段异常（不影响下载）', restoreError?.message || String(restoreError))
      }
    }

    if (!pngBlob) {
      traceActualExport('导出失败：未获取到有效图像')
      throw new Error('实际走向图导出失败: 底图帧不可读，请稍后重试')
    }

    if (isTrial.value) {
      pngBlob = await downsampleBlobTo720p(pngBlob)
    }

    const fileName = `${sanitizeFileName(project?.name || store.project?.name, 'metro-studio')}_实际走向图.png`
    const url = URL.createObjectURL(pngBlob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    traceActualExport('下载已触发', { fileName, size: pngBlob.size })
  }

  async function downsampleBlobTo720p(blob) {
    const img = await loadBlobAsImage(blob)
    if (img.height <= TRIAL_LIMITS.maxExportHeight) return blob
    const ratio = TRIAL_LIMITS.maxExportHeight / img.height
    const w = Math.round(img.width * ratio)
    const h = TRIAL_LIMITS.maxExportHeight
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0, w, h)
    return new Promise(r => c.toBlob(r, 'image/png'))
  }

  return {
    exportActualRoutePngFromMap,
  }
}
