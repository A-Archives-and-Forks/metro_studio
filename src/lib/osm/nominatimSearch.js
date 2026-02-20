const LOCATIONIQ_ENDPOINT = 'https://us1.locationiq.com/v1/search'
const NOMINATIM_FALLBACK_ENDPOINT = 'https://nominatim.openstreetmap.org/search'

const LOCATIONIQ_MIN_INTERVAL_MS = 500
const NOMINATIM_MIN_INTERVAL_MS = 1100
const NOMINATIM_REQUEST_TIMEOUT_MS = 15000
const NOMINATIM_MAX_RETRIES = 3
const NOMINATIM_CACHE_TTL_MS = 300000

let lastRequestAt = 0
const cache = new Map()

let _locationIqKey = ''
try { _locationIqKey = window.localStorage.getItem('locationIqApiKey') || '' } catch { /* noop */ }

export function getLocationIqApiKey() { return _locationIqKey }
export function setLocationIqApiKey(key) {
  _locationIqKey = key || ''
  try { window.localStorage.setItem('locationIqApiKey', _locationIqKey) } catch { /* noop */ }
}

function getMinInterval() {
  return _locationIqKey ? LOCATIONIQ_MIN_INTERVAL_MS : NOMINATIM_MIN_INTERVAL_MS
}

function buildCacheKey(query, limit) {
  return `${String(query || '').trim().toLowerCase()}_${limit}`
}

function sleep(ms, signal) {
  if (!ms || ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(new Error('Nominatim 搜索请求已取消'))
    }
    if (signal?.aborted) { clearTimeout(timer); reject(new Error('Nominatim 搜索请求已取消')) }
    else if (signal) signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function throttle(signal) {
  const now = Date.now()
  const waitMs = lastRequestAt + getMinInterval() - now
  if (waitMs > 0) await sleep(waitMs, signal)
  lastRequestAt = Date.now()
}

export async function searchLocation(query, options = {}) {
  const limit = options.limit ?? 10
  const signal = options.signal
  const trimmedQuery = String(query || '').trim()

  if (!trimmedQuery) return []

  const key = buildCacheKey(trimmedQuery, limit)
  const cached = cache.get(key)
  if (cached && cached.expireAt > Date.now()) return cached.data

  for (let attempt = 0; attempt <= NOMINATIM_MAX_RETRIES; attempt += 1) {
    if (signal?.aborted) throw new Error('Nominatim 搜索请求已取消')
    await throttle(signal)

    const useLocationIq = !!_locationIqKey
    const endpoint = useLocationIq ? LOCATIONIQ_ENDPOINT : NOMINATIM_FALLBACK_ENDPOINT
    const keyParam = useLocationIq ? `&key=${_locationIqKey}` : ''
    const format = 'json'

    const url = `${endpoint}?q=${encodeURIComponent(trimmedQuery)}&format=${format}&limit=${limit}&addressdetails=1&namedetails=1&accept-language=zh,en${keyParam}`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), NOMINATIM_REQUEST_TIMEOUT_MS)
    if (signal) {
      const onAbort = () => controller.abort()
      signal.addEventListener('abort', onAbort, { once: true })
    }

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'RailMap/1.0 (location-search)',
          Accept: 'application/json',
        },
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (response.status === 429) {
        await sleep(3000, signal)
        continue
      }
      if (!response.ok) {
        if (response.status >= 500) continue
        throw new Error(`Nominatim 搜索请求失败: ${response.status}`)
      }

      const data = await response.json()
      const results = Array.isArray(data) ? data : []

      cache.set(key, { data: results, expireAt: Date.now() + NOMINATIM_CACHE_TTL_MS })
      return results
    } catch (error) {
      clearTimeout(timeout)
      if (signal?.aborted) throw new Error('Nominatim 搜索请求已取消')
      if (attempt >= NOMINATIM_MAX_RETRIES) throw error
    }
  }

  throw new Error('Nominatim 搜索请求失败: 重试次数已用尽')
}
