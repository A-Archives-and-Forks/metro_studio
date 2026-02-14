<script setup>
import { onBeforeUnmount, onMounted } from 'vue'
import MapEditor from './components/MapEditor.vue'
import SchematicView from './components/SchematicView.vue'
import ToolbarControls from './components/ToolbarControls.vue'
import VehicleHudView from './components/VehicleHudView.vue'
import { useProjectStore } from './stores/projectStore'

const store = useProjectStore()

function handleBeforeUnload(event) {
  event.preventDefault()
  event.returnValue = ''
}

onMounted(async () => {
  window.addEventListener('beforeunload', handleBeforeUnload)
  await store.initialize()
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
})
</script>

<template>
  <main class="app">
    <ToolbarControls />
    <section class="workspace">
      <MapEditor />
      <SchematicView />
      <VehicleHudView />
    </section>
  </main>
</template>

<style scoped>
.app {
  min-height: 100vh;
  height: 100vh;
  display: grid;
  grid-template-columns: 360px 1fr;
  background: linear-gradient(145deg, #e2e8f0, #f8fafc);
}

.workspace {
  display: grid;
  gap: 0;
  grid-template-rows: repeat(3, minmax(100vh, 100vh));
  overflow-y: auto;
  overscroll-behavior: contain;
  scroll-snap-type: y mandatory;
}

.workspace > * {
  min-height: 100vh;
  height: 100vh;
  scroll-snap-align: start;
}

@media (max-width: 1060px) {
  .app {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
    height: auto;
    min-height: 100vh;
  }

  .workspace {
    grid-template-rows: repeat(3, minmax(100vh, 100vh));
  }

  .workspace > * {
    min-height: 100vh;
    height: 100vh;
  }
}
</style>
