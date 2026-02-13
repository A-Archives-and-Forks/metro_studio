let worker
let requestCounter = 0
const pending = new Map()

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('../../workers/layoutWorker.js', import.meta.url), { type: 'module' })
    worker.onmessage = (event) => {
      const { requestId, ok, result, error } = event.data || {}
      if (!pending.has(requestId)) return
      const { resolve, reject } = pending.get(requestId)
      pending.delete(requestId)
      if (ok) {
        resolve(result)
      } else {
        reject(new Error(error || 'layout-worker-failed'))
      }
    }
  }
  return worker
}

export function optimizeLayoutInWorker(payload) {
  const instance = getWorker()
  const requestId = `layout_${Date.now()}_${requestCounter++}`
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject })
    const cloneablePayload = JSON.parse(JSON.stringify(payload))
    instance.postMessage({ requestId, payload: cloneablePayload })
  })
}

