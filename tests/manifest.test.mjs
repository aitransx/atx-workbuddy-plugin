import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createManifestCatalog, validateManifest, validModelId, compareSemver, isVersionCompatible } from '../plugins/atx-assistant/server/manifest.mjs'

const baseURL = 'https://api.aitransx.com/proxy/v1'
const pluginVersion = '2.1.0'
const fixture = (patch = {}) => ({ schemaVersion: 1, revision: 'a'.repeat(64), minPluginVersion: '2.0.0',
  recommendedChat: [{ id: 'chat', verified: true, capabilities: { tools: true, images: false } }],
  mediaModels: [{ id: 'media', capabilities: { image: true, vision: false } }],
  mediaDefaults: { image: 'media' }, deprecated: [{ id: 'old', reason: '已替换', replacedBy: 'chat' }], whatsNew: null, ...patch })
const response = (body = fixture(), status = 200, etag = 'W/"revision-gzip"') => new Response(status === 304 ? null : JSON.stringify(body), { status, headers: { ETag: etag } })
async function setup(t, options = {}) {
  const cacheDir = await mkdtemp(join(tmpdir(), 'atx-manifest-test-'))
  t.after(() => rm(cacheDir, { recursive: true, force: true }))
  let time = 1_000_000, calls = 0, fetcher = async () => response()
  const fetchImpl = (...args) => { calls++; return fetcher(...args) }
  const config = { baseURL, pluginVersion, cacheDir, now: () => time, fetchImpl, ...options }
  return { catalog: createManifestCatalog(config), config, cacheDir, advance: value => { time += value },
    setFetch: value => { fetcher = value }, calls: () => calls }
}

test('型号 ID 使用 UTF8 字节限制并拒绝空白和控制字符', () => {
  assert.equal(validModelId('汉'.repeat(85)), true)
  for (const id of ['', '汉'.repeat(86), 'a b', 'a\n', 'a\u0000', 'a\u200b', 42]) assert.equal(validModelId(id), false)
  assert.equal(validModelId('厂商/model:latest'), true)
})

test('SemVer 支持预发行、构建元数据、大整数及严格语法', () => {
  const sorted = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0']
  sorted.slice(1).forEach((value, i) => assert.equal(compareSemver(sorted[i], value), -1))
  assert.equal(compareSemver('1.0.0+one', '1.0.0+two'), 0)
  assert.equal(compareSemver('999999999999999999.0.0', '999999999999999998.0.0'), 1)
  for (const version of ['1.0', '01.0.0', '1.0.0-01', 'v1.0.0', '1.0.0-']) assert.equal(isVersionCompatible(version, ''), false)
  assert.equal(isVersionCompatible('2.0.0-beta', '2.0.0'), false)
})

test('schema 校验归一化 unknown、保留元数据并严格确认默认能力', () => {
  const raw = fixture({ title: '<script>不执行</script>' })
  const result = validateManifest(raw)
  assert.equal(result.title, raw.title)
  assert.deepEqual(result.whatsNew, [])
  assert.deepEqual(result.mediaModels[0].capabilities, { image: true, vision: false, gif: null })
  assert.deepEqual(result.recommendedChat[0].capabilities, { tools: true, images: false, reasoning: null })
  assert.equal(result.recommendedChat[0].verified, true)
  assert.deepEqual(result.mediaDefaults, { image: 'media' })
  assert.equal(Object.hasOwn(result, 'defaults'), false)
  assert.deepEqual(result.deprecated, [{ id: 'old', reason: '已替换', replacedBy: 'chat' }])
  assert.deepEqual(validateManifest(fixture({ deprecated: null })).deprecated, [])
  result.mediaModels[0].id = 'changed'
  assert.equal(raw.mediaModels[0].id, 'media')
  for (const patch of [{ schemaVersion: 2 }, { revision: 'bad' }, { minPluginVersion: '2' }, { minPluginVersion: null }, { mediaModels: null },
    { mediaModels: [{ id: 'media', capabilities: { image: 'true' } }] }, { mediaDefaults: { vision: 'media' } },
    { recommendedChat: Array.from({ length: 101 }, (_, i) => ({ id: `${i}`, verified: false, capabilities: {} })) },
    { mediaModels: Array.from({ length: 101 }, (_, i) => ({ id: `${i}`, capabilities: {} })) },
    { deprecated: Array.from({ length: 101 }, (_, i) => ({ id: `${i}`, reason: '停用' })) },
    { whatsNew: Array(51).fill('消息') }]) {
    assert.throws(() => validateManifest(fixture(patch)))
  }
})

test('真实聊天和媒体协议区分能力、verified 与显式媒体默认值', () => {
  const result = validateManifest(fixture({
    recommendedChat: [{ id: 'unknown', verified: false }, { id: 'known', verified: true,
      capabilities: { tools: true, images: true, reasoning: false }, provider: '示例' }],
    mediaModels: [{ id: 'media', capabilities: { image: true, vision: true, gif: true } }, { id: 'unknown-media' }],
    mediaDefaults: { image: 'media', vision: 'media', gif: 'media' }, whatsNew: ['<script>仅文本</script>'],
  }))
  assert.deepEqual(result.recommendedChat[0].capabilities, { tools: null, images: null, reasoning: null })
  assert.deepEqual(result.mediaModels[1].capabilities, { image: null, vision: null, gif: null })
  assert.equal(result.recommendedChat[1].provider, '示例')
  assert.deepEqual(result.whatsNew, ['<script>仅文本</script>'])
  for (const verified of [undefined, null, 'true', 1]) {
    assert.throws(() => validateManifest(fixture({ recommendedChat: [{ id: 'bad', verified, capabilities: { tools: true } }] })))
  }
  for (const tools of [undefined, null, false]) {
    assert.throws(() => validateManifest(fixture({ recommendedChat: [{ id: 'bad', verified: true, capabilities: { tools } }] })))
  }
  for (const patch of [
    { recommendedChat: [{ id: 'bad', verified: false, capabilities: { images: 'true' } }] },
    { recommendedChat: [{ id: 'bad', verified: false, capabilities: { reasoning: 1 } }] },
    { recommendedChat: [{ id: 'bad', verified: false, capabilities: null }] },
    { mediaModels: [{ id: 'media', capabilities: { image: true, gif: 'true' } }] },
    { mediaModels: [{ id: 'media', image: true }] },
    { mediaDefaults: { gif: 'media' } }, { mediaDefaults: { image: 'missing' } },
    { mediaDefaults: { chat: 'chat' } }, { mediaDefaults: null },
  ]) assert.throws(() => validateManifest(fixture(patch)))
})

test('废弃型号仅接受带原因对象，更新说明仅接受字符串', () => {
  assert.deepEqual(validateManifest(fixture({ deprecated: [{ id: 'old', reason: '停用' }] })).deprecated,
    [{ id: 'old', reason: '停用' }])
  for (const deprecated of [['old'], [{ id: 'old' }], [{ id: 'old', reason: null }],
    [{ id: 'old', reason: '停用', replacedBy: 'bad id' }], [{ id: 'old', reason: '停用', replacedBy: null }]]) {
    assert.throws(() => validateManifest(fixture({ deprecated })))
  }
  for (const whatsNew of [[{}], [{ text: '消息' }], [null], [1]]) {
    assert.throws(() => validateManifest(fixture({ whatsNew })))
  }
})

test('公开请求保留路径、不发送凭据、有超时；fresh TTL 和强制刷新', async t => {
  const s = await setup(t)
  s.setFetch(async (url, options) => {
    assert.equal(url, `${baseURL}/clients/workbuddy/manifest`)
    assert.equal(options.credentials, 'omit')
    assert.equal(options.redirect, 'error')
    assert.ok(options.signal instanceof AbortSignal)
    assert.equal(options.headers.Authorization, undefined)
    assert.equal(options.headers.Cookie, undefined)
    return response()
  })
  const first = await s.catalog.check()
  assert.equal(first.canApply, true)
  assert.equal(first.freshness, 'fresh')
  assert.deepEqual(first.source, { origin: 'https://api.aitransx.com', baseURL, schemaVersion: 1 })
  await s.catalog.check()
  assert.equal(s.calls(), 1)
  await s.catalog.check({ force: true })
  assert.equal(s.calls(), 2)
  s.advance(300_000)
  await s.catalog.check()
  assert.equal(s.calls(), 3)
})

test('原始 gzip ETag 完整回传，304 只刷新验证时间', async t => {
  const s = await setup(t)
  const first = await s.catalog.check()
  s.advance(300_001)
  s.setFetch(async (_, options) => {
    assert.equal(options.headers['If-None-Match'], 'W/"revision-gzip"')
    return response(null, 304)
  })
  const result = await s.catalog.check()
  assert.equal(result.lastValidatedAt, first.lastValidatedAt + 300_001)
  assert.equal(result.checkedAt, first.checkedAt)
  assert.equal(result.canApply, true)
})

test('无正文 304 最多一次无 ETag 重取并安全失败', async t => {
  const s = await setup(t)
  s.setFetch(async (_, options) => {
    assert.equal(options.headers['If-None-Match'], undefined)
    return response(null, 304)
  })
  const result = await s.catalog.check()
  assert.equal(s.calls(), 2)
  assert.equal(result.canApply, false)
  assert.equal(result.manifest, null)
  await s.catalog.check()
  assert.equal(s.calls(), 2)
})

test('单 flight、失败抑制自动重试且错误不泄露上游信息', async t => {
  const s = await setup(t)
  let release, started
  const ready = new Promise(resolve => { started = resolve })
  s.setFetch(() => new Promise(resolve => { release = resolve; started() }))
  const one = s.catalog.check(), two = s.catalog.check({ force: true })
  assert.equal(one, two)
  await ready
  release(response())
  const first = await one
  s.advance(300_001)
  s.setFetch(async () => { throw new Error('SECRET upstream body') })
  const failed = await s.catalog.check()
  assert.equal(failed.lastValidatedAt, first.lastValidatedAt)
  assert.equal(failed.freshness, 'stale')
  assert.equal(failed.canApply, false)
  assert.deepEqual(failed.blockedActions, ['apply'])
  assert.match(failed.lastError, /失败/)
  assert.ok(!failed.lastError.includes('SECRET'))
  await s.catalog.check()
  assert.equal(s.calls(), 2)
  s.advance(30_000)
  await s.catalog.check()
  assert.equal(s.calls(), 3)
})

test('503 和未知 schema 保守禁应用；恢复后解禁；低版本禁应用', async t => {
  const s = await setup(t)
  await s.catalog.check()
  for (const bad of [() => response({ secret: 'hidden' }, 503), () => response(fixture({ schemaVersion: 2 }))]) {
    s.setFetch(async () => bad())
    const failed = await s.catalog.check({ force: true })
    assert.equal(failed.canApply, false)
    assert.equal(failed.freshness, 'fresh')
    assert.ok(failed.lastError)
    assert.deepEqual(failed.blockedActions, ['apply'])
    assert.equal(failed.manifest.schemaVersion, 1)
    s.setFetch(async () => response())
    assert.equal((await s.catalog.check({ force: true })).canApply, true)
  }
  s.setFetch(async () => response(fixture({ minPluginVersion: '3.0.0' })))
  assert.equal((await s.catalog.check({ force: true })).canApply, false)
})

test('7 天 LKG 失败不续期、到期禁用且不发送过期 ETag', async t => {
  const s = await setup(t)
  const first = await s.catalog.check()
  s.advance(7 * 24 * 60 * 60 * 1000 + 1)
  s.setFetch(async (_, options) => {
    assert.equal(options.headers['If-None-Match'], undefined)
    throw new Error('失败')
  })
  const result = await s.catalog.check()
  assert.equal(result.lastValidatedAt, first.lastValidatedAt)
  assert.equal(result.freshness, 'expired')
  assert.equal(result.canApply, false)
})

test('流式解压后字节上限不依赖 Content-Length', async t => {
  const s = await setup(t)
  let cancelled = false
  s.setFetch(async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(600_000)) },
    cancel() { cancelled = true },
  }), { headers: { 'Content-Length': '1', 'Content-Encoding': 'gzip' } }))
  const result = await s.catalog.check()
  assert.equal(result.canApply, false)
  assert.equal(cancelled, true)
})

test('忽略 signal 的 fetch 仍会超时返回并释放单 flight', { timeout: 2000 }, async t => {
  const keepAlive = setTimeout(() => {}, 2000)
  t.after(() => clearTimeout(keepAlive))
  const s = await setup(t, { timeoutMs: 20 })
  let signal
  s.setFetch((_, options) => {
    signal = options.signal
    return new Promise(() => {})
  })
  const result = await s.catalog.check()
  assert.equal(signal.aborted, true)
  assert.equal(result.canApply, false)
  assert.match(result.lastError, /失败/)
  s.setFetch(async () => response())
  assert.equal((await s.catalog.check({ force: true })).canApply, true)
})

test('挂住的响应体读取随 signal 中止，取消挂住也不等待', { timeout: 2000 }, async t => {
  const keepAlive = setTimeout(() => {}, 2000)
  t.after(() => clearTimeout(keepAlive))
  const s = await setup(t, { timeoutMs: 20 })
  let signal, cancelled = false
  s.setFetch(async (_, options) => {
    signal = options.signal
    return new Response(new ReadableStream({
      pull() { return new Promise(() => {}) },
      cancel() { cancelled = true; return new Promise(() => {}) },
    }))
  })
  const result = await s.catalog.check()
  assert.equal(signal.aborted, true)
  assert.equal(cancelled, true)
  assert.equal(result.canApply, false)
  assert.match(result.lastError, /失败/)
  s.setFetch(async () => response())
  assert.equal((await s.catalog.check({ force: true })).canApply, true)
})

test('显式拒绝已重定向响应以及非 200 成功状态', async t => {
  const s = await setup(t)
  const redirected = response()
  Object.defineProperty(redirected, 'redirected', { value: true })
  for (const rejected of [redirected, response(fixture(), 201), response(fixture(), 202), response(fixture(), 206)]) {
    s.setFetch(async () => rejected)
    const result = await s.catalog.check({ force: true })
    assert.equal(result.manifest, null)
    assert.equal(result.canApply, false)
    assert.match(result.lastError, /失败/)
  }
})

test('过长响应 ETag 不写入缓存且不在后续请求回传', async t => {
  const s = await setup(t)
  s.setFetch(async () => response(fixture(), 200, 'x'.repeat(513)))
  assert.equal((await s.catalog.check()).canApply, true)
  const [file] = await readdir(s.cacheDir)
  assert.equal(JSON.parse(await readFile(join(s.cacheDir, file), 'utf8')).etag, null)
  s.advance(300_001)
  s.setFetch(async (_, options) => {
    assert.equal(options.headers['If-None-Match'], undefined)
    return response()
  })
  assert.equal((await s.catalog.check()).canApply, true)
})

test('缓存独立来源、重新验证、拷贝隔离和原子写入', async t => {
  const s = await setup(t)
  const first = await s.catalog.check()
  const files = await readdir(s.cacheDir)
  assert.equal(files.length, 1)
  assert.match(files[0], /^manifest-[a-f0-9]{64}\.json$/)
  const cached = await createManifestCatalog(s.config).check()
  assert.equal(cached.fromCache, true)
  assert.equal(s.calls(), 1)
  cached.manifest.mediaModels[0].id = 'modified'
  assert.equal((await createManifestCatalog(s.config).check()).manifest.mediaModels[0].id, 'media')
  await createManifestCatalog({ ...s.config, baseURL: 'https://api.aitransx.com/other/v1' }).check()
  assert.equal((await readdir(s.cacheDir)).length, 2)
  const path = join(s.cacheDir, files[0])
  const saved = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(saved.cacheFormatVersion, 1)
  for (const mutate of [value => { delete value.cacheFormatVersion }, value => { value.cacheFormatVersion = 2 },
    value => { value.etag = 'x'.repeat(513) }, value => { value.etag = 'bad\r\nheader' },
    value => { value.source.baseURL += '/wrong' }, value => { value.lastValidatedAt += 100_000 },
    value => { value.manifest.revision = 'bad' }, value => { value.source.schemaVersion = 2 }]) {
    const changed = structuredClone(saved)
    mutate(changed)
    await writeFile(path, JSON.stringify(changed))
    s.setFetch(async () => { throw new Error('离线') })
    const result = await createManifestCatalog(s.config).check()
    assert.equal(result.manifest, null)
    assert.equal(result.canApply, false)
  }
  await writeFile(path, 'x'.repeat(1024 * 1024 + 1))
  assert.equal((await createManifestCatalog(s.config).check()).manifest, null)
  assert.equal(first.canApply, true)
})
