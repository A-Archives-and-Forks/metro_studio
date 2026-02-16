/**
 * Safely parse a JSON string, returning null on failure.
 */
export function safeJsonParse(text) {
  if (typeof text !== 'string') return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * Extract a JSON object from text that may contain surrounding non-JSON content.
 */
export function extractJsonObject(text) {
  const direct = safeJsonParse(text)
  if (direct && typeof direct === 'object') return direct
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  return safeJsonParse(text.slice(start, end + 1))
}
