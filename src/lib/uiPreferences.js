export const UI_THEME_STORAGE_KEY = 'railmap_ui_theme'
export const UI_FONT_STORAGE_KEY = 'railmap_ui_font'

export const UI_FONT_OPTIONS = Object.freeze([
  {
    id: 'source-han',
    label: '思源黑体',
    family: "'Source Han Sans SC', 'Noto Sans CJK SC', 'Segoe UI', sans-serif",
  },
  {
    id: 'pingfang',
    label: '苹方',
    family: "'微软雅黑', 'Hiragino Sans GB', 'Noto Sans CJK SC', sans-serif",
  },
  {
    id: 'yahei',
    label: '微软雅黑',
    family: "'Microsoft YaHei', 'Noto Sans CJK SC', 'Segoe UI', sans-serif",
  },
  {
    id: 'heiti',
    label: '黑体',
    family: "'SimHei', 'Noto Sans CJK SC', 'Segoe UI', sans-serif",
  },
])

export const DEFAULT_UI_THEME = 'dark'
export const DEFAULT_UI_FONT = UI_FONT_OPTIONS[0].id

const UI_FONT_ID_SET = new Set(UI_FONT_OPTIONS.map((item) => item.id))

export function normalizeUiTheme(theme) {
  return theme === 'light' ? 'light' : 'dark'
}

export function normalizeUiFont(fontId) {
  return UI_FONT_ID_SET.has(fontId) ? fontId : DEFAULT_UI_FONT
}

/** Resolve the current user-selected font family CSS string. */
export function getActiveFontFamily() {
  try {
    const stored = window.localStorage.getItem(UI_FONT_STORAGE_KEY)
    const id = normalizeUiFont(stored || DEFAULT_UI_FONT)
    const opt = UI_FONT_OPTIONS.find(o => o.id === id)
    return opt?.family || UI_FONT_OPTIONS[0].family
  } catch {
    return UI_FONT_OPTIONS[0].family
  }
}
