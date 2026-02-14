const DEFAULT_OLLAMA_MODEL = 'kamekichi128/qwen3-4b-instruct-2507:latest'
const OLLAMA_REQUEST_TIMEOUT_MS = 90000

const DEV_PROXY_ENDPOINTS = ['/api/ollama']
const LOCAL_ENDPOINTS = ['http://127.0.0.1:11434', 'http://localhost:11434']
const OLLAMA_ENDPOINTS = import.meta.env.DEV
  ? [...DEV_PROXY_ENDPOINTS, ...LOCAL_ENDPOINTS]
  : [...LOCAL_ENDPOINTS]

const BASIS_OPTIONS = ['①道路', '②地域', '③公共设施', '④其它']

const STATION_NAME_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    candidates: {
      type: 'array',
      minItems: 5,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          nameZh: { type: 'string', minLength: 1, maxLength: 64 },
          nameEn: { type: 'string', minLength: 1, maxLength: 96 },
          basis: { type: 'string', enum: BASIS_OPTIONS },
          reason: { type: 'string', minLength: 1, maxLength: 220 },
        },
        required: ['nameZh', 'nameEn', 'basis', 'reason'],
      },
    },
  },
  required: ['candidates'],
}

const CHINESE_NAMING_STANDARD = `轨道交通车站名称按以下条件综合考虑：
① 以与车站站位邻近的主要横向道路名称命名；
② 以相近的地域名称命名；
③ 以相近的较为著名的公共设施名称命名；
④ 以其它符合法律、法规的方法命名。
车站名称命名的优先权主要由被选道路、地域或公共设施的重要程度、对社会的导向性等因素予以确定。`

const ENGLISH_NAMING_STANDARD = `专名部分用汉语拼音，不标声调，多音节连写，如“Xujiahui”，各词首字母大写。通名部分按上海道路和公共场所英文规范意译，如“路/马路”Road，“大道”Avenue，“公园”Park，“火车站”Railway Station。含方位词时，用 East/West/South/North 置于专名前，如“East Nanjing Road”。报站和导向标识一般只写站名，必要时可在后加“Station”或“Metro Station”。多线换乘站中英文统一，不用生僻缩写和不规范拼写。`

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function trimEndpoint(endpoint) {
  return String(endpoint || '').replace(/\/+$/, '')
}

function createAbortSignalWithTimeout(parentSignal, timeoutMs) {
  const controller = new AbortController()

  const timeoutHandle = setTimeout(() => {
    controller.abort(new Error(`timeout-${timeoutMs}ms`))
  }, timeoutMs)

  const abortFromParent = () => {
    controller.abort(parentSignal?.reason || new Error('aborted'))
  }

  if (parentSignal) {
    if (parentSignal.aborted) {
      abortFromParent()
    } else {
      parentSignal.addEventListener('abort', abortFromParent, { once: true })
    }
  }

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeoutHandle)
      if (parentSignal) {
        parentSignal.removeEventListener('abort', abortFromParent)
      }
    },
  }
}

function normalizeBasis(value) {
  const text = String(value || '').trim()
  if (!text) return '④其它'
  if (text.includes('①') || text.includes('道路')) return '①道路'
  if (text.includes('②') || text.includes('地域') || text.includes('片区') || text.includes('行政区')) return '②地域'
  if (text.includes('③') || text.includes('设施') || text.includes('建筑') || text.includes('机构')) return '③公共设施'
  return '④其它'
}

function safeJsonParse(text) {
  if (typeof text !== 'string') return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function extractJsonObject(text) {
  const direct = safeJsonParse(text)
  if (direct && typeof direct === 'object') return direct

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  return safeJsonParse(text.slice(start, end + 1))
}

function hasCjk(text) {
  return /[\u3400-\u9fff]/.test(String(text || ''))
}

function toTitleWords(text) {
  return String(text || '')
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function fallbackEnglishName(nameZh, nameEnHint = '') {
  const fromHint = String(nameEnHint || '').trim()
  if (fromHint) return fromHint
  const fromZh = String(nameZh || '').trim()
  if (!fromZh) return ''
  if (!hasCjk(fromZh)) {
    return toTitleWords(fromZh)
  }
  return `${fromZh} Station`
}

function normalizeCandidate(rawCandidate) {
  const nameZh = String(rawCandidate?.nameZh || rawCandidate?.zh || rawCandidate?.name || '').trim()
  if (!nameZh) return null

  const basis = normalizeBasis(rawCandidate?.basis || rawCandidate?.rule)
  const nameEn = fallbackEnglishName(nameZh, rawCandidate?.nameEn || rawCandidate?.en)
  if (!nameEn) return null

  const reason = String(rawCandidate?.reason || rawCandidate?.why || '').trim() || `${basis}命名依据。`
  return {
    nameZh,
    nameEn,
    basis,
    reason,
  }
}

function normalizeCandidateKey(candidate) {
  return `${String(candidate?.nameZh || '').trim().toLowerCase()}::${String(candidate?.nameEn || '').trim().toLowerCase()}`
}

function dedupeCandidates(candidates) {
  const result = []
  const seen = new Set()
  for (const candidate of candidates) {
    const key = normalizeCandidateKey(candidate)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(candidate)
  }
  return result
}

function projectContextForModel(context, lngLat) {
  const [lng, lat] = Array.isArray(lngLat) && lngLat.length === 2 ? lngLat : context.center || [0, 0]

  const projectList = (items, limit) =>
    (Array.isArray(items) ? items : []).slice(0, limit).map((item) => ({
      nameZh: String(item?.nameZh || '').trim(),
      nameEn: String(item?.nameEn || '').trim(),
      type: String(item?.type || '').trim(),
      distanceMeters: Math.round(toFiniteNumber(item?.distanceMeters, 0)),
      importance: toFiniteNumber(item?.importance, 0),
      score: toFiniteNumber(item?.score, 0),
    }))

  return {
    stationPoint: {
      lng: Number(toFiniteNumber(lng, 0).toFixed(6)),
      lat: Number(toFiniteNumber(lat, 0).toFixed(6)),
      radiusMeters: Math.round(toFiniteNumber(context?.radiusMeters, 300)),
    },
    roads: projectList(context?.roads, 18),
    areas: projectList(context?.areas, 14),
    facilities: projectList(context?.facilities, 20),
    buildings: projectList(context?.buildings, 20),
  }
}

function buildFallbackCandidatesFromContext(context) {
  const pools = [
    {
      basis: '①道路',
      items: Array.isArray(context?.roads) ? context.roads : [],
    },
    {
      basis: '②地域',
      items: Array.isArray(context?.areas) ? context.areas : [],
    },
    {
      basis: '③公共设施',
      items: Array.isArray(context?.facilities) ? context.facilities : [],
    },
    {
      basis: '③公共设施',
      items: Array.isArray(context?.buildings) ? context.buildings : [],
    },
  ]

  const result = []
  for (const pool of pools) {
    for (const item of pool.items) {
      const nameZh = String(item?.nameZh || '').trim()
      if (!nameZh) continue
      const nameEn = fallbackEnglishName(nameZh, item?.nameEn)
      if (!nameEn) continue
      const distanceMeters = Math.round(toFiniteNumber(item?.distanceMeters, 0))
      const reason = `依据${pool.basis}对象“${nameZh}”（${String(item?.type || '周边要素')}，约${distanceMeters}m）。`
      result.push({
        nameZh,
        nameEn,
        basis: pool.basis,
        reason,
      })
    }
  }

  return dedupeCandidates(result)
}

function extractCandidatesFromChatResponse(payload) {
  const content = payload?.message?.content
  if (content && typeof content === 'object') {
    return Array.isArray(content.candidates) ? content.candidates : []
  }
  if (typeof content === 'string') {
    const parsed = extractJsonObject(content)
    if (parsed && Array.isArray(parsed.candidates)) {
      return parsed.candidates
    }
  }
  return []
}

async function postOllamaChat(payload, signal) {
  if (signal?.aborted) {
    throw new Error('Ollama 请求已取消')
  }

  const failures = []

  for (const endpoint of OLLAMA_ENDPOINTS) {
    const base = trimEndpoint(endpoint)
    if (!base) continue

    const { signal: requestSignal, cleanup } = createAbortSignalWithTimeout(signal, OLLAMA_REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: requestSignal,
      })

      if (!response.ok) {
        failures.push(`${base}(${response.status})`)
        continue
      }

      const text = await response.text()
      const json = safeJsonParse(text)
      if (!json || typeof json !== 'object') {
        failures.push(`${base}(invalid-json)`)
        continue
      }

      return json
    } catch (error) {
      if (signal?.aborted) {
        throw new Error('Ollama 请求已取消')
      }
      failures.push(`${base}(${error?.message || 'network-error'})`)
    } finally {
      cleanup()
    }
  }

  throw new Error(`Ollama 请求失败: ${failures.join(', ')}`)
}

export async function generateStationNameCandidates({ context, lngLat, model = DEFAULT_OLLAMA_MODEL, signal } = {}) {
  if (!context || typeof context !== 'object') {
    throw new Error('缺少周边命名上下文')
  }

  const modelInput = projectContextForModel(context, lngLat)
  const systemPrompt = [
    '你是轨道交通车站命名评审助手。',
    '必须严格依据输入的道路/地域/公共设施/建筑证据命名，不得虚构不存在的地名或设施名。',
    '严格遵守以下中文标准：',
    CHINESE_NAMING_STANDARD,
    '严格遵守以下英文标准：',
    ENGLISH_NAMING_STANDARD,
    '输出约束：',
    '1) 仅输出 JSON；2) 必须给出恰好 5 个候选；3) 候选中英文名称均需互不重复；4) basis 仅可取 ①道路/②地域/③公共设施/④其它；5) reason 需简明说明导向性与优先级。',
  ].join('\n')

  const payload = {
    model,
    stream: false,
    format: STATION_NAME_RESPONSE_SCHEMA,
    options: {
      temperature: 0.2,
      top_p: 0.9,
    },
    messages: [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            task: '请根据输入上下文生成地铁车站命名候选。',
            output: '返回 candidates 数组，每项含 nameZh/nameEn/basis/reason。',
            context: modelInput,
          },
          null,
          2,
        ),
      },
    ],
  }

  const responsePayload = await postOllamaChat(payload, signal)
  const rawCandidates = extractCandidatesFromChatResponse(responsePayload)
  const normalized = dedupeCandidates(rawCandidates.map((item) => normalizeCandidate(item)).filter(Boolean))

  const fallbackCandidates = buildFallbackCandidatesFromContext(context)
  const merged = dedupeCandidates([...normalized, ...fallbackCandidates]).slice(0, 5)

  if (merged.length < 5) {
    throw new Error('周边命名要素不足，无法生成 5 个候选站名')
  }

  return merged
}

export { DEFAULT_OLLAMA_MODEL }
