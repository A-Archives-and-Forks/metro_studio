
import { postLLMChat } from './openrouterClient'
import { getAiConfig } from './aiConfig'

const BASIS_OPTIONS = ['①道路', '②地域', '③公共设施', '④其它']

// ── JSON Schema ─────────────────────────────────────────────

const CHINESE_NAME_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    nameZh: { type: 'string', minLength: 1, maxLength: 64 },
    basis: { type: 'string', enum: BASIS_OPTIONS },
    reason: { type: 'string', minLength: 1, maxLength: 300 },
  },
  required: ['nameZh', 'basis', 'reason'],
}

const ENGLISH_NAME_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    nameEn: { type: 'string', minLength: 1, maxLength: 96 },
  },
  required: ['nameEn'],
}

const BATCH_CHINESE_NAME_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    stations: {
      type: 'array',
      minItems: 0,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          stationId: { type: 'string', minLength: 1, maxLength: 128 },
          nameZh: { type: 'string', minLength: 1, maxLength: 64 },
          basis: { type: 'string', enum: BASIS_OPTIONS },
          reason: { type: 'string', minLength: 1, maxLength: 300 },
        },
        required: ['stationId', 'nameZh', 'basis', 'reason'],
      },
    },
  },
  required: ['stations'],
}

// ── 常量 ────────────────────────────────────────────────────

const STATION_SUFFIX_REGEX = /(地铁站|车站|站)$/u
const ENGLISH_STATION_SUFFIX_REGEX = /\b(?:metro\s+station|subway\s+station|railway\s+station|train\s+station|station)\b\.?$/iu
const RESIDENTIAL_NAME_REGEX = /(小区|家园|花园|公寓|宿舍|新村|社区|苑区?|住宅区)/u

// ── 工具函数 ────────────────────────────────────────────────

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
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

function stripChineseStationSuffix(text) {
  return String(text || '').trim().replace(STATION_SUFFIX_REGEX, '').trim()
}

function sanitizeEnglishStationName(text) {
  return String(text || '').trim().replace(ENGLISH_STATION_SUFFIX_REGEX, '').replace(/\s{2,}/g, ' ').trim()
}

function isResponseFormatError(error) {
  const text = String(error?.message || '').toLowerCase()
  return text.includes('response_format') || text.includes('json_schema') || text.includes('structured')
}

async function postWithFallback(payload, signal) {
  try {
    return await postLLMChat(payload, signal)
  } catch (error) {
    if (!payload?.response_format || !isResponseFormatError(error)) throw error
    const degraded = { ...payload }
    delete degraded.response_format
    return postLLMChat(degraded, signal)
  }
}

function extractContentText(payload) {
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (content && typeof content === 'object') {
    if (Array.isArray(content)) {
      return content.map((p) => (typeof p === 'string' ? p : String(p?.text || ''))).join('')
    }
    return JSON.stringify(content)
  }
  return ''
}

function parseJsonResponse(payload) {
  const text = extractContentText(payload)
  return extractJsonObject(text)
}

// ── 上下文 → 自然语言描述 ───────────────────────────────────

function formatItem(item) {
  const name = String(item?.nameZh || '').trim()
  if (!name) return ''
  const type = String(item?.type || '').trim()
  const dist = Math.round(toFiniteNumber(item?.distanceMeters, 0))
  return type ? `${name}（${type}，${dist}m）` : `${name}（${dist}m）`
}

function buildSurroundingsText(context, lngLat) {
  const [lng, lat] = Array.isArray(lngLat) && lngLat.length === 2 ? lngLat : context?.center || [0, 0]
  const radius = Math.round(toFiniteNumber(context?.radiusMeters, 300))
  const lines = [`站点坐标：${toFiniteNumber(lng).toFixed(6)}, ${toFiniteNumber(lat).toFixed(6)}，采样半径 ${radius}m。`]

  const categories = [
    { key: 'intersections', label: '道路交叉口' },
    { key: 'roads', label: '道路' },
    { key: 'areas', label: '地域/片区' },
    { key: 'facilities', label: '公共设施' },
    { key: 'buildings', label: '建筑' },
  ]

  for (const { key, label } of categories) {
    const items = Array.isArray(context?.[key]) ? context[key] : []
    const filtered = items
      .filter((item) => {
        const name = String(item?.nameZh || '').trim()
        if (!name) return false
        if (key !== 'intersections' && key !== 'roads' && RESIDENTIAL_NAME_REGEX.test(name)) return false
        return true
      })
      .slice(0, 8)
    if (!filtered.length) continue
    const descriptions = filtered.map(formatItem).filter(Boolean)
    if (descriptions.length) {
      lines.push(`${label}：${descriptions.join('、')}。`)
    }
  }

  return lines.join('\n')
}

// ── 第一阶段：生成中文站名 ──────────────────────────────────

const NAMING_SYSTEM_PROMPT = `你是一位中国城市轨道交通车站命名专家。根据站点周边的道路、地域和公共设施信息，为地铁车站选择一个最合适的中文名称。

命名原则：
- 优先使用站位邻近的道路交叉口或主干道路名称
- 其次考虑较为著名的公共设施（医院、大学、公园等）
- 也可使用有辨识度的地域或片区名称
- 选择导向性最强、辨识度最高的名称
- 名称应简洁，一般2-4个字，最多不超过6个字
- 末尾不要带"站""车站""地铁站"
- 严禁使用小区、社区、花园、公寓等居住区名称
- 不要编造周边信息中不存在的地名

仅输出 JSON，包含 nameZh、basis（①道路/②地域/③公共设施/④其它）和 reason（简述命名理由）。`

async function generateChineseName({ context, lngLat, model, signal }) {
  const surroundings = buildSurroundingsText(context, lngLat)

  const payload = {
    model,
    stream: false,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'station_chinese_name', strict: true, schema: CHINESE_NAME_RESPONSE_SCHEMA },
    },
    temperature: 0.3,
    top_p: 0.9,
    messages: [
      { role: 'system', content: NAMING_SYSTEM_PROMPT },
      { role: 'user', content: `请为以下站点选择一个最合适的中文站名：\n\n${surroundings}` },
    ],
  }

  const response = await postWithFallback(payload, signal)
  const parsed = parseJsonResponse(response)
  if (!parsed?.nameZh) throw new Error('AI 未返回有效中文站名')

  const nameZh = stripChineseStationSuffix(parsed.nameZh)
  if (!nameZh) throw new Error('AI 返回的中文站名为空')

  return {
    nameZh,
    basis: normalizeBasis(parsed.basis),
    reason: String(parsed.reason || '').trim(),
  }
}

// ── 第二阶段：翻译英文站名 ──────────────────────────────────

const TRANSLATION_SYSTEM_PROMPT = `你是中国城市轨道交通站名中译英专家。将给定的中文地铁站名翻译为英文。

翻译规则：
- 专名部分用汉语拼音，不标声调，多音节连写，各词首字母大写
- 通名部分意译：路/马路=Road，大道=Avenue，街=Street，公园=Park，医院=Hospital，大学=University
- 若"东/西/南/北"是道路专名的固有组成（如"二环南路""山师东路"），方位词不翻译，直接写入拼音（如 Erhuan Nanlu、Shanshi Donglu）
- 仅在表达独立方位修饰时才使用 East/West/South/North
- 公共机构名称必须意译通名（如 妇幼保健院=Maternal and Child Health Hospital）
- 末尾不要出现 Station、Metro Station、Subway Station

仅输出 JSON，包含 nameEn 字段。`

async function translateToEnglish({ nameZh, model, signal }) {
  const payload = {
    model,
    stream: false,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'station_english_name', strict: true, schema: ENGLISH_NAME_RESPONSE_SCHEMA },
    },
    temperature: 0.1,
    top_p: 0.8,
    messages: [
      { role: 'system', content: TRANSLATION_SYSTEM_PROMPT },
      { role: 'user', content: `请将以下中文地铁站名翻译为英文：${nameZh}` },
    ],
  }

  const response = await postWithFallback(payload, signal)
  const parsed = parseJsonResponse(response)
  const nameEn = sanitizeEnglishStationName(parsed?.nameEn)
  if (!nameEn) throw new Error('AI 未返回有效英文站名')
  return nameEn
}

// ── 对外接口：单站点 ────────────────────────────────────────

export async function generateStationNameCandidates({
  context,
  lngLat,
  model,
  signal,
} = {}) {
  if (!context || typeof context !== 'object') {
    throw new Error('缺少周边命名上下文')
  }

  let resolvedModel = model
  if (!resolvedModel) {
    resolvedModel = getAiConfig().model
  }
  if (!resolvedModel) {
    throw new Error('请先在「设置 → AI 配置」中填写模型名称')
  }

  // 第一阶段：生成中文站名
  const { nameZh, basis, reason } = await generateChineseName({ context, lngLat, model: resolvedModel, signal })

  // 第二阶段：翻译英文站名
  const nameEn = await translateToEnglish({ nameZh, model: resolvedModel, signal })

  // 返回单元素数组，保持与调用方兼容
  return [{ nameZh, nameEn, basis, reason }]
}

// ── 对外接口：批量 ──────────────────────────────────────────

async function generateChineseNamesBatch({ stations, model, signal }) {
  const stationDescriptions = stations.map((item) => {
    const surroundings = buildSurroundingsText(item.context, item.lngLat)
    return `【${item.stationId}】\n${surroundings}`
  })

  const payload = {
    model,
    stream: false,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'station_chinese_names_batch', strict: true, schema: BATCH_CHINESE_NAME_RESPONSE_SCHEMA },
    },
    temperature: 0.3,
    top_p: 0.9,
    messages: [
      { role: 'system', content: NAMING_SYSTEM_PROMPT + '\n\n你将收到多个站点的周边信息，请按 stationId 分别给出命名。输出 JSON 包含 stations 数组，每项含 stationId、nameZh、basis、reason。' },
      { role: 'user', content: `请为以下各站点分别选择一个最合适的中文站名：\n\n${stationDescriptions.join('\n\n')}` },
    ],
  }

  const response = await postWithFallback(payload, signal)
  const parsed = parseJsonResponse(response)
  return Array.isArray(parsed?.stations) ? parsed.stations : []
}

export async function generateStationNameCandidatesBatch({
  stations,
  model,
  signal,
} = {}) {
  const stationItems = Array.isArray(stations) ? stations : []
  if (!stationItems.length) return []

  let resolvedModel = model
  if (!resolvedModel) {
    resolvedModel = getAiConfig().model
  }
  if (!resolvedModel) {
    throw new Error('请先在「设置 → AI 配置」中填写模型名称')
  }

  const prepared = []
  const failures = []
  const seen = new Set()

  for (const item of stationItems) {
    const stationId = String(item?.stationId || '').trim()
    if (!stationId || seen.has(stationId)) continue
    seen.add(stationId)

    const ctx = item?.context
    if (!ctx || typeof ctx !== 'object') {
      failures.push({ stationId, candidates: [], error: '缺少周边命名上下文' })
      continue
    }

    prepared.push({
      stationId,
      lngLat: Array.isArray(item?.lngLat) ? item.lngLat : ctx.center || [0, 0],
      context: ctx,
    })
  }

  if (!prepared.length) return failures

  // 第一阶段：批量生成中文站名
  let rawResults = []
  try {
    rawResults = await generateChineseNamesBatch({ stations: prepared, model: resolvedModel, signal })
  } catch (error) {
    const message = String(error?.message || 'AI 批量请求失败')
    return [
      ...prepared.map((item) => ({ stationId: item.stationId, candidates: [], error: message })),
      ...failures,
    ]
  }

  const zhMap = new Map()
  for (const raw of rawResults) {
    const id = String(raw?.stationId || '').trim()
    if (!id || zhMap.has(id)) continue
    const nameZh = stripChineseStationSuffix(raw?.nameZh)
    if (!nameZh) continue
    zhMap.set(id, {
      nameZh,
      basis: normalizeBasis(raw?.basis),
      reason: String(raw?.reason || '').trim(),
    })
  }

  // 第二阶段：逐个翻译英文站名
  const results = []
  for (const item of prepared) {
    const zh = zhMap.get(item.stationId)
    if (!zh) {
      results.push({ stationId: item.stationId, candidates: [], error: 'AI 未返回该站点的中文站名' })
      continue
    }
    try {
      const nameEn = await translateToEnglish({ nameZh: zh.nameZh, model: resolvedModel, signal })
      results.push({
        stationId: item.stationId,
        candidates: [{ nameZh: zh.nameZh, nameEn, basis: zh.basis, reason: zh.reason }],
        error: '',
      })
    } catch {
      // 翻译失败时仍返回中文名，英文名留空
      results.push({
        stationId: item.stationId,
        candidates: [{ nameZh: zh.nameZh, nameEn: '', basis: zh.basis, reason: zh.reason }],
        error: '',
      })
    }
  }

  return [...results, ...failures]
}
