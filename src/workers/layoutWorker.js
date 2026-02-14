import { optimizeLayout } from './layout/optimizeLayout'

self.onmessage = (event) => {
  const { requestId, payload } = event.data || {}
  if (!requestId) return

  try {
    const result = optimizeLayout(payload)
    self.postMessage({ requestId, ok: true, result })
  } catch (error) {
    self.postMessage({
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : 'unknown-worker-error',
    })
  }
}
