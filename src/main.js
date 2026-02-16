import 'maplibre-gl/dist/maplibre-gl.css'
import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import {
  DEFAULT_UI_THEME,
  UI_THEME_STORAGE_KEY,
  normalizeUiTheme,
} from './lib/uiPreferences'
import './style.css'

try {
  const cachedTheme = window.localStorage.getItem(UI_THEME_STORAGE_KEY)
  document.documentElement.setAttribute('data-ui-theme', normalizeUiTheme(cachedTheme || DEFAULT_UI_THEME))
} catch {
  // Ignore unavailable localStorage runtime.
}

const app = createApp(App)
app.use(createPinia())
app.mount('#app')
