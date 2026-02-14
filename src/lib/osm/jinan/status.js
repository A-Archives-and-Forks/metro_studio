const STATUS_WEIGHT = {
  proposed: 1,
  construction: 2,
  open: 3,
}

function classifyRelationStatus(tags = {}) {
  const route = tags.route || ''
  const state = tags.state || ''
  const proposed = tags.proposed || ''
  const construction = tags.construction || ''

  if (state === 'proposed' || proposed.includes('subway') || proposed.includes('light_rail')) {
    return 'proposed'
  }
  if (
    route === 'construction' ||
    state === 'construction' ||
    construction.includes('subway') ||
    construction.includes('light_rail')
  ) {
    return 'construction'
  }
  return 'open'
}

function classifyStationStatus(tags = {}) {
  const state = String(tags.state || '').toLowerCase()
  const proposed = String(tags.proposed || '').toLowerCase()
  const proposedRailway = String(tags['proposed:railway'] || '').toLowerCase()
  const construction = String(tags.construction || '').toLowerCase()
  const constructionRailway = String(tags['construction:railway'] || '').toLowerCase()
  const railway = String(tags.railway || '').toLowerCase()

  if (
    state === 'proposed' ||
    railway === 'proposed' ||
    proposed === 'yes' ||
    proposed === 'station' ||
    proposed.includes('subway') ||
    proposed.includes('light_rail') ||
    proposedRailway === 'station' ||
    proposedRailway === 'subway' ||
    proposedRailway === 'light_rail'
  ) {
    return 'proposed'
  }

  if (
    state === 'construction' ||
    railway === 'construction' ||
    (construction && construction !== 'no') ||
    constructionRailway === 'station' ||
    constructionRailway === 'subway' ||
    constructionRailway === 'light_rail'
  ) {
    return 'construction'
  }

  return 'open'
}

function shouldIncludeStatus(status, includeConstruction, includeProposed) {
  if (status === 'open') return true
  if (status === 'construction') return includeConstruction
  if (status === 'proposed') return includeProposed
  return false
}

function isSubwayStationNode(tags = {}) {
  const station = String(tags.station || '').toLowerCase()
  const railway = String(tags.railway || '').toLowerCase()
  const publicTransport = String(tags.public_transport || '').toLowerCase()
  const subway = String(tags.subway || '').toLowerCase()
  const lightRail = String(tags.light_rail || '').toLowerCase()
  const constructionRailway = String(tags['construction:railway'] || '').toLowerCase()
  const proposedRailway = String(tags['proposed:railway'] || '').toLowerCase()

  if (station === 'subway' || station === 'light_rail') return true
  if (constructionRailway === 'station' || constructionRailway === 'subway' || constructionRailway === 'light_rail') {
    return true
  }
  if (proposedRailway === 'station' || proposedRailway === 'subway' || proposedRailway === 'light_rail') {
    return true
  }
  if ((subway === 'yes' || lightRail === 'yes') && (railway === 'station' || railway === 'halt' || publicTransport === 'station')) {
    return true
  }
  if (publicTransport === 'station' && (railway === 'station' || railway === 'halt' || subway === 'yes' || lightRail === 'yes')) {
    return true
  }
  return false
}

function mergeLineStatus(current, incoming) {
  if (!current) return incoming
  return STATUS_WEIGHT[current] >= STATUS_WEIGHT[incoming] ? current : incoming
}

export { classifyRelationStatus, classifyStationStatus, shouldIncludeStatus, isSubwayStationNode, mergeLineStatus }
