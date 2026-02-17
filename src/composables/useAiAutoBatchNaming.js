import { computed, onBeforeUnmount, reactive } from 'vue'
import { generateStationNameCandidatesBatch } from '../lib/ai/stationNaming'
import { fetchNearbyStationNamingContext, STATION_NAMING_RADIUS_METERS } from '../lib/osm/nearbyStationNamingContext'
import { useProjectStore } from '../stores/projectStore'

const AI_AUTO_CONTEXT_CONCURRENCY = 20
const AI_AUTO_MODEL_BATCH_SIZE = 30
const AI_AUTO_MODEL_BATCH_CONCURRENCY = 5

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
            if (fetchedCount === count || fetchedCount % 10 === 0) {
              store.statusText = `${runningLabel}：正在抓取站点上下文 ${fetchedCount}/${count}`
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

      const batches = chunkArray(contextItems, AI_AUTO_MODEL_BATCH_SIZE)
      let batchCursor = 0
      const batchWorkerCount = Math.max(
        1,
        Math.min(AI_AUTO_MODEL_BATCH_CONCURRENCY, batches.length),
      )
      store.statusText = `${runningLabel}：正在批量请求 AI 0/${count}`

      const batchWorker = async () => {
        while (true) {
          if (controller.signal.aborted) return
          const index = batchCursor
          if (index >= batches.length) return
          batchCursor += 1
          const batchItems = batches[index]
          let batchResults = []
          try {
            batchResults = await generateStationNameCandidatesBatch({
              stations: batchItems,
              signal: controller.signal,
              strictModel: true,
            })
          } catch (error) {
            if (controller.signal.aborted || isAbortError(error)) return
            const message = String(error?.message || 'AI 批量请求失败')
            for (const item of batchItems) {
              appendFailure(item.stationId, message, failedStationIds, failedItems)
              state.doneCount += 1
            }
            continue
          }
          if (controller.signal.aborted) return

          const resultMap = new Map()
          for (const result of batchResults) {
            const sid = String(result?.stationId || '').trim()
            if (!sid || resultMap.has(sid)) continue
            resultMap.set(sid, result)
          }

          for (const item of batchItems) {
            const result = resultMap.get(item.stationId)
            const candidates = Array.isArray(result?.candidates) ? result.candidates : []
            const bestCandidate = candidates.length ? candidates[0] : null
            if (!bestCandidate) {
              appendFailure(
                item.stationId,
                result?.error || 'AI 未返回可用候选',
                failedStationIds,
                failedItems,
              )
            } else {
              updates.push({
                stationId: item.stationId,
                nameZh: bestCandidate.nameZh,
                nameEn: bestCandidate.nameEn,
              })
              state.successCount += 1
            }
            state.doneCount += 1
          }

          if (state.doneCount === count || state.doneCount % 10 === 0) {
            store.statusText = `${runningLabel}：正在批量请求 AI ${state.doneCount}/${count}`
          }
        }
      }

      await Promise.all(Array.from({ length: batchWorkerCount }, () => batchWorker()))
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
