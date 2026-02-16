/**
 * Map display preferences actions.
 * Handles map overlay settings like landuse visualization.
 */
const mapPreferencesActions = {
  toggleLanduseOverlay() {
    this.showLanduseOverlay = !this.showLanduseOverlay
  },

  setShowLanduseOverlay(visible) {
    this.showLanduseOverlay = Boolean(visible)
  },

  setProtomapsApiKey(key) {
    this.protomapsApiKey = key || ''
  },
}

export { mapPreferencesActions }
