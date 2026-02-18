
import { postLLMChat } from './openrouterClient'
import { getAiConfig } from './aiConfig'
import { extractJsonObject } from './jsonUtils'

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

const BATCH_ENGLISH_NAME_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    translations: {
      type: 'array',
      minItems: 0,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          stationId: { type: 'string', minLength: 1, maxLength: 128 },
          nameEn: { type: 'string', minLength: 1, maxLength: 96 },
        },
        required: ['stationId', 'nameEn'],
      },
    },
  },
  required: ['translations'],
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

const NAMING_SYSTEM_PROMPT = `明白了，非常抱歉刚才的理解存在偏差。你的核心逻辑是：**“大路避雷，小路可用；后缀去‘地铁’，但留‘枢纽’”**。

针对这两点核心反馈：

1. **路名逻辑**：主干道因纵深太长，无法起到精准定位作用（即“同路不同站”），因此禁选；而支路（小路）具备唯一性，是优选。
2. **后缀逻辑**：禁止的是“地铁站”这种功能性冗余，但需要保留“火车站、汽车站”这种作为地标属性的完整名称。

以下是为你重新梳理、优先级逻辑严密的 Prompt：

---

### 城市轨道交通车站命名专家 (优化版)

# 角色定位

你是一位专业的中国城市轨道交通命名专家。你的任务是根据站点周边的道路、地理、设施信息，选定一个定位精准、符合逻辑且简洁的车站名称。

# 命名优先级 (由高到低)

1. **公共交通枢纽名**：若站点连接大型交通枢纽，必须使用全称（如：XX火车站、XX汽车站、XX客运枢纽）。
2. **著名公共设施**：具有极高辨识度的永久性设施（如：医院、大学、公园、大型体育馆、历史古迹）。
3. **地标性地域/片区名**：具有广泛社会认知的自然地理名称或片区称谓。
4. **支路路口名 (重点)**：
* **允许使用**：站点与**非主干道（支路、小路）**的交叉口。
* **逻辑**：支路名称在区域内具有唯一性和精准导向性。

# 强制性禁令 (红线)

* **严禁主干道名**：禁止直接使用主干道路名称（如：北京路、中山大道），因为主干道过长，无法提供有效定位。
* **严禁居住区名**：绝对禁止使用小区、社区、公寓、楼盘等任何形式的居住区名称。
* **严禁编造地名**：仅限使用用户提供的周边信息，不得凭空构思。
* **后缀去冗余**：
* 严禁在末尾添加“站”、“地铁站”或“车站”来指代本设施。
* **特殊豁免**：若该站是为“火车站”或“汽车站”服务，必须保留其完整名称。

# 格式与字数要求

* **简洁度**：字数控制在 2-8 字之间（通常 2-4 字最佳）。
* **唯一性**：选择在该区域内导向性最强、辨识度最高的方案。

# 输出要求

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

const TRANSLATION_SYSTEM_PROMPT = `# Role
你是一位精通中国城市轨道交通标识（Signage）标准的英译专家。你的任务是将中文地铁站名精准翻译为英文。

# 翻译规则

## 1. 专名处理 (Proper Names)
- 采用汉语拼音。
- **格式**：首字母大写，多音节词组连写（如：王府井 -> Wangfujing）。
- **禁忌**：不标注声调，严禁出现中文。

## 2. 通名意译 (Common Nouns)
遇到以下词汇必须意译，首字母大写：
- 路/马路 = Road
- 大道 = Avenue
- 街 = Street
- 桥/立交桥 = Bridge (城市内建议统一用 Bridge)
- 公园 = Park
- 医院 = Hospital
- 大学 = University | 中学 = High School | 小学 = Primary School
- 广场 = Square
- 博物馆 = Museum
- 体育馆 = Gymnasium | 体育场 = Stadium

## 3. 方位词处理逻辑 (核心逻辑)
请严格按以下逻辑判断方位词（东/西/南/北）：
- **情况 A：作为道路名称的固有部分**（即：这路本来就叫这名）
  - *判断规则*：方位词在“路/大道/街”之前，且与前词共同构成地名。
  - *处理*：**拼音连写**，不翻译。
  - *示例*：二环南路 -> Erhuan Nanlu；山师东路 -> Shanshi Donglu。
- **情况 B：作为方位的修饰限定**（即：该站在地标的哪个方位）
  - *判断规则*：方位词位于词尾，且该地标是一个独立的地点或区域。
  - *处理*：**意译为 East/West/South/North**。
  - *示例*：西单北 -> Xidan North；奥体中心南 -> Olympic Sports Center South。

## 4. 公共机构与特殊处理
- 必须完整翻译机构性质。
- *示例*：妇幼保健院 -> Maternal and Child Health Hospital；省中医院 -> Provincial Hospital of TCM。
- **后缀禁令**：严禁在末尾出现 Station, Metro Station, Subway Station。

# 输出格式
- 仅输出 JSON 格式。
- 包含字段：nameEn`

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

async function translateToEnglishBatch({ stations, model, signal }) {
  if (!stations || !stations.length) return []

  const stationDescriptions = stations.map(
    (item) => `【${item.stationId}】${item.nameZh}`
  ).join('\n')

  const payload = {
    model,
    stream: false,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'station_english_names_batch', strict: true, schema: BATCH_ENGLISH_NAME_RESPONSE_SCHEMA },
    },
    temperature: 0.1,
    top_p: 0.8,
    messages: [
      { role: 'system', content: TRANSLATION_SYSTEM_PROMPT + '\n\n你将收到多个中文地铁站名，请按 stationId 分别给出英文翻译。输出 JSON 包含 translations 数组，每项含 stationId、nameEn。' },
      { role: 'user', content: `请批量翻译以下中文地铁站名为英文：\n\n${stationDescriptions}` },
    ],
  }

  const response = await postWithFallback(payload, signal)
  const parsed = parseJsonResponse(response)
  const translations = Array.isArray(parsed?.translations) ? parsed.translations : []

  const enMap = new Map()
  for (const t of translations) {
    const id = String(t?.stationId || '').trim()
    if (!id) continue
    const nameEn = sanitizeEnglishStationName(t?.nameEn)
    if (!nameEn) continue
    enMap.set(id, nameEn)
  }

  return enMap
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

  // 第二阶段：批量翻译英文站名
  const zhStations = prepared
    .filter((item) => zhMap.has(item.stationId))
    .map((item) => ({ stationId: item.stationId, nameZh: zhMap.get(item.stationId).nameZh }))

  const results = []

  try {
    const enMap = await translateToEnglishBatch({ stations: zhStations, model: resolvedModel, signal })

    for (const item of prepared) {
      const zh = zhMap.get(item.stationId)
      if (!zh) {
        results.push({ stationId: item.stationId, candidates: [], error: 'AI 未返回该站点的中文站名' })
        continue
      }
      const nameEn = enMap.get(item.stationId) || ''
      results.push({
        stationId: item.stationId,
        candidates: [{ nameZh: zh.nameZh, nameEn, basis: zh.basis, reason: zh.reason }],
        error: '',
      })
    }
  } catch {
    // 批量翻译失败,并行翻译每个站点
    const translationPromises = prepared.map(async (item) => {
      const zh = zhMap.get(item.stationId)
      if (!zh) {
        return { stationId: item.stationId, candidates: [], error: 'AI 未返回该站点的中文站名' }
      }
      try {
        const nameEn = await translateToEnglish({ nameZh: zh.nameZh, model: resolvedModel, signal })
        return {
          stationId: item.stationId,
          candidates: [{ nameZh: zh.nameZh, nameEn, basis: zh.basis, reason: zh.reason }],
          error: '',
        }
      } catch {
        return {
          stationId: item.stationId,
          candidates: [{ nameZh: zh.nameZh, nameEn: '', basis: zh.basis, reason: zh.reason }],
          error: '',
        }
      }
    })

    const translationResults = await Promise.allSettled(translationPromises)
    for (const result of translationResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value)
      }
    }
  }

  return [...results, ...failures]
}
