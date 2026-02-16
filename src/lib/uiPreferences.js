export const UI_THEME_STORAGE_KEY = 'railmap_ui_theme'

export const DEFAULT_UI_THEME = 'dark'

export function normalizeUiTheme(theme) {
  return theme === 'light' ? 'light' : 'dark'
}
