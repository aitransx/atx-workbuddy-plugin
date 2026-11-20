import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeBaseUrl } from './config.mjs'

const LIMIT = 1024 * 1024
const FRESH = 300_000
const LKG = 7 * 24 * 60 * 60 * 1000
const RETRY = 30_000
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const invalid = () => new Error('清单格式无效。')

export function validModelId(value) {
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value, 'utf8') <= 256 && !/[\s\p{Cc}\p{Cf}]/u.test(value)
}

export function parseSemver(value) {
  if (typeof value !== 'string') return null
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value)
  if (!match) return null
  const pre = match[4]?.split('.') || []
  if (pre.some(part => /^\d+$/.test(part) && part.length > 1 && part[0] === '0')) return null
  return { core: match.slice(1, 4).map(BigInt), pre }
}

export function compareSemver(a, b) {
  const left = parseSemver(a), right = parseSemver(b)
  if (!left || !right) throw invalid()
  for (let i = 0; i < 3; i++) {
    if (left.core[i] !== right.core[i]) return left.core[i] > right.core[i] ? 1 : -1
  }
  if (!left.pre.length || !right.pre.length) return left.pre.length === right.pre.length ? 0 : left.pre.length ? -1 : 1
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i], y = right.pre[i]
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1
    if (x === y) continue
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y)
    if (xn && yn) return BigInt(x) > BigInt(y) ? 1 : -1
    if (xn !== yn) return xn ? -1 : 1
    return x > y ? 1 : -1
  }
  return 0
}

export function isVersionCompatible(pluginVersion, minPluginVersion) {
  return Boolean(parseSemver(pluginVersion)) && (!minPluginVersion || Boolean(parseSemver(minPluginVersion)) && compareSemver(pluginVersion, minPluginVersion) >= 0)
}

export function validateManifest(input) {
  if (!object(input) || input.schemaVersion !== 1 || typeof input.revision !== 'string' || !/^[a-fA-F0-9]{64}$/.test(input.revision)) throw invalid()
  if (input.minPluginVersion !== undefined && input.minPluginVersion !== '' && !parseSemver(input.minPluginVersion)) throw invalid()
  const result = structuredClone(input)
  result.minPluginVersion = input.minPluginVersion ?? ''
  for (const key of ['recommendedChat', 'mediaModels', 'deprecated', 'whatsNew']) {
    const list = key === 'whatsNew' || key === 'deprecated' ? input[key] ?? [] : input[key] === undefined ? [] : input[key]
    if (!Array.isArray(list) || list.length > (key === 'whatsNew' ? 50 : 100)) throw invalid()
    result[key] = list.map(entry => {
      if (key === 'whatsNew') {
        if (typeof entry !== 'string') throw invalid()
        return entry
      }
      if (!object(entry) || !validModelId(entry.id)) throw invalid()
      const model = structuredClone(entry)
      if (key === 'deprecated') {
        if (typeof entry.reason !== 'string' || entry.replacedBy !== undefined && !validModelId(entry.replacedBy)) throw invalid()
        return model
      }
      if (entry.capabilities !== undefined && !object(entry.capabilities)) throw invalid()
      model.capabilities = {}
      const capabilities = key === 'recommendedChat' ? ['tools', 'images', 'reasoning'] : ['image', 'vision', 'gif']
      for (const capability of capabilities) {
        const value = entry.capabilities?.[capability]
        if (value !== undefined && value !== null && typeof value !== 'boolean') throw invalid()
        model.capabilities[capability] = value ?? null
      }
      if (key === 'recommendedChat') {
        if (typeof entry.verified !== 'boolean' || entry.verified && model.capabilities.tools !== true) throw invalid()
      }
      return model
    })
    if (key !== 'whatsNew') {
      const ids = result[key].map(entry => entry.id)
      if (new Set(ids).size !== ids.length) throw invalid()
    }
  }
  if (input.mediaDefaults !== undefined && !object(input.mediaDefaults)) throw invalid()
  result.mediaDefaults = structuredClone(input.mediaDefaults || {})
  for (const [capability, id] of Object.entries(result.mediaDefaults)) {
    if (!['image', 'vision', 'gif'].includes(capability) || !validModelId(id)) throw invalid()
    if (!result.mediaModels.some(model => model.id === id && model.capabilities[capability] === true)) throw invalid()
  }
  return result
}

async function readLimitedFile(path) {
  const handle = await open(path, 'r')
  try {
    if ((await handle.stat()).size > LIMIT) throw invalid()
    const buffer = Buffer.alloc(LIMIT + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null)
      if (!bytesRead) break
      length += bytesRead
    }
    if (length > LIMIT) throw invalid()
    return JSON.parse(buffer.subarray(0, length).toString('utf8'))
  } finally { await handle.close() }
}

function withAbort(operation, signal) {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort)
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve().then(() => {
      if (signal.aborted) throw signal.reason
      return operation()
    }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

async function readResponse(response, signal) {
  if (!response.body || typeof response.body.getReader !== 'function') throw invalid()
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await withAbort(() => reader.read(), signal)
      if (done) break
      size += value.byteLength
      if (size > LIMIT) throw invalid()
      chunks.push(Buffer.from(value))
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (error) {
    try { Promise.resolve(reader.cancel()).catch(() => {}) } catch { /* 取消失败不能阻塞超时返回。 */ }
    throw error
  } finally { reader.releaseLock() }
}

export function createManifestCatalog({ baseURL, pluginVersion, cacheDir, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 10_000 }) {
  const base = normalizeBaseUrl(baseURL)
  const source = { origin: new URL(base).origin, baseURL: base, schemaVersion: 1 }
  const hash = createHash('sha256').update(JSON.stringify(source)).digest('hex')
  const path = cacheDir ? join(cacheDir, `manifest-${hash}.json`) : null
  let record = null, loaded = false, flight = null, lastAttemptAt = null, lastError = null, blocked = false, fromCache = false
  const sameSource = value => object(value) && value.origin === source.origin && value.baseURL === source.baseURL && value.schemaVersion === 1
  const validTime = (value, time) => Number.isFinite(value) && value >= 0 && value <= time

  async function load() {
    if (loaded) return
    loaded = true
    if (!path) return
    try {
      const saved = await readLimitedFile(path), time = now()
      if (saved.cacheFormatVersion !== 1 || !sameSource(saved.source) || !validTime(saved.lastValidatedAt, time) || !validTime(saved.checkedAt, time) || saved.checkedAt > saved.lastValidatedAt || time - saved.lastValidatedAt > LKG || (saved.etag !== null && (typeof saved.etag !== 'string' || saved.etag.length > 512 || /[\r\n]/.test(saved.etag)))) return
      record = { ...saved, manifest: validateManifest(saved.manifest) }
      fromCache = true
    } catch { /* 损坏或不可信缓存不参与应用。 */ }
  }

  async function persist() {
    if (!path || !record) return
    const data = JSON.stringify(record)
    if (Buffer.byteLength(data) > LIMIT) return
    const temp = `${path}.${randomUUID()}.tmp`
    try {
      await mkdir(cacheDir, { recursive: true })
      const handle = await open(temp, 'wx', 0o600)
      try { await handle.writeFile(data, 'utf8'); await handle.sync() } finally { await handle.close() }
      await rename(temp, path)
    } catch { /* 缓存写入失败不影响已验证的本次结果。 */ }
    finally { await unlink(temp).catch(() => {}) }
  }

  function snapshot() {
    const age = record ? now() - record.lastValidatedAt : Infinity
    const freshness = !record ? 'unavailable' : age < 0 || age > LKG ? 'expired' : age < FRESH ? 'fresh' : 'stale'
    const canApply = Boolean(record && freshness === 'fresh' && !lastError && !blocked && isVersionCompatible(pluginVersion, record.manifest.minPluginVersion))
    return structuredClone({ source, manifest: record?.manifest ?? null, revision: record?.manifest.revision ?? null,
      freshness, checkedAt: record?.checkedAt ?? null, lastValidatedAt: record?.lastValidatedAt ?? null,
      lastAttemptAt, lastError, fromCache, canApply, blockedActions: canApply ? [] : ['apply'] })
  }

  async function request() {
    lastAttemptAt = now()
    const signal = AbortSignal.timeout(timeoutMs)
    try {
      let etag = record && now() - record.lastValidatedAt <= LKG && now() >= record.lastValidatedAt ? record.etag : null
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await withAbort(() => fetchImpl(`${base}/clients/workbuddy/manifest`, {
          method: 'GET', headers: { Accept: 'application/json', ...(etag ? { 'If-None-Match': etag } : {}) },
          credentials: 'omit', redirect: 'error', signal,
        }), signal)
        if (response.redirected) throw invalid()
        if (response.status === 304) {
          if (etag && record && sameSource(record.source) && now() >= record.lastValidatedAt && now() - record.lastValidatedAt <= LKG) {
            record.lastValidatedAt = now()
            lastError = null
            blocked = false
            await persist()
            return snapshot()
          }
          if (attempt === 0) { etag = null; continue }
          throw invalid()
        }
        if (response.status === 503) { blocked = true; throw invalid() }
        if (response.status !== 200) throw invalid()
        const raw = await readResponse(response, signal)
        if (raw?.schemaVersion !== 1) { blocked = true; throw invalid() }
        const manifest = validateManifest(raw)
        const time = now()
        const responseEtag = response.headers.get('etag')
        const savedEtag = typeof responseEtag === 'string' && responseEtag.length <= 512 && !/[\r\n]/.test(responseEtag) ? responseEtag : null
        record = { cacheFormatVersion: 1, source, manifest, checkedAt: time, lastValidatedAt: time, etag: savedEtag }
        fromCache = false
        blocked = false
        lastError = null
        await persist()
        return snapshot()
      }
    } catch {
      lastError = blocked ? '远端发布未启用或 schema 不兼容，禁止应用；未更改已有配置。' : '网络或清单验证失败，历史清单不代表最新；未更改已有配置。'
      return snapshot()
    }
  }

  return { check({ force = false } = {}) {
    if (flight) return flight
    flight = (async () => {
      await load()
      if (!force && (record && now() >= record.lastValidatedAt && now() - record.lastValidatedAt < FRESH || lastAttemptAt !== null && now() - lastAttemptAt < RETRY)) return snapshot()
      return request()
    })().finally(() => { flight = null })
    return flight
  } }
}
