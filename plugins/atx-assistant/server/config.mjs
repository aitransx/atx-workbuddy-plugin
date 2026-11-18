// Local configuration: WorkBuddy models.json access, ATX key discovery and plugin settings.
// Secrets are never returned to callers that render output; only masked forms are exposed.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { join, dirname } from 'node:path'
import { SEED_MODELS, MEDIA_DEFAULTS } from './catalog.mjs'

export const DEFAULT_BASE_URL = 'https://api.aitransx.com/v1'
export const KEY_PATTERN = /^aitx-[A-Za-z0-9]{16,}$/

export function workbuddyDir(env = process.env) {
  return env.WORKBUDDY_HOME || join(homedir(), '.workbuddy')
}
export function modelsPath(env = process.env) { return join(workbuddyDir(env), 'models.json') }
export function settingsPath(env = process.env) {
  return join(workbuddyDir(env), 'atx-assistant', 'settings.json')
}
function storedSettings(env) {
  const legacy = env.ATX_DATA_DIR && !env.ATX_DATA_DIR.includes('${') ? join(env.ATX_DATA_DIR, 'settings.json') : null
  // 主配置逐字段优先，旧插件数据只作兼容读取，不复制密钥到另一目录。
  let previous = {}
  if (legacy && legacy !== settingsPath(env)) {
    try { previous = readJson(legacy, {}) } catch { /* 可选旧配置损坏不能阻断主配置。 */ }
  }
  return { ...previous, ...readJson(settingsPath(env), {}) }
}

export function normalizeBaseUrl(value) {
  const invalid = () => new Error('只接受 aitransx.com 域名下的 HTTPS 地址，不允许 userinfo、query 或 fragment。')
  if (typeof value !== 'string') throw invalid()
  const text = value.trim()
  if (!text || /[\u0000-\u0020\\?#]/u.test(text) || !/^https:\/\//i.test(text)) throw invalid()
  let url
  try { url = new URL(text) } catch { throw invalid() }
  if (url.protocol !== 'https:' || url.username || url.password || text.slice(8).split('/')[0].includes('@') ||
      !(url.hostname === 'aitransx.com' || url.hostname.endsWith('.aitransx.com'))) throw invalid()
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')
  return url.href.replace(/\/+$/, '')
}
export const isAtxUrl = value => {
  try { normalizeBaseUrl(value); return true } catch { return false }
}
export const baseFromChatUrl = normalizeBaseUrl
export const mask = key => typeof key === 'string' && key.length > 12 ? `${key.slice(0, 7)}…${key.slice(-4)}` : '(未设置)'

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback
  const raw = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').trim()
  return raw ? JSON.parse(raw) : fallback
}
function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

/** Read WorkBuddy custom models; supports both the bare array and { models: [...] } layouts. */
export function readModels(path = modelsPath()) {
  const data = readJson(path, [])
  if (Array.isArray(data)) return { layout: 'array', models: data, raw: data }
  if (data && Array.isArray(data.models)) return { layout: 'object', models: data.models, raw: data }
  throw new Error('models.json 格式不受支持，未写入；请先检查或恢复备份。')
}

export const DEFAULT_SETTINGS = Object.freeze({
  baseUrl: '',
  imageModel: MEDIA_DEFAULTS.image,
  visionModel: MEDIA_DEFAULTS.vision,
  models: SEED_MODELS.map(({ id, vision, image }) => ({ id, vision, image })),
  refreshHours: 24,
  searchEnabled: true,
  imageEnabled: true,
  visionEnabled: true,
  timeoutMs: 180000,
})

export function loadSettings(env = process.env) {
  const stored = storedSettings(env)
  if (stored.baseUrl) stored.baseUrl = normalizeBaseUrl(stored.baseUrl)
  return { ...DEFAULT_SETTINGS, ...stored, models: Array.isArray(stored.models) ? stored.models : DEFAULT_SETTINGS.models.map(m => ({ ...m })) }
}
export function saveSettings(patch, env = process.env) {
  const path = settingsPath(env)
  const current = storedSettings(env)
  const merged = { ...current, ...patch }
  if (merged.baseUrl) merged.baseUrl = normalizeBaseUrl(merged.baseUrl)
  writeJson(path, merged)
  return loadSettings(env)
}

/**
 * Resolve the ATX credential. Priority: env AITRANSX_API_KEY → key saved by atx_set_key →
 * an existing ATX entry in WorkBuddy models.json (so users who already configured ATX models need nothing else).
 */
export function resolveCredential(env = process.env) {
  const settings = loadSettings(env)
  const envKey = env.AITRANSX_API_KEY && !env.AITRANSX_API_KEY.includes('${') ? env.AITRANSX_API_KEY.trim() : ''
  const rawBase = env.AITRANSX_BASE_URL && !env.AITRANSX_BASE_URL.includes('${') ? env.AITRANSX_BASE_URL.trim() : ''
  const envBase = rawBase ? normalizeBaseUrl(rawBase) : ''
  if (envKey) return { key: envKey, source: 'env:AITRANSX_API_KEY', baseUrl: envBase || settings.baseUrl || DEFAULT_BASE_URL }
  if (settings.apiKey) return { key: settings.apiKey, source: 'plugin-settings', baseUrl: envBase || settings.baseUrl || DEFAULT_BASE_URL }
  let found = []
  try { found = readModels(modelsPath(env)).models.filter(m => m && isAtxUrl(m.url) && typeof m.apiKey === 'string' && m.apiKey.trim()) } catch { /* unreadable models.json */ }
  const keys = [...new Set(found.map(m => m.apiKey.trim()))]
  if (keys.length === 1) return { key: keys[0], source: 'workbuddy-models.json', baseUrl: envBase || settings.baseUrl || baseFromChatUrl(found[0].url) }
  if (keys.length > 1) return { key: '', source: 'ambiguous', baseUrl: envBase || settings.baseUrl || DEFAULT_BASE_URL, diagnostic: `models.json 中发现 ${keys.length} 个不同的 ATX Key，无法确定使用哪一个；请用 atx_set_key 明确设置。` }
  return { key: '', source: 'none', baseUrl: envBase || settings.baseUrl || DEFAULT_BASE_URL }
}

/** Build a WorkBuddy custom-model entry for an ATX model. */
export function modelEntry(id, { baseUrl, key, vision = false, reasoning = false } = {}) {
  const vendor = id.split('/')[0].replace(/^~/, '')
  const icons = {
    anthropic: 'https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons/anthropic/mono.svg',
    openai: 'https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons/openai/light.svg',
    google: 'https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg',
  }
  return {
    id, name: id, vendor: 'Custom',
    ...(icons[vendor] ? { iconUrl: icons[vendor] } : {}),
    url: `${normalizeBaseUrl(baseUrl)}/chat/completions`,
    apiKey: key,
    supportsToolCall: true, supportsImages: !!vision, supportsReasoning: !!reasoning, useCustomProtocol: false,
  }
}

/** 显式导入并备份；仅替换 ATX 同 ID，非 ATX 冲突拒绝。 */
export function importModels(entries, { path = modelsPath(), now = new Date() } = {}) {
  const { layout, models, raw } = readModels(path)
  const conflicts = entries.filter(e => models.some(m => m?.id === e.id && !isAtxUrl(m.url)))
  if (conflicts.length) throw new Error(`同 ID 非 ATX 模型冲突，拒绝覆盖：${conflicts.map(e => e.id).join(', ')}`)
  let backup = null
  if (existsSync(path)) {
    const stamp = `${now.toISOString().replace(/[:]/g, '-')}-${randomUUID()}`
    backup = `${path}.bak-${stamp}`
    copyFileSync(path, backup)
  }
  const ids = new Set(entries.map(e => e.id))
  const merged = [...models.filter(m => !ids.has(m?.id)), ...entries]
  writeJson(path, layout === 'object' ? { ...raw, models: merged } : merged)
  return { path, backup, total: merged.length, added: entries.map(e => e.id) }
}

/** Remove ATX models (by id) from models.json, with backup. Non-ATX entries are never touched. */
export function removeModels(ids, { path = modelsPath(), now = new Date() } = {}) {
  const { layout, models, raw } = readModels(path)
  const target = new Set(ids)
  const removed = models.filter(m => target.has(m?.id) && isAtxUrl(m?.url)).map(m => m.id)
  if (!removed.length) return { path, backup: null, removed, total: models.length }
  const stamp = `${now.toISOString().replace(/[:]/g, '-')}-${randomUUID()}`
  const backup = `${path}.bak-${stamp}`
  copyFileSync(path, backup)
  const kept = models.filter(m => !(removed.includes(m?.id) && isAtxUrl(m?.url)))
  writeJson(path, layout === 'object' ? { ...raw, models: kept } : kept)
  return { path, backup, removed, total: kept.length }
}
