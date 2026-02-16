/**
 * Font loading for timeline canvas rendering.
 */

export const FONT_FAMILY = '微软雅黑'

let _fontLoadPromise = null

/**
 * Load PingFang Bold from local project file via FontFace API.
 * Registers the font at multiple weights so Canvas ctx.font always matches.
 */
export function loadSourceHanSans(_textHint = '') {
  if (_fontLoadPromise) return _fontLoadPromise
  _fontLoadPromise = (async () => {
    try {
      const resp = await fetch('/PingFang-Bold.ttf')
      if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching font`)
      const buffer = await resp.arrayBuffer()

      const face = new FontFace(FONT_FAMILY, buffer)
      const loaded = await face.load()
      document.fonts.add(loaded)
    } catch {
      // Font load failure is non-critical; canvas will fall back to system font
    }
  })()
  return _fontLoadPromise
}
