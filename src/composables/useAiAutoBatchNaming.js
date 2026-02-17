import { computed, onBeforeUnmount, reactive } from 'vue'
import { generateStationNameCandidates } from '../lib/ai/stationNaming'
import { fetchNearbyStationNamingContext, STATION_NAMING_RADIUS_METERS } from '../lib/osm/nearbyStationNamingContext'
import { useProjectStore } from '../stores/projectStore'

const AI_AUTO_CONTEXT_CONCURRENCY = 1
const AI_AUTO_NAMING_CONCURRENCY = 1
const AI_AUTO_CONTEXT_DELAY_MS = 2000

function chunkArray(items, chunkSize) {
  const source = Array.isArray(items) ? items : []
  const size = Math.max(1, Number(chunkSize) || 1)
  const chunks = []
  for (let index = 0; index < source.length; index += size) {
    chunks.push(source.slice(index, index + size))
  }
  return chunks
}

function isAbortError(error) {
  const message = String(error?.message || '').toLowerCase()
  return error?.name === 'AbortError' || message.includes('aborted') || message.includes('abort')
}

export function useAiAutoBatchNaming() {
  const store = useProjectStore()

  let abortController = null

  const state = reactive({
    active: false,
    running: false,
    stationIds: [],
    failedStationIds: [],
    failedItems: [],
    doneCount: 0,
    successCount: 0,
    failedCount: 0,
    appliedCount: 0,
    error: '',
    currentStationId: '',
    currentStationName: '',
  })

  const total = computed(() => state.stationIds.length)

  const percent = computed(() => {
    if (!total.value) return 0
    return Math.round((state.doneCount / total.value) * 100)
  })

  function findStationById(stationId) {
    if (!store.project || !stationId) return null
    return store.project.stations.find((s) => s.id === stationId) || null
  }

  function buildStationDisplayName(stationId) {
    const station = findStationById(stationId)
    return station?.nameZh || station?.id || stationId
  }

  function abortRequest() {
    if (!abortController) return
    abortController.abort(new Error('aborted'))
    abortController = null
  }

  function reset() {
    abortRequest()
    state.active = false
    state.running = false
    state.stationIds = []
    state.failedStationIds = []
    state.failedItems = []
    state.doneCount = 0
    state.successCount = 0
    state.failedCount = 0
    state.appliedCount = 0
    state.error = ''
    state.currentStationId = ''
    state.currentStationName = ''
  }

  function appendFailure(stationId, message, failedStationIds, failedItems) {
    const item = {
      stationId,
      stationName: buildStationDisplayName(stationId),
      message: String(message || '生成失败'),
    }
    state.failedCount += 1
    failedStationIds.push(stationId)
    failedItems.push(item)
    if (state.failedItems.length < 12) {
      state.failedItems.push(item)
    }
  }

  async function run(stationIds, options = {}) {
    const normalizedStationIds = [
      ...new Set((stationIds || []).map((id) => String(id || '').trim()).filter(Boolean)),
    ]
    if (!normalizedStationIds.length) return

    abortRequest()
    const controller = new AbortController()
    abortController = controller

    state.active = true
    state.running = true
    state.stationIds = normalizedStationIds
    state.failedStationIds = []
    state.failedItems = []
    state.doneCount = 0
    state.successCount = 0
    state.failedCount = 0
    state.appliedCount = 0
    state.error = ''
    state.currentStationId = ''
    state.currentStationName = ''

    const count = normalizedStationIds.length
    const updates = []
    const failedItems = []
    const failedStationIds = []
    const runningLabel = options.retryFailedOnly
      ? 'AI全自动批量命名（失败重试）'
      : 'AI全自动批量命名'
    store.statusText = `${runningLabel}：正在抓取站点上下文 0/${count}`

    const contextItems = []
    let contextCursor = 0
    const contextWorkerCount = Math.max(1, Math.min(AI_AUTO_CONTEXT_CONCURRENCY, count))

    const contextWorker = async () => {
      while (true) {
        if (controller.signal.aborted) return
        const index = contextCursor
        if (index >= count) return
        contextCursor += 1
        const stationId = normalizedStationIds[index]
        const station = findStationById(stationId)
        state.currentStationId = stationId
        state.currentStationName = buildStationDisplayName(stationId)
        if (!station || !Array.isArray(station.lngLat)) {
          appendFailure(stationId, '当前站点不存在或坐标无效', failedStationIds, failedItems)
          state.doneCount += 1
          continue
        }
        try {
          const context = await fetchNearbyStationNamingContext(station.lngLat, {
            radiusMeters: STATION_NAMING_RADIUS_METERS,
            signal: controller.signal,
          })
          if (controller.signal.aborted) return
          contextItems.push({ stationId, lngLat: station.lngLat, context })
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error)) return
          appendFailure(
            stationId,
            String(error?.message || '上下文抓取失败'),
            failedStationIds,
            failedItems,
          )
          state.doneCount += 1
        } finally {
          if (!controller.signal.aborted) {
            const fetchedCount = contextItems.length + failedStationIds.length
            store.statusText = `${runningLabel}：正在抓取站点上下文 ${fetchedCount}/${count} [${state.currentStationName}]`
            // 请求间延迟，避免触发 Overpass API 限流
            if (contextCursor < count) {
              await new Promise((resolve) => {
                const timer = setTimeout(resolve, AI_AUTO_CONTEXT_DELAY_MS)
                const onAbort = () => { clearTimeout(timer); resolve() }
                if (controller.signal.aborted) { clearTimeout(timer); resolve() }
                else controller.signal.addEventListener('abort', onAbort, { once: true })
              })
            }
          }
        }
      }
    }

    try {
      await Promise.all(Array.from({ length: contextWorkerCount }, () => contextWorker()))
      if (controller.signal.aborted) return

      if (!contextItems.length) {
        state.error = '全部站点上下文抓取失败，请检查网络后重试'
        store.statusText = `${runningLabel}失败：无可用上下文`
        return
      }

      let namingCursor = 0
      const namingWorkerCount = Math.max(1, Math.min(AI_AUTO_NAMING_CONCURRENCY, contextItems.length))
      store.statusText = `${runningLabel}：正在请求 AI 0/${count}`

      const namingWorker = async () => {
        while (true) {
          if (controller.signal.aborted) return
          const index = namingCursor
          if (index >= contextItems.length) return
          namingCursor += 1
          const item = contextItems[index]
          state.currentStationId = item.stationId
          state.currentStationName = buildStationDisplayName(item.stationId)
          try {
            const candidates = await generateStationNameCandidates({
              context: item.context,
              lngLat: item.lngLat,
              signal: controller.signal,
            })
            if (controller.signal.aborted) return
            const best = candidates?.[0]
            if (!best) {
              appendFailure(item.stationId, 'AI 未返回可用候选', failedStationIds, failedItems)
            } else {
              updates.push({
                stationId: item.stationId,
                nameZh: best.nameZh,
                nameEn: best.nameEn,
              })
              state.successCount += 1
            }
          } catch (error) {
            if (controller.signal.aborted || isAbortError(error)) return
            appendFailure(item.stationId, String(error?.message || 'AI 请求失败'), failedStationIds, failedItems)
          }
          state.doneCount += 1
          store.statusText = `${runningLabel}：正在请求 AI ${state.doneCount}/${count} [${state.currentStationName}]`
        }
      }

      await Promise.all(Array.from({ length: namingWorkerCount }, () => namingWorker()))
      if (controller.signal.aborted) return

      const { updatedCount } = store.updateStationNamesBatch(updates, {
        reason: `${runningLabel}: 更新 ${updates.length}/${count} 站`,
      })
      state.appliedCount = updatedCount
      state.failedStationIds = failedStationIds
      if (!updatedCount && failedItems.length) {
        state.error = '全部站点自动命名失败，请检查网络或模型配置后重试'
      }
      const failedCount = state.failedCount
      store.statusText = failedCount
        ? `${runningLabel}完成：已应用 ${updatedCount}/${count}，失败 ${failedCount}`
        : `${runningLabel}完成：已应用 ${updatedCount}/${count}`
    } finally {
      if (abortController === controller) {
        abortController = null
      }
      state.running = false
    }
  }

  async function start(stations) {
    if (!stations.length) return
    const stationIds = stations.map((s) => s.id)
    await run(stationIds, { retryFailedOnly: false })
  }

  async function retryFailed() {
    if (!state.active || state.running) return
    const failedIds = [...(state.failedStationIds || [])]
    if (!failedIds.length) return
    await run(failedIds, { retryFailedOnly: true })
  }

  function cancel() {
    if (state.running) {
      abortRequest()
      state.running = false
      store.statusText = '已取消 AI 全自动批量命名'
      return
    }
    reset()
  }

  onBeforeUnmount(() => {
    abortRequest()
  })

  return {
    state,
    total,
    percent,
    start,
    retryFailed,
    cancel,
    reset,
  }
}
