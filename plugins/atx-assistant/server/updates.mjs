import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, copyFileSync, chmodSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { modelsPath, settingsPath, readModels, loadSettings, resolveCredential, publicBaseUrl, normalizeBaseUrl, modelEntry } from './config.mjs'

export const PLAN_TTL_MS = 10 * 60 * 1000
const fields = { tools: 'supportsToolCall', images: 'supportsImages', reasoning: 'supportsReasoning' }
const mediaFields = { image: 'imageModel', vision: 'visionModel', gif: 'gifModel' }
const tri = value => value === true ? true : value === false ? false : null
const json = path => {
  try { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) : null }
  catch { throw new Error('本地 JSON 无法读取，未披露原始内容；请检查配置。') }
}
function safeModels(path) {
  try { return readModels(path) } catch { throw new Error('models.json 无法读取或结构不受支持，未披露原始内容。') }
}
function safeSettings(ctx, env) {
  try { return ctx.settings ? ctx.settings() : loadSettings(env) } catch { throw new Error('本地设置无法读取，未披露原始内容。') }
}
const digest = value => createHash('sha256').update(value).digest('hex')
const validId = value => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value, 'utf8') <= 256 && !/[\s\p{Cc}\p{Cf}]/u.test(value)
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
async function safeRequest(request, message) {
  try { return await request() } catch { throw new Error(message) }
}
const fail = message => { throw new Error(message) }
function sourceOf(state) {
  const source = state?.source
  if (!source || typeof source !== 'object' || source.schemaVersion !== 1 ||
      typeof source.baseURL !== 'string' || normalizeBaseUrl(source.baseURL) !== source.baseURL ||
      source.origin !== new URL(source.baseURL).origin) fail('清单来源标识无效，拒绝应用。')
  return source.baseURL
}
const sourceIdentity = state => ({ baseURL: sourceOf(state), origin: state.source.origin, schemaVersion: state.source.schemaVersion })
function safeBase(url) { try { return normalizeBaseUrl(url) } catch { return null } }
function statePaths(env) {
  const root = join(dirname(settingsPath(env)), 'updates')
  return { root, baseline: join(root, 'baseline.json'), models: modelsPath(env), settings: settingsPath(env),
    legacy: env.ATX_DATA_DIR && !env.ATX_DATA_DIR.includes('${') ? join(env.ATX_DATA_DIR, 'settings.json') : null }
}
function fingerprint(paths, env) {
  return digest(JSON.stringify([...[paths.models, paths.settings, paths.legacy].map(path => path && existsSync(path) ? readFileSync(path).toString('base64') : null),
    env.AITRANSX_API_KEY ?? null, env.AITRANSX_BASE_URL ?? null]))
}
function atomic(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.tmp-${randomUUID()}`
  try {
    writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    chmodSync(temp, 0o600)
    renameSync(temp, path)
  } finally { if (existsSync(temp)) unlinkSync(temp) }
}
function modelsOf(manifest) {
  const table = new Map()
  const insert = (value, kind) => {
    const item = typeof value === 'string' ? { id: value } : value
    if (!item || !validId(item.id)) return
    const current = table.get(item.id) || { id: item.id, chat: false, media: {} }
    const caps = item.capabilities || item
    if ((kind === 'chat' && caps.chat !== false) || item.chat === true || caps.chat === true) {
      current.chat = true
      for (const field of Object.keys(fields)) current[field] = tri(caps[field])
    }
    for (const field of Object.keys(mediaFields)) if (caps[field] === true) current.media[field] = true
    current.verified = item.verified === true && current.verified !== false
    current.deprecated = item.deprecated === true || current.deprecated === true
    table.set(item.id, current)
  }
  for (const item of manifest.recommendedChat || []) insert(item, 'chat')
  for (const item of Array.isArray(manifest.models) ? manifest.models : []) insert(item)
  for (const item of manifest.chat || []) insert(item, 'chat')
  for (const item of manifest.mediaModels || manifest.media || []) insert(item, 'media')
  for (const value of manifest.deprecated || []) {
    const id = typeof value === 'string' ? value : value?.id
    if (table.has(id)) table.get(id).deprecated = true
  }
  return [...table.values()]
}
function available(state) {
  return new Set((state?.models || []).filter(m => m.availability === 'available').map(m => m.id))
}
function publicPlan(plan) {
  const { fingerprint: _fingerprint, baselineFingerprint: _baselineFingerprint, used: _used, ...result } = plan
  return result
}
function assertManifest(state) {
  if (!state?.manifest || typeof state.revision !== 'string' || !state.revision || state.canApply !== true || state.freshness !== 'fresh' || state.blockedActions?.length) {
    fail('清单当前不可应用（包括 503、离线或过期状态）；未写入业务配置。')
  }
}

export function createUpdates(ctx) {
  const env = ctx.env || process.env
  const now = ctx.now || Date.now
  const paths = statePaths(env)
  const baselineHash = () => digest(existsSync(paths.baseline) ? readFileSync(paths.baseline) : '')
  let busy = false

  async function check({ force = false } = {}) {
    if (typeof force !== 'boolean') fail('force 必须为布尔值。')
    // 公开清单请求先完成；本模块不向该请求传入或解析凭据。
    const state = await safeRequest(() => ctx.manifest.check({ force }), '公开清单检查失败，未披露上游错误。')
    if (!state?.manifest) fail('无法读取更新清单。')
    const source = sourceOf(state)
    let configuredSource
    try { configuredSource = publicBaseUrl(env) } catch { fail('公开线路配置无法读取，未披露原始内容。') }
    if (configuredSource !== source) fail('清单来源与公开配置线路不一致；请明确配置同一精确线路后重新检查。')
    const initialFingerprint = fingerprint(paths, env)
    const initialBaseline = baselineHash()
    const local = safeModels(paths.models)
    const settings = safeSettings(ctx, env)
    const baseline = json(paths.baseline)
    let catalog
    try { catalog = await (force ? ctx.catalog.refresh() : ctx.catalog.ensureFresh()) }
    catch { catalog = { models: [], lastSuccess: null, lastError: '独立目录检查失败' } }
    const catalogReady = !!catalog && !catalog.lastError && !!catalog.lastSuccess
    const ids = catalogReady ? available(catalog) : new Set()
    const candidates = modelsOf(state.manifest)
    const additions = [], media = [], changes = [], conflicts = [], absent = [], deprecated = []
    for (const item of candidates) {
      if (!ids.has(item.id)) absent.push({ id: item.id, availability: catalogReady ? 'missing' : 'unknown', reason: catalogReady ? '目录未确认可用' : '目录检查失败，可用性未知，不视为不存在' })
      if (item.deprecated) deprecated.push(item.id)
      const existing = local.models.filter(m => m?.id === item.id)
      const conflict = existing.length > 1 || existing.some(m => safeBase(m.url) !== source)
      if (conflict) conflicts.push({ id: item.id, reason: '同 ID 非 ATX、不同精确线路或重复条目，禁止覆盖' })
      if (item.chat && item.tools !== false && !item.deprecated && !existing.length && ids.has(item.id)) additions.push(item)
      if (Object.keys(item.media).length && !item.deprecated && ids.has(item.id)) {
        const existingMedia = settings.models?.find(m => m.id === item.id)
        const personal = Object.keys(item.media).some(capability => existingMedia && Object.hasOwn(existingMedia, capability) && existingMedia[capability] !== true)
        media.push({ id: item.id, capabilities: item.media, verified: item.verified, blocked: personal,
          ...(personal ? { reason: '现有个人媒体能力声明不同，禁止覆盖；请另行明确配置' } : {}) })
      }
      if (item.chat && existing.length === 1 && !conflict) {
        const previous = baseline?.source === source && equal(baseline.sourceIdentity, sourceIdentity(state)) ? baseline.models?.[item.id] : null
        for (const [capability, field] of Object.entries(fields)) {
          if (equal(existing[0][field], item[capability])) continue
          const managed = previous && Object.hasOwn(previous, field) && equal(existing[0][field], previous[field])
          changes.push({ changeId: `field:${item.id}:${field}`, id: item.id, field, value: item[capability],
            verified: item.verified, personal: !managed, blocked: capability === 'tools' && item.tools === false,
            reason: managed ? '清单管理字段更新，仍须显式选择' : '个人字段或没有基线，禁止覆盖' })
        }
      }
    }
    const defaults = []
    for (const [capability, field] of Object.entries(mediaFields)) {
      const suggested = state.manifest.mediaDefaults?.[capability]
      const id = typeof suggested === 'string' ? suggested : suggested?.id
      if (!validId(id) || !media.some(m => m.id === id && m.capabilities[capability] === true)) continue
      const mode = settings.mediaModes?.[capability] || 'fixed'
      if (settings[field] !== id || mode !== 'fixed') defaults.push({ changeId: `default:${capability}:fixed`, capability, field, id, mode: 'fixed' })
      defaults.push({ changeId: `default:${capability}:follow`, capability, field, id, mode: 'follow' })
    }
    for (const value of state.manifest.deprecated || []) {
      const id = typeof value === 'string' ? value : value?.id
      if (validId(id) && !deprecated.includes(id)) deprecated.push(id)
    }
    const replacements = []
    const suggestedReplacements = [...(state.manifest.replacements || []), ...(state.manifest.deprecated || []).filter(m => typeof m === 'object' && (m.replacement || m.replacedBy)).map(m => ({ from: m.id, to: m.replacement || m.replacedBy }))]
    for (const replacement of suggestedReplacements) {
      if (!validId(replacement?.from) || !validId(replacement?.to)) continue
      if (local.models.some(m => m?.id === replacement.from && safeBase(m.url) === source) && additions.some(m => m.id === replacement.to)) {
        replacements.push({ from: replacement.from, to: replacement.to, removeOld: false })
      }
    }
    if (initialFingerprint !== fingerprint(paths, env) || initialBaseline !== baselineHash()) fail('检查期间配置已变化，请重新检查。')
    const plan = { planId: randomUUID(), source, sourceIdentity: sourceIdentity(state), revision: state.revision, schemaVersion: state.manifest.schemaVersion,
      createdAt: now(), expiresAt: now() + PLAN_TTL_MS, freshness: state.freshness, lastValidatedAt: state.lastValidatedAt,
      canApply: state.canApply === true && state.freshness === 'fresh' && !state.blockedActions?.length && catalogReady,
      blockedActions: [...new Set([...(state.blockedActions || []), ...(!catalogReady ? ['apply'] : [])])],
      catalogStatus: catalogReady ? 'fresh' : 'unavailable', additions, media, changes, conflicts, deprecated, replacements, absent, defaults,
      fingerprint: initialFingerprint, baselineFingerprint: initialBaseline,
      note: '公开清单请求不读取凭据。目录确认是独立的鉴权请求，可能读取本地凭据；目录存在不证明能力。未验证或未知能力需另行确认。未选择的操作绝不应用。' }
    atomic(join(paths.root, `${plan.planId}.json`), plan)
    return publicPlan(plan)
  }

  async function apply(args = {}) {
    if (busy) fail('另一个更新正在执行，请稍后重新检查。')
    busy = true
    try { return await applyInternal(args) } finally { busy = false }
  }
  async function applyInternal(args) {
    const allowed = ['planId', 'confirm', 'addIds', 'replacements', 'overrideChangeIds', 'defaultChangeIds', 'mediaIds', 'confirmUnverified']
    if (Object.keys(args).some(key => !allowed.includes(key))) fail('包含未实现或未知的操作。')
    if (args.confirm !== true || !/^[0-9a-f-]{36}$/i.test(args.planId || '')) fail('必须提供 planId 和 confirm=true。')
    if (args.confirmUnverified !== undefined && typeof args.confirmUnverified !== 'boolean') fail('confirmUnverified 必须为布尔值。')
    const lists = {}
    for (const [key, max] of [['addIds', 50], ['mediaIds', 50], ['replacements', 50], ['overrideChangeIds', 100], ['defaultChangeIds', 3]]) {
      lists[key] = args[key] ?? []
      if (!Array.isArray(lists[key]) || lists[key].length > max || new Set(lists[key].map(v => JSON.stringify(v))).size !== lists[key].length) fail(`${key} 数量、类型或重复选项不合法。`)
    }
    const path = join(paths.root, `${args.planId}.json`)
    const plan = json(path)
    if (!plan || plan.planId !== args.planId || plan.used || now() >= plan.expiresAt) fail('计划不存在、已过期或已经使用，请重新检查。')
    if (!plan.canApply) fail('该计划不可应用，请重新检查。')
    if (plan.fingerprint !== fingerprint(paths, env) || plan.baselineFingerprint !== baselineHash()) fail('配置指纹已变化，请重新检查。')
    const state = await safeRequest(() => ctx.manifest.check({ force: true }), '公开清单强制复查失败，禁止写入。')
    assertManifest(state)
    if (sourceOf(state) !== plan.source || !equal(sourceIdentity(state), plan.sourceIdentity) || state.revision !== plan.revision || state.manifest.schemaVersion !== plan.schemaVersion) fail('清单来源、revision 或 schema 已变化，请重新检查。')
    const catalog = await safeRequest(() => ctx.catalog.refresh(), '独立目录刷新失败，禁止写入。')
    if (catalog?.lastError || !catalog?.lastSuccess) fail('目录刷新失败，禁止写入。')
    const ids = available(catalog)
    const select = (keys, items, property) => keys.map(key => items.find(item => item[property] === key) || fail('选择不属于该计划。'))
    const additions = select(lists.addIds, plan.additions, 'id')
    const media = select(lists.mediaIds, plan.media, 'id')
    const changes = select(lists.overrideChangeIds, plan.changes, 'changeId')
    const defaults = select(lists.defaultChangeIds, plan.defaults, 'changeId')
    if (new Set(defaults.map(item => item.capability)).size !== defaults.length) fail('同一媒体能力不能选择多个模式。')
    const replacements = lists.replacements.map(item => {
      if (!item || Object.keys(item).some(key => !['from', 'to', 'removeOld'].includes(key)) || (item.removeOld !== undefined && typeof item.removeOld !== 'boolean')) fail('替代操作参数不合法。')
      if (!plan.replacements.some(r => r.from === item.from && r.to === item.to)) fail('替代操作不属于该计划。')
      if (item.removeOld === true) fail('此版本不实现移除旧模型，请保留 removeOld=false；可另行明确删除。')
      const target = plan.additions.find(m => m.id === item.to)
      if (!additions.some(m => m.id === target.id)) additions.push(target)
      return { from: item.from, to: item.to, removeOld: false }
    })
    if (new Set(replacements.map(r => r.from)).size !== replacements.length) fail('同一旧模型不能重复替代。')
    if (media.some(item => item.blocked)) fail('所选媒体能力与个人声明冲突，禁止覆盖。')
    if (changes.some(change => change.personal || change.blocked)) fail('所选字段属于个人修改、无基线或明确不支持工具调用，禁止覆盖。')
    for (const item of [...additions, ...media, ...changes, ...defaults]) if (!ids.has(item.id)) fail('所选模型未在新鲜目录中确认可用。')
    if ([...additions, ...media, ...changes].some(item => item.verified !== true || Object.keys(fields).some(field => field in item && item[field] === null) || ('value' in item && item.value === null)) && args.confirmUnverified !== true) fail('包含未验证或未知能力，必须显式 confirmUnverified=true。')
    // 只有应用阶段解析凭据；必须与计划的精确线路一致。
    let credential
    try { credential = resolveCredential(env) } catch { fail('本地凭据配置无法读取，未披露原始内容。') }
    if (credential.baseUrl !== plan.source) fail('本地凭据线路与公开清单线路不一致，禁止跨来源应用。请明确设置 AITRANSX_BASE_URL 或插件 baseUrl 为同一精确线路，然后重新检查；不会自动跟随已有模型凭据切换清单来源。')
    if (additions.length && !credential.key) fail('未找到可用于导入的本地凭据。')
    const local = safeModels(paths.models)
    const stored = json(paths.settings) || {}
    const effective = safeSettings(ctx, env)
    const settings = { ...stored }
    const merged = local.models.map(model => ({ ...model }))
    const oldBaseline = json(paths.baseline)
    const baseline = oldBaseline?.source === plan.source && equal(oldBaseline.sourceIdentity, plan.sourceIdentity) ? structuredClone(oldBaseline) : { source: plan.source, sourceIdentity: plan.sourceIdentity, models: {} }
    baseline.models ||= {}
    for (const item of additions) {
      if (merged.some(m => m.id === item.id)) fail('新增模型出现同 ID 冲突。')
      if (item.tools === false) fail('明确不支持工具调用的模型禁止导入。')
      const entry = modelEntry(item.id, { baseUrl: plan.source, key: credential.key })
      baseline.models[item.id] = {}
      for (const [capability, field] of Object.entries(fields)) {
        entry[field] = item[capability] === true || (capability === 'tools' && item[capability] === null && args.confirmUnverified === true)
        baseline.models[item.id][field] = entry[field]
      }
      merged.push(entry)
    }
    for (const change of changes) {
      const entry = merged.find(m => m.id === change.id)
      if (!entry || safeBase(entry.url) !== plan.source) fail('字段更新存在来源冲突。')
      entry[change.field] = change.value === true || (change.field === 'supportsToolCall' && change.value === null && args.confirmUnverified === true)
      baseline.models[change.id] ||= {}
      baseline.models[change.id][change.field] = entry[change.field]
    }
    if (media.length) {
      settings.models = (effective.models || []).map(m => ({ ...m }))
      for (const item of media) {
        let entry = settings.models.find(m => m.id === item.id)
        if (!entry) { entry = { id: item.id }; settings.models.push(entry) }
        for (const capability of Object.keys(mediaFields)) if (item.capabilities[capability] === true) entry[capability] = true
      }
    }
    for (const item of defaults) {
      if (!(settings.models || effective.models || []).some(m => m.id === item.id && m[item.capability] === true)) fail('默认模型能力尚未确认，请同时选择对应 mediaIds。')
      settings[item.field] = item.id
      settings.mediaModes = { image: 'fixed', vision: 'fixed', gif: 'fixed', ...effective.mediaModes, ...settings.mediaModes, [item.capability]: item.mode }
      if (item.mode === 'follow') {
        const prior = settings.manifestAuthorization || effective.manifestAuthorization
        const authorized = prior?.source === plan.source && Array.isArray(prior.models) ? prior.models : []
        settings.manifestAuthorization = { source: plan.source, models: [...new Set([...authorized, item.id])] }
      }
    }
    if (plan.fingerprint !== fingerprint(paths, env) || plan.baselineFingerprint !== baselineHash()) fail('验证期间配置已变化，请重新检查。')
    const writes = []
    if (additions.length || changes.length) writes.push([paths.models, local.layout === 'object' ? { ...local.raw, models: merged } : merged])
    if (media.length || defaults.length) writes.push([paths.settings, settings])
    if (writes.length) {
      baseline.revision = plan.revision
      writes.push([paths.baseline, baseline])
    }
    const backups = [], written = []
    // 先消耗计划；部分提交失败后不能使用同一计划重试。
    atomic(path, { ...plan, used: true })
    try {
      for (const [target] of writes) {
        if (existsSync(target)) {
          const backup = `${target}.bak-${randomUUID()}`
          copyFileSync(target, backup)
          chmodSync(backup, 0o600)
          backups.push({ path: target, backup })
        } else backups.push({ path: target, backup: null, originallyAbsent: true })
      }
      for (const [target, value] of writes) { atomic(target, value); written.push(target) }
    } catch {
      return { applied: false, partial: written.length > 0, written, recovery: backups,
        error: '多文件提交失败，不保证跨文件原子性。请按 recovery 中实际备份路径恢复；原本不存在的文件需手动核对。计划已消耗。' }
    }
    let reloadFailed = false
    if (writes.length) { try { await ctx.reload?.() } catch { reloadFailed = true } }
    return { applied: writes.length > 0, added: additions.map(m => m.id), media: media.map(m => m.id),
      changed: changes.map(m => m.changeId), defaults: defaults.map(m => m.changeId), replacements, backups, reloadFailed,
      note: writes.length ? '已按显式选择应用；未删除 deprecated 或旧模型。聊天模型变更后须从托盘彻底退出 WorkBuddy 再打开。' : '未选择操作，业务文件未写入。' }
  }
  return { check, apply }
}
