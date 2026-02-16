import { reactive } from 'vue'
import {
  LAYER_EDGE_ANCHORS_HIT,
  LAYER_EDGES_HIT,
  LAYER_STATIONS,
} from '../components/map-editor/constants'
import { findEdgePathBetweenStations } from '../components/map-editor/bfsPathFinder'
import { haversineDistanceMeters } from '../lib/geo'

/**
 * Click/drag/keyboard/mouse event handlers and drag/selection state management.
 *
 * @param {Object} deps
 * @param {import('pinia').Store} deps.store - The project store
 * @param {() => maplibregl.Map|null} deps.getMap - Getter for the map instance
 * @param {() => void} deps.closeContextMenu - Function to close the context menu
 * @param {() => void} deps.closeAiStationMenu - Function to close the AI station menu
 * @param {() => void} deps.closeLineSelectionMenu - Function to close the line selection menu
 * @param {(event: Object) => void} deps.openContextMenu - Function to open the context menu
 * @param {(event: Object) => void} deps.updateRouteDrawPreview - Function to update route draw preview
 * @param {() => void} deps.clearRouteDrawPreview - Function to clear route draw preview
 * @param {(lngLat: number[], screenPoint: Object) => void} deps.addAiStationAt - Function to add AI station
 * @param {(opts: Object) => void} deps.requestAiCandidatesForStation - Function to request AI candidates
 * @param {(opts: Object) => void} deps.openLineSelectionMenu - Function to open line selection menu
 * @param {() => void} deps.refreshRouteDrawPreviewProjectedPoints - Function to refresh route draw preview projected points
 * @param {import('vue').Reactive} deps.contextMenu - The context menu reactive state (for aiStationMenu visibility check)
 * @param {import('vue').Reactive} deps.aiStationMenu - The AI station menu reactive state
 */
export function useMapEventHandlers({
  store,
  getMap,
  closeContextMenu,
  closeAiStationMenu,
  closeLineSelectionMenu,
  openContextMenu,
  updateRouteDrawPreview,
  clearRouteDrawPreview,
  addAiStationAt,
  requestAiCandidatesForStation,
  openLineSelectionMenu,
  refreshRouteDrawPreviewProjectedPoints,
  contextMenu,
  aiStationMenu,
}) {
  let dragState = null
  let anchorDragState = null
  let suppressNextMapClick = false

  const selectionBox = reactive({
    active: false,
    append: false,
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
  })

  function isLineDrawMode() {
    return store.mode === 'add-edge' || store.mode === 'route-draw'
  }

  function handleStationClick(event) {
    if (store.navigation?.active) return
    closeContextMenu()
    closeAiStationMenu()
    suppressNextMapClick = true
    const stationId = event.features?.[0]?.properties?.id
    if (!stationId) return

    // 删除模式
    if (store.mode === 'delete-mode') {
      const mouseEvent = event.originalEvent
      const isMultiModifier = Boolean(mouseEvent?.shiftKey || mouseEvent?.ctrlKey || mouseEvent?.metaKey)
      if (isMultiModifier) {
        // 批量删除：添加到选择然后删除
        store.selectStation(stationId, { multi: true })
      } else {
        // 单独删除
        store.deleteStation(stationId)
        store.statusText = `已删除站点: ${stationId}`
      }
      return
    }

    // 样式刷模式
    if (store.mode === 'style-brush') {
      if (store.styleBrush.active) {
        // 如果已经拾取了样式，应用到当前站点
        if (store.styleBrush.sourceType === 'station') {
          store.applyStyleToStation(stationId)
        } else {
          store.statusText = '只能应用站点样式到站点'
        }
      } else {
        // 尚未拾取样式，从当前站点拾取
        const mouseEvent = event.originalEvent
        const isMultiModifier = Boolean(mouseEvent?.shiftKey || mouseEvent?.ctrlKey || mouseEvent?.metaKey)
        if (isMultiModifier && store.selectedStationIds.includes(stationId)) {
          // 多选站点时，只从主选站点拾取
          store.activateStyleBrush(store.selectedStationIds[store.selectedStationIds.length - 1], 'station')
        } else {
          store.activateStyleBrush(stationId, 'station')
        }
      }
      return
    }

    if (store.mode === 'ai-add-station') {
      const station = store.project?.stations?.find((item) => item.id === stationId)
      if (!station?.lngLat) return
      void requestAiCandidatesForStation({
        lngLat: [...station.lngLat],
        stationId: station.id,
        screenPoint: event.point,
      })
      return
    }
    if (store.mode === 'route-draw') {
      store.selectStation(stationId)
      return
    }

    // 快速连线模式
    if (store.mode === 'quick-link') {
      if (!store.quickLinkStartStationId) {
        // 第一次点击：设置起点
        store.quickLinkStartStationId = stationId
        const station = store.project?.stations?.find((s) => s.id === stationId)
        store.statusText = `快速连线起点: ${station?.nameZh || stationId}，请点击终点`
      } else {
        // 第二次点击：连线
        if (store.quickLinkStartStationId === stationId) {
          // 点击同一个站点，重新选择起点
          const station = store.project?.stations?.find((s) => s.id === stationId)
          store.statusText = `已重新选择起点: ${station?.nameZh || stationId}`
          return
        }
        store.addEdgeBetweenStations(store.quickLinkStartStationId, stationId)
        // 连线后，第二个站点成为新的起点
        store.quickLinkStartStationId = stationId
        const station = store.project?.stations?.find((s) => s.id === stationId)
        store.statusText = `已连线，新起点: ${station?.nameZh || stationId}`
      }
      return
    }

    // 测量模式
    if (store.mode === 'measure') {
      const station = store.project?.stations?.find((s) => s.id === stationId)
      if (!station?.lngLat) return

      if (store.measure.points.length === 0) {
        // 第一个点：起点
        store.measure.points.push({ stationId, lngLat: station.lngLat })
        store.statusText = `测量起点: ${station?.nameZh || stationId}，请点击终点`
      } else {
        // 后续点：计算距离
        const lastPoint = store.measure.points[store.measure.points.length - 1]
        const distance = haversineDistanceMeters(lastPoint.lngLat, station.lngLat)
        store.measure.totalMeters += distance
        store.measure.points.push({ stationId, lngLat: station.lngLat })
        const totalKm = (store.measure.totalMeters / 1000).toFixed(2)
        store.statusText = `累计距离: ${totalKm} km (${store.measure.totalMeters.toFixed(0)} 米)`
      }
      return
    }
    const mouseEvent = event.originalEvent
    const isShift = Boolean(mouseEvent?.shiftKey)
    const isMultiModifier = Boolean(isShift || mouseEvent?.ctrlKey || mouseEvent?.metaKey)

    // Shift+click two stations -> select all edges on the path between them
    if (isShift && store.mode === 'select' && store.selectedStationIds.length === 1 && store.selectedStationIds[0] !== stationId) {
      const fromId = store.selectedStationIds[0]
      const edges = store.project?.edges
      const pathEdgeIds = findEdgePathBetweenStations(edges, fromId, stationId)
      if (pathEdgeIds.length) {
        store.setSelectedEdges(pathEdgeIds, { keepStations: false })
        store.setSelectedStations([fromId, stationId], { keepEdges: true })
        store.statusText = `已选中路径上 ${pathEdgeIds.length} 条线段`
        return
      }
    }

    store.selectStation(stationId, {
      multi: isMultiModifier && store.mode === 'select',
      toggle: isMultiModifier && store.mode === 'select',
    })
  }

  function handleEdgeClick(event) {
    if (store.navigation?.active) return
    const map = getMap()
    closeContextMenu()
    suppressNextMapClick = true
    if (!map) return
    if (isLineDrawMode()) return
    const overlappingStations = map.queryRenderedFeatures(event.point, { layers: [LAYER_STATIONS] })
    if (overlappingStations.length) return
    const edgeId = event.features?.[0]?.properties?.id
    if (!edgeId) return
    const mouseEvent = event.originalEvent

    // 删除模式
    if (store.mode === 'delete-mode') {
      const isMultiModifier = Boolean(mouseEvent?.shiftKey || mouseEvent?.ctrlKey || mouseEvent?.metaKey)
      if (isMultiModifier) {
        // 批量删除：添加到选择然后删除
        store.selectEdge(edgeId, { multi: true })
      } else {
        // 单独删除
        store.deleteEdge(edgeId)
        store.statusText = `已删除线段: ${edgeId}`
      }
      return
    }

    // 样式刷模式
    if (store.mode === 'style-brush') {
      if (store.styleBrush.active) {
        // 如果已经拾取了样式，应用到当前线段
        if (store.styleBrush.sourceType === 'edge') {
          store.applyStyleToEdge(edgeId)
        } else {
          store.statusText = '只能应用线段样式到线段'
        }
      } else {
        // 尚未拾取样式，从当前线段拾取
        const isMultiModifier = Boolean(mouseEvent?.shiftKey || mouseEvent?.ctrlKey || mouseEvent?.metaKey)
        if (isMultiModifier && store.selectedEdgeIds.includes(edgeId)) {
          // 多选线段时，只从主选线段拾取
          store.activateStyleBrush(store.selectedEdgeIds[store.selectedEdgeIds.length - 1], 'edge')
        } else {
          store.activateStyleBrush(edgeId, 'edge')
        }
      }
      return
    }

    if (mouseEvent?.altKey) {
      const edge = store.project?.edges?.find((e) => e.id === edgeId)
      if (!edge?.sharedByLineIds?.length) return
      if (edge.sharedByLineIds.length === 1) {
        store.selectLine(edge.sharedByLineIds[0])
      } else {
        const lineOptions = edge.sharedByLineIds
          .map((lineId) => {
            const line = store.project.lines.find((l) => l.id === lineId)
            if (!line) return null
            return {
              id: line.id,
              nameZh: line.nameZh,
              nameEn: line.nameEn,
              color: line.color,
            }
          })
          .filter(Boolean)
        if (lineOptions.length) {
          openLineSelectionMenu({ x: event.point.x, y: event.point.y, lineOptions })
        }
      }
      return
    }
    if (store.mode !== 'select') {
      store.setMode('select')
    }
    const isMultiModifier = Boolean(mouseEvent?.shiftKey || mouseEvent?.ctrlKey || mouseEvent?.metaKey)
    store.selectEdge(edgeId, {
      multi: isMultiModifier,
      toggle: isMultiModifier,
      keepStationSelection: isMultiModifier,
    })
    const selectedCount = store.selectedEdgeIds?.length || 0
    store.statusText = selectedCount > 1 ? `已选中线段 ${selectedCount} 条` : `已选中线段: ${edgeId}`
  }

  function handleEdgeAnchorClick(event) {
    if (store.navigation?.active) return
    closeContextMenu()
    suppressNextMapClick = true
    if (isLineDrawMode()) return
    const edgeId = event.features?.[0]?.properties?.edgeId
    const anchorIndexRaw = event.features?.[0]?.properties?.anchorIndex
    const anchorIndex = Number(anchorIndexRaw)
    if (!edgeId || !Number.isInteger(anchorIndex)) return
    if (store.mode !== 'select') {
      store.setMode('select')
    }
    store.selectEdgeAnchor(edgeId, anchorIndex)
    store.statusText = `已选中锚点: ${edgeId} #${anchorIndex}`
  }

  function handleMapClick(event) {
    if (store.navigation?.active) return
    const map = getMap()
    closeContextMenu()
    closeAiStationMenu()
    if (!map) return
    if (suppressNextMapClick) {
      suppressNextMapClick = false
      return
    }
    const hitAnchors = map.queryRenderedFeatures(event.point, { layers: [LAYER_EDGE_ANCHORS_HIT] })
    const hitStations = map.queryRenderedFeatures(event.point, { layers: [LAYER_STATIONS] })
    const hitEdges = map.queryRenderedFeatures(event.point, { layers: [LAYER_EDGES_HIT] })
    if (hitAnchors.length) return
    if (hitStations.length) return
    if (hitEdges.length) return
    if (store.mode === 'add-station') {
      store.addStationAt([event.lngLat.lng, event.lngLat.lat])
      return
    }
    if (store.mode === 'ai-add-station') {
      void addAiStationAt([event.lngLat.lng, event.lngLat.lat], event.point)
      return
    }
    if (store.mode === 'route-draw') {
      const station = store.addStationAt([event.lngLat.lng, event.lngLat.lat])
      if (station?.id) {
        store.selectStation(station.id)
      }
      return
    }
    // 样式刷模式下，空白点击退出
    if (store.mode === 'style-brush') {
      store.deactivateStyleBrush()
      return
    }
    // 快速连线模式下，空白点击退出
    if (store.mode === 'quick-link') {
      store.quickLinkStartStationId = null
      store.statusText = '快速连线已取消'
      return
    }
    // 测量模式下，空白点击重置
    if (store.mode === 'measure') {
      if (store.measure.points.length > 0) {
        store.measure.points = []
        store.measure.totalMeters = 0
        store.statusText = '测量已重置，请点击第一个点'
      }
      return
    }
    // 注释模式下，空白点击添加注释
    if (store.mode === 'annotation') {
      store.addAnnotation([event.lngLat.lng, event.lngLat.lat], '新注释')
      store.statusText = '已添加注释，可在属性面板编辑内容'
      return
    }
    if (store.mode === 'select') {
      const mouseEvent = event.originalEvent
      const keepSelection = Boolean(mouseEvent?.shiftKey || mouseEvent?.ctrlKey || mouseEvent?.metaKey)
      if (!keepSelection) {
        store.clearSelection()
      }
    }
  }

  function handleMapContextMenu(event) {
    const map = getMap()
    if (!map) return
    event.originalEvent?.preventDefault()
    openContextMenu(event)
  }

  function startStationDrag(event) {
    if (store.navigation?.active) return
    const map = getMap()
    closeContextMenu()
    closeAiStationMenu()
    if (store.mode !== 'select') return
    const stationId = event.features?.[0]?.properties?.id
    if (!stationId) return
    const mouseEvent = event.originalEvent
    if (mouseEvent?.shiftKey || mouseEvent?.ctrlKey || mouseEvent?.metaKey) {
      return
    }

    if (!store.selectedStationIds.includes(stationId)) {
      store.selectStation(stationId)
    }
    const stationIds = store.selectedStationIds.includes(stationId) ? [...store.selectedStationIds] : [stationId]
    dragState = {
      stationIds,
      lastLngLat: [event.lngLat.lng, event.lngLat.lat],
    }
    map.getCanvas().style.cursor = 'grabbing'
    map.dragPan.disable()
  }

  function startEdgeAnchorDrag(event) {
    const map = getMap()
    closeContextMenu()
    closeAiStationMenu()
    if (store.mode !== 'select') return
    const edgeId = event.features?.[0]?.properties?.edgeId
    const anchorIndexRaw = event.features?.[0]?.properties?.anchorIndex
    const anchorIndex = Number(anchorIndexRaw)
    if (!edgeId || !Number.isInteger(anchorIndex)) return

    store.selectEdgeAnchor(edgeId, anchorIndex)
    anchorDragState = {
      edgeId,
      anchorIndex,
    }
    map.getCanvas().style.cursor = 'grabbing'
    map.dragPan.disable()
    suppressNextMapClick = true
  }

  function onMouseMove(event) {
    if (store.mode === 'route-draw' && !selectionBox.active && !dragState && !anchorDragState) {
      updateRouteDrawPreview(event)
    } else {
      clearRouteDrawPreview()
    }

    if (selectionBox.active) {
      selectionBox.endX = event.point.x
      selectionBox.endY = event.point.y
    }

    if (anchorDragState) {
      store.updateEdgeAnchor(anchorDragState.edgeId, anchorDragState.anchorIndex, [event.lngLat.lng, event.lngLat.lat])
      return
    }

    if (!dragState) return
    const delta = [event.lngLat.lng - dragState.lastLngLat[0], event.lngLat.lat - dragState.lastLngLat[1]]
    dragState.lastLngLat = [event.lngLat.lng, event.lngLat.lat]
    store.moveStationsByDelta(dragState.stationIds, delta)
  }

  function stopStationDrag() {
    const map = getMap()

    if (selectionBox.active) {
      const minX = Math.min(selectionBox.startX, selectionBox.endX)
      const maxX = Math.max(selectionBox.startX, selectionBox.endX)
      const minY = Math.min(selectionBox.startY, selectionBox.endY)
      const maxY = Math.max(selectionBox.startY, selectionBox.endY)

      const selectionBounds = [
        [minX, minY],
        [maxX, maxY],
      ]
      const pickedStationIds = [
        ...new Set(
          map
            .queryRenderedFeatures(selectionBounds, { layers: [LAYER_STATIONS] })
            .map((feature) => String(feature?.properties?.id || '').trim())
            .filter(Boolean),
        ),
      ]
      const pickedEdgeIds = [
        ...new Set(
          map
            .queryRenderedFeatures(selectionBounds, { layers: [LAYER_EDGES_HIT] })
            .map((feature) => String(feature?.properties?.id || '').trim())
            .filter(Boolean),
        ),
      ]

      // 样式刷批量应用
      if (store.styleBrush.active) {
        if (store.styleBrush.sourceType === 'station' && pickedStationIds.length) {
          store.applyStyleToStations(pickedStationIds)
        } else if (store.styleBrush.sourceType === 'edge' && pickedEdgeIds.length) {
          store.applyStyleToEdges(pickedEdgeIds)
        }
      } else {
        // 正常框选模式
        if (pickedStationIds.length || pickedEdgeIds.length) {
          if (selectionBox.append) {
            if (pickedStationIds.length) {
              store.selectStations(pickedStationIds, { replace: false, keepEdges: true })
            }
            if (pickedEdgeIds.length) {
              store.selectEdges(pickedEdgeIds, { replace: false, keepStations: true })
            }
          } else if (pickedStationIds.length && pickedEdgeIds.length) {
            store.setSelectedStations(pickedStationIds, { keepEdges: true })
            store.setSelectedEdges(pickedEdgeIds, { keepStations: true })
          } else if (pickedStationIds.length) {
            store.setSelectedStations(pickedStationIds)
          } else {
            store.setSelectedEdges(pickedEdgeIds)
          }
        } else if (!selectionBox.append) {
          store.clearSelection()
        }
      }
      suppressNextMapClick = true

      selectionBox.active = false
      map.getCanvas().style.cursor = ''
      map.dragPan.enable()
    }

    if (anchorDragState) {
      anchorDragState = null
      map.getCanvas().style.cursor = ''
      map.dragPan.enable()
    }

    if (dragState) {
      dragState = null
      map.getCanvas().style.cursor = ''
      map.dragPan.enable()
    }
  }

  function startBoxSelection(event) {
    const map = getMap()
    closeContextMenu()
    closeAiStationMenu()
    if (store.mode !== 'select' && store.mode !== 'box-select') return
    if (selectionBox.active) return
    const mouseEvent = event.originalEvent
    if (mouseEvent?.button !== 0) return
    const modifier = Boolean(mouseEvent?.shiftKey || mouseEvent?.ctrlKey || mouseEvent?.metaKey)
    if (!modifier && store.mode !== 'box-select') return

    const hitAnchors = map.queryRenderedFeatures(event.point, { layers: [LAYER_EDGE_ANCHORS_HIT] })
    const hitStations = map.queryRenderedFeatures(event.point, { layers: [LAYER_STATIONS] })
    const hitEdges = map.queryRenderedFeatures(event.point, { layers: [LAYER_EDGES_HIT] })
    if (hitAnchors.length) return
    if (hitStations.length) return
    if (hitEdges.length) return

    selectionBox.active = true
    selectionBox.append = modifier
    selectionBox.startX = event.point.x
    selectionBox.startY = event.point.y
    selectionBox.endX = event.point.x
    selectionBox.endY = event.point.y
    map.getCanvas().style.cursor = 'crosshair'
    map.dragPan.disable()
  }

  function onInteractiveFeatureEnter() {
    const map = getMap()
    if (!map || selectionBox.active || dragState || anchorDragState) return
    map.getCanvas().style.cursor = 'pointer'
  }

  function onInteractiveFeatureLeave() {
    const map = getMap()
    if (!map || selectionBox.active || dragState || anchorDragState) return
    map.getCanvas().style.cursor = ''
  }

  function handleWindowResize(adjustContextMenuPosition, adjustAiStationMenuPosition) {
    const map = getMap()
    if (map) {
      map.resize()
    }
    if (contextMenu.visible) {
      adjustContextMenuPosition()
    }
    if (aiStationMenu.visible) {
      adjustAiStationMenuPosition()
    }
  }

  return {
    selectionBox,
    handleStationClick,
    handleEdgeClick,
    handleEdgeAnchorClick,
    handleMapClick,
    handleMapContextMenu,
    startStationDrag,
    startEdgeAnchorDrag,
    onMouseMove,
    stopStationDrag,
    startBoxSelection,
    onInteractiveFeatureEnter,
    onInteractiveFeatureLeave,
    handleWindowResize,
  }
}
