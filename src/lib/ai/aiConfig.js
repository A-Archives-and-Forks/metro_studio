const AI_CONFIG_STORAGE_KEY = 'metro_studio_ai_config'

const DEFAULT_CONFIG = {
  baseUrl: 'https://api.bltcy.ai',
  apiKey: '',
}

function normalizeBaseUrl(url) {
  const trimmed = String(url || '').trim()
  if (!trimmed) return DEFAULT_CONFIG.baseUrl
  return trimmed.replace(/\/+$/, '')
}

function normalizeApiKey(key) {
  return String(key || '').trim()
}

export function getAiConfig() {
  try {
    const saved = window.localStorage.getItem(AI_CONFIG_STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      return {
        baseUrl: normalizeBaseUrl(parsed.baseUrl),
        apiKey: normalizeApiKey(parsed.apiKey),
      }
    }
  } catch {
  }
  return {
    baseUrl: DEFAULT_CONFIG.baseUrl,
    apiKey: '',
  }
}

export function setAiConfig({ baseUrl, apiKey }) {
  try {
    const config = {
      baseUrl: normalizeBaseUrl(baseUrl),
      apiKey: normalizeApiKey(apiKey),
    }
    window.localStorage.setItem(AI_CONFIG_STORAGE_KEY, JSON.stringify(config))
    return true
  } catch {
    return false
  }
}

export function clearAiConfig() {
  try {
    window.localStorage.removeItem(AI_CONFIG_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

export function hasAiConfig() {
  const config = getAiConfig()
  return Boolean(config.apiKey)
}

export { AI_CONFIG_STORAGE_KEY }
