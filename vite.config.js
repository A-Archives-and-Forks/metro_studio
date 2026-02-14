import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const commonProxy = {
  '/api/ollama': {
    target: 'http://127.0.0.1:11434',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/ollama/, ''),
  },
  '/api/overpass': {
    target: 'https://overpass-api.de',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/overpass/, '/api/interpreter'),
  },
  '/api/overpass-kumi': {
    target: 'https://overpass.kumi.systems',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/overpass-kumi/, '/api/interpreter'),
  },
  '/api/nominatim': {
    target: 'https://nominatim.openstreetmap.org',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/nominatim/, ''),
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vue: ['vue', 'pinia'],
          map: ['maplibre-gl'],
          turf: ['@turf/helpers', '@turf/bbox', '@turf/boolean-point-in-polygon'],
        },
      },
    },
  },
  server: {
    proxy: commonProxy,
  },
  preview: {
    proxy: commonProxy,
  },
})
