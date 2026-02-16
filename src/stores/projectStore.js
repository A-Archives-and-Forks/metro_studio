import { acceptHMRUpdate, defineStore } from 'pinia'
import { exportPersistenceActions } from './project/actions/exportPersistence'
import { historyActions } from './project/actions/history'
import { importLayoutActions } from './project/actions/importLayout'
import { lifecycleActions } from './project/actions/lifecycle'
import { mapPreferencesActions } from './project/actions/mapPreferences'
import { networkEditingActions } from './project/actions/networkEditing'
import { selectionActions } from './project/actions/selection'
import { timelineActions } from './project/actions/timelineActions'
import { navigationActions } from './project/actions/navigationActions'
import { styleBrushActions } from './project/actions/styleBrushActions'
import { annotationActions } from './project/actions/annotationActions'
import { calculateNetworkMetrics } from '../lib/network/networkStatistics'

export const useProjectStore = defineStore('project', {
  state: () => ({
    project: null,
    regionBoundary: null,
    mode: 'select',
    selectedStationId: null,
    selectedStationIds: [],
    selectedEdgeId: null,
    selectedEdgeIds: [],
    selectedEdgeAnchor: null,
    pendingEdgeStartStationId: null,
    quickLinkStartStationId: null,
    activeLineId: null,
    isImporting: false,
    isLayoutRunning: false,
    isInitialized: false,
    statusText: '',
    isStationEnglishRetranslating: false,
    stationEnglishRetranslateProgress: {
      done: 0,
      total: 0,
      percent: 0,
      message: '',
    },
    exportStationVisibilityMode: 'all',
    showLanduseOverlay: false,
    protomapsApiKey: '',
    currentEditYear: 2010,
    timelineFilterYear: null,
    timelinePlayback: {
      state: 'idle',
      speed: 1,
    },
    navigation: {
      active: false,
      originLngLat: null,
      destinationLngLat: null,
      result: null,
    },
    styleBrush: {
      active: false,
      sourceType: null,
      sourceId: null,
      styleData: null,
    },
    measure: {
      active: false,
      points: [],
      totalMeters: 0,
    },
    history: {
      past: [],
      future: [],
      lastSnapshot: null,
      lastSnapshotHash: '',
      maxEntries: 320,
      checkpointInterval: 20,
      checkpoints: [],
      isRestoring: false,
    },
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
    selectedEdges(state) {
      if (!state.project) return []
      const selectedSet = new Set(state.selectedEdgeIds || [])
      return state.project.edges.filter((edge) => selectedSet.has(edge.id))
    },
    canUndo(state) {
      return (state.history?.past?.length || 0) > 0
    },
    canRedo(state) {
      return (state.history?.future?.length || 0) > 0
    },
    timelineYears(state) {
      if (!state.project) return []
      const years = new Set()
      for (const edge of state.project.edges) {
        if (edge.openingYear != null) years.add(edge.openingYear)
      }
      return [...years].sort((a, b) => a - b)
    },
    timelineYearRange(state) {
      const years = this.timelineYears
      if (!years.length) return null
      return { min: years[0], max: years[years.length - 1] }
    },
    timelineHasData(state) {
      return this.timelineYears.length > 0
    },
    timelineStatsAtYear(state) {
      const filterYear = state.timelineFilterYear
      if (filterYear == null || !state.project) return null
      const edges = state.project.edges
      const visibleEdgeIds = new Set()
      const visibleStationIds = new Set()
      const lineIds = new Set()
      let totalMeters = 0
      for (const edge of edges) {
        if (edge.openingYear != null && edge.openingYear > filterYear) continue
        visibleEdgeIds.add(edge.id)
        visibleStationIds.add(edge.fromStationId)
        visibleStationIds.add(edge.toStationId)
        for (const lid of edge.sharedByLineIds) lineIds.add(lid)
        totalMeters += edge.lengthMeters || 0
      }
      return {
        lines: lineIds.size,
        stations: visibleStationIds.size,
        km: totalMeters / 1000,
      }
    },
    networkStatistics(state) {
      if (!state.project) return null
      return calculateNetworkMetrics(state.project)
    },
  },
  actions: {
    ...historyActions,
    ...lifecycleActions,
    ...mapPreferencesActions,
    ...selectionActions,
    ...networkEditingActions,
    ...importLayoutActions,
    ...exportPersistenceActions,
    ...timelineActions,
    ...navigationActions,
    ...styleBrushActions,
    ...annotationActions,
  },
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useProjectStore, import.meta.hot))
}
