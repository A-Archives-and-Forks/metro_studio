import { computeShortestRoute } from '../../../lib/navigation/dijkstra'

const navigationActions = {
  enterNavigation() {
    this.navigation = {
      active: true,
      originLngLat: null,
      destinationLngLat: null,
      result: null,
    }
  },

  exitNavigation() {
    this.navigation = {
      active: false,
      originLngLat: null,
      destinationLngLat: null,
      result: null,
    }
  },

  setNavigationOrigin(lngLat) {
    this.navigation.originLngLat = lngLat
    this.navigation.destinationLngLat = null
    this.navigation.result = null
  },

  setNavigationDestination(lngLat) {
    this.navigation.destinationLngLat = lngLat
    this.computeNavigationRoute()
  },

  computeNavigationRoute() {
    const { originLngLat, destinationLngLat } = this.navigation
    if (!originLngLat || !destinationLngLat || !this.project) {
      this.navigation.result = null
      return
    }

    const result = computeShortestRoute({
      stations: this.project.stations || [],
      edges: this.project.edges || [],
      lines: this.project.lines || [],
      originLngLat,
      destLngLat: destinationLngLat,
      candidateRadius: 3000,
      maxCandidates: 5,
      walkWeight: 5,
    })

    this.navigation.result = result
  },
}

export { navigationActions }
