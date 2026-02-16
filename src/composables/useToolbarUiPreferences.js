import { ref } from 'vue'
import {
  DEFAULT_UI_THEME,
  UI_THEME_STORAGE_KEY,
  normalizeUiTheme,
} from '../lib/uiPreferences'

/**
 * Composable for UI theme preferences with localStorage persistence.
 *
 * @returns Reactive refs and apply/restore helpers for theme
 */
export function useToolbarUiPreferences() {
  const uiTheme = ref(DEFAULT_UI_THEME)

  function applyUiTheme(theme) {
    const nextTheme = normalizeUiTheme(theme)
    uiTheme.value = nextTheme
    document.documentElement.setAttribute('data-ui-theme', nextTheme)
    try {
      window.localStorage.setItem(UI_THEME_STORAGE_KEY, nextTheme)
    } catch {
      // Ignore unavailable localStorage runtime.
    }
  }

  function restoreUiTheme() {
    try {
      const cachedTheme = window.localStorage.getItem(UI_THEME_STORAGE_KEY)
      applyUiTheme(cachedTheme || DEFAULT_UI_THEME)
      return
    } catch {
      // Fall through to default theme.
    }
    applyUiTheme(DEFAULT_UI_THEME)
  }

  return {
    uiTheme,
    applyUiTheme,
    restoreUiTheme,
  }
}
