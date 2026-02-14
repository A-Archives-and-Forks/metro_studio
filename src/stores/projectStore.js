import { defineStore } from 'pinia'
import { exportPersistenceActions } from './project/actions/exportPersistence'
import { importLayoutActions } from './project/actions/importLayout'
import { lifecycleActions } from './project/actions/lifecycle'
import { networkEditingActions } from './project/actions/networkEditing'
import { selectionActions } from './project/actions/selection'

export const useProjectStore = defineStore('project', {
  state: () => ({
    project: null,
    regionBoundary: null,
    mode: 'select',
    selectedStationId: null,
    selectedStationIds: [],
    selectedEdgeId: null,
    selectedEdgeAnchor: null,
    pendingEdgeStartStationId: null,
    activeLineId: null,
    isImporting: false,
    isLayoutRunning: false,
    isInitialized: false,
    statusText: '',
    includeConstruction: false,
    includeProposed: false,
    exportStationVisibilityMode: 'all',
  }),
  getters: {
    lineById(state) {
      const map = new Map()
      for (const line of state.project?.lines || []) {
        map.set(line.id, line)
      }
      return map
    },
    stationById(state) {
      const map = new Map()
      for (const station of state.project?.stations || []) {
        map.set(station.id, station)
      }
      return map
    },
    edgeById(state) {
      const map = new Map()
      for (const edge of state.project?.edges || []) {
        map.set(edge.id, edge)
      }
      return map
    },
    selectedStations(state) {
      if (!state.project) return []
      const selectedSet = new Set(state.selectedStationIds || [])
      return state.project.stations.filter((station) => selectedSet.has(station.id))
    },
  },
  actions: {
    ...lifecycleActions,
    ...selectionActions,
    ...networkEditingActions,
    ...importLayoutActions,
    ...exportPersistenceActions,
  },
})
