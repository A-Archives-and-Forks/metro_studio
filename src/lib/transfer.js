function toStationId(value) {
  if (value == null) return ''
  return String(value)
}

export function createTransferPairKey(stationAId, stationBId) {
  const a = toStationId(stationAId)
  const b = toStationId(stationBId)
  if (!a || !b || a === b) return ''
  return a < b ? `${a}__${b}` : `${b}__${a}`
}

export function hasManualTransferBetween(manualTransfers, stationAId, stationBId) {
  const pairKey = createTransferPairKey(stationAId, stationBId)
  if (!pairKey) return false
  for (const transfer of manualTransfers || []) {
    if (createTransferPairKey(transfer?.stationAId, transfer?.stationBId) === pairKey) {
      return true
    }
  }
  return false
}

export function normalizeManualTransfers(manualTransfers, validStationIdSet) {
  const validSet =
    validStationIdSet instanceof Set
      ? validStationIdSet
      : new Set(Array.isArray(validStationIdSet) ? validStationIdSet.map((id) => String(id)) : [])
  const result = []
  const seen = new Set()

  for (const transfer of manualTransfers || []) {
    const stationAId = toStationId(transfer?.stationAId)
    const stationBId = toStationId(transfer?.stationBId)
    const pairKey = createTransferPairKey(stationAId, stationBId)
    if (!pairKey) continue
    if (!validSet.has(stationAId) || !validSet.has(stationBId)) continue
    if (seen.has(pairKey)) continue
    seen.add(pairKey)
    const [normalizedA, normalizedB] = pairKey.split('__')
    result.push({
      id: transfer?.id ? String(transfer.id) : '',
      stationAId: normalizedA,
      stationBId: normalizedB,
    })
  }

  return result
}

export function buildTransferEffectiveLineIds(stationIds, manualTransfers, stationLineSet) {
  const ids = Array.isArray(stationIds) ? stationIds.map((id) => String(id)) : []
  const parent = new Map(ids.map((id) => [id, id]))

  const find = (id) => {
    const current = parent.get(id)
    if (current == null) return ''
    if (current === id) return id
    const root = find(current)
    parent.set(id, root)
    return root
  }

  const union = (a, b) => {
    const rootA = find(a)
    const rootB = find(b)
    if (!rootA || !rootB || rootA === rootB) return
    parent.set(rootB, rootA)
  }

  const validSet = new Set(ids)
  const normalizedTransfers = normalizeManualTransfers(manualTransfers, validSet)
  for (const transfer of normalizedTransfers) {
    union(transfer.stationAId, transfer.stationBId)
  }

  const groups = new Map()
  for (const stationId of ids) {
    const root = find(stationId)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(stationId)
  }

  const effectiveLineIdsByStationId = new Map()
  for (const stationId of ids) {
    effectiveLineIdsByStationId.set(stationId, [...(stationLineSet.get(stationId) || [])])
  }

  for (const memberIds of groups.values()) {
    if (memberIds.length <= 1) continue
    const mergedLineIds = new Set()
    for (const stationId of memberIds) {
      for (const lineId of stationLineSet.get(stationId) || []) {
        mergedLineIds.add(lineId)
      }
    }
    const lineIds = [...mergedLineIds]
    for (const stationId of memberIds) {
      effectiveLineIdsByStationId.set(stationId, lineIds)
    }
  }

  return {
    normalizedTransfers,
    effectiveLineIdsByStationId,
  }
}
