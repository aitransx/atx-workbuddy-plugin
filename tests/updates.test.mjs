import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUpdates, PLAN_TTL_MS } from '../plugins/atx-assistant/server/updates.mjs'
import { updateTools } from '../plugins/atx-assistant/server/tools-updates.mjs'
import { loadSettings } from '../plugins/atx-assistant/server/config.mjs'

const base = 'https://api-hk.aitransx.com/v1'
const key = 'aitx-THIS_IS_A_PRIVATE_TEST_CREDENTIAL'
function fixture(t, initial = []) {
  const root = mkdtempSync(join(tmpdir(), 'atx-updates-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'atx-assistant'))
  const models = join(root, 'models.json'), settings = join(root, 'atx-assistant/settings.json')
  writeFileSync(models, JSON.stringify(initial))
  writeFileSync(settings, JSON.stringify({ apiKey: key, baseUrl: base, customSetting: 42, models: [] }))
  let time = 1000
  const env = { WORKBUDDY_HOME: root }
  const state = { source: { baseURL: base, origin: new URL(base).origin, schemaVersion: 1 }, revision: 'r1', freshness: 'fresh', lastValidatedAt: time, canApply: true, blockedActions: [],
    manifest: { schemaVersion: 1, recommendedChat: [
      { id: 'chat/yes', capabilities: { tools: true, images: false, reasoning: true }, verified: true },
      { id: 'chat/no', capabilities: { tools: false }, verified: false },
      { id: 'chat/unknown', capabilities: { tools: null, images: null, reasoning: null }, verified: false },
    ], mediaModels: [{ id: 'image/yes', capabilities: { image: true, vision: false, gif: null }, verified: true }], mediaDefaults: { image: 'image/yes' } } }
  const catalog = { models: ['chat/yes', 'chat/no', 'chat/unknown', 'image/yes'].map(id => ({ id, availability: 'available' })), lastSuccess: time, lastError: null }
  const calls = []
  const ctx = { env, now: () => time, settings: () => loadSettings(env), reload() {},
    manifest: { async check(args) { calls.push(args); return structuredClone(state) } },
    catalog: { async refresh() { return structuredClone(catalog) }, async ensureFresh() { return structuredClone(catalog) } } }
  return { root, models, settings, state, catalog, ctx, calls, updates: createUpdates(ctx), advance: n => { time += n } }
}
const apply = (f, plan, extra = {}) => f.updates.apply({ planId: plan.planId, confirm: true, ...extra })

test('检查不写业务文件，计划与输出不泄露密钥、原配置和指纹', async t => {
  const f = fixture(t)
  const before = [readFileSync(f.models, 'utf8'), readFileSync(f.settings, 'utf8')]
  const plan = await f.updates.check({ force: true })
  assert.deepEqual([readFileSync(f.models, 'utf8'), readFileSync(f.settings, 'utf8')], before)
  assert(!JSON.stringify(plan).includes(key))
  assert(!JSON.stringify(plan).includes('fingerprint'))
  assert(!JSON.stringify(plan).includes('customSetting'))
  const stored = readFileSync(join(f.root, 'atx-assistant/updates', `${plan.planId}.json`), 'utf8')
  assert(!stored.includes(key))
  assert(!stored.includes('apiKey'))
  assert.deepEqual(f.calls, [{ force: true }])
  assert.equal(plan.additions.length, 2)
  assert.equal((await apply(f, plan)).applied, false)
  assert.deepEqual([readFileSync(f.models, 'utf8'), readFileSync(f.settings, 'utf8')], before)
})

test('仅选中导入；严格三态映射、备份以及重放拒绝', async t => {
  const f = fixture(t, { models: [], unknownRoot: '保留' })
  const plan = await f.updates.check()
  const result = await apply(f, plan, { addIds: ['chat/yes'] })
  assert.equal(result.applied, true)
  const saved = JSON.parse(readFileSync(f.models))
  assert.equal(saved.unknownRoot, '保留')
  assert.equal(saved.models.length, 1)
  assert.equal(saved.models[0].supportsToolCall, true)
  assert.equal(saved.models[0].supportsImages, false)
  assert.equal(saved.models[0].supportsReasoning, true)
  assert.equal(saved.models[0].apiKey, key)
  assert(result.backups.some(b => b.backup && existsSync(b.backup)))
  assert(!JSON.stringify(result).includes(key))
  await assert.rejects(apply(f, plan), /已经使用/)
})

test('false 禁止导入，null 仅知情开启工具试用且不冒充已验证', async t => {
  const f = fixture(t)
  const plan = await f.updates.check()
  assert(!plan.additions.some(m => m.id === 'chat/no'))
  await assert.rejects(apply(f, plan, { addIds: ['chat/no'], confirmUnverified: true }), /不属于/)
  await assert.rejects(apply(f, plan, { addIds: ['chat/unknown'] }), /confirmUnverified/)
  await apply(f, plan, { addIds: ['chat/unknown'], confirmUnverified: true })
  const model = JSON.parse(readFileSync(f.models))[0]
  assert.equal(model.supportsToolCall, true)
  assert.equal(model.supportsImages, false)
  assert.equal(model.supportsReasoning, false)
})

test('过期、配置或环境指纹变化均拒绝', async t => {
  const f = fixture(t)
  const expired = await f.updates.check()
  f.advance(PLAN_TTL_MS)
  await assert.rejects(apply(f, expired), /过期/)
  const changed = await f.updates.check()
  writeFileSync(f.models, '[{"id":"personal"}]')
  await assert.rejects(apply(f, changed), /指纹/)
  const envChanged = await f.updates.check()
  f.ctx.env.AITRANSX_API_KEY = 'new-private-key'
  await assert.rejects(apply(f, envChanged), /指纹/)
})

test('503、revision 与源变化以及目录失败全部禁止写入', async t => {
  for (const kind of ['503', 'revision', 'source', 'catalog']) {
    const f = fixture(t)
    const plan = await f.updates.check()
    const before = readFileSync(f.models, 'utf8')
    if (kind === '503') { f.state.canApply = false; f.state.blockedActions = ['apply'] }
    if (kind === 'revision') f.state.revision = 'r2'
    if (kind === 'source') f.state.source.baseURL = 'https://api.aitransx.com/v1'
    if (kind === 'catalog') f.catalog.lastError = '失败'
    await assert.rejects(apply(f, plan, { addIds: ['chat/yes'] }))
    assert.equal(readFileSync(f.models, 'utf8'), before)
  }
})

test('非 ATX 和不同精确线路冲突不覆盖；没有基线保留个人字段', async t => {
  for (const url of ['https://other.example/v1/chat/completions', 'https://api.aitransx.com/v1/chat/completions']) {
    const f = fixture(t, [{ id: 'chat/yes', url, custom: 1 }])
    const plan = await f.updates.check()
    assert(plan.conflicts.some(m => m.id === 'chat/yes'))
    await assert.rejects(apply(f, plan, { addIds: ['chat/yes'] }), /不属于/)
  }
  const f = fixture(t, [{ id: 'chat/yes', url: `${base}/chat/completions`, supportsImages: true, custom: '个人' }])
  const plan = await f.updates.check()
  const change = plan.changes.find(c => c.field === 'supportsImages')
  assert.equal(change.personal, true)
  await assert.rejects(apply(f, plan, { overrideChangeIds: [change.changeId] }), /个人/)
})

test('有基线仅精确选择字段更新且保留未知字段，个人后改仍保护', async t => {
  const f = fixture(t)
  await apply(f, await f.updates.check(), { addIds: ['chat/yes'] })
  let saved = JSON.parse(readFileSync(f.models))
  saved[0].custom = '保留'
  writeFileSync(f.models, JSON.stringify(saved))
  f.state.revision = 'r2'
  f.state.manifest.recommendedChat[0].capabilities.images = true
  let plan = await f.updates.check()
  const change = plan.changes.find(c => c.field === 'supportsImages')
  assert.equal(change.personal, false)
  await apply(f, plan, { overrideChangeIds: [change.changeId] })
  saved = JSON.parse(readFileSync(f.models))
  assert.equal(saved[0].supportsImages, true)
  assert.equal(saved[0].custom, '保留')
  saved[0].supportsReasoning = false
  writeFileSync(f.models, JSON.stringify(saved))
  plan = await f.updates.check()
  assert.equal(plan.changes.find(c => c.field === 'supportsReasoning').personal, true)
})

test('替代保留旧模型，media 与默认 fixed/follow 必须单独选择', async t => {
  const f = fixture(t, [{ id: 'old/model', url: `${base}/chat/completions`, apiKey: key }])
  f.state.manifest.deprecated = [{ id: 'old/model', replacement: 'chat/yes' }]
  let plan = await f.updates.check()
  assert.deepEqual(plan.deprecated, ['old/model'])
  await assert.rejects(apply(f, plan, { replacements: [{ from: 'old/model', to: 'chat/yes', removeOld: true }] }), /不实现/)
  await assert.rejects(apply(f, plan, { defaultChangeIds: ['default:image:follow'] }), /尚未确认/)
  await apply(f, plan, { replacements: [{ from: 'old/model', to: 'chat/yes' }], mediaIds: ['image/yes'], defaultChangeIds: ['default:image:follow'] })
  const models = JSON.parse(readFileSync(f.models)), settings = JSON.parse(readFileSync(f.settings))
  assert(models.some(m => m.id === 'old/model'))
  assert(models.some(m => m.id === 'chat/yes'))
  assert.equal(settings.customSetting, 42)
  assert.equal(settings.imageModel, 'image/yes')
  assert.equal(settings.mediaModes.image, 'follow')
  assert.deepEqual(settings.manifestAuthorization, { source: base, models: ['image/yes'] })
  assert.equal(settings.models[0].image, true)
  assert.equal(settings.models[0].vision, undefined)
  plan = await f.updates.check()
  await apply(f, plan, { defaultChangeIds: ['default:image:fixed'] })
  assert.equal(JSON.parse(readFileSync(f.settings)).mediaModes.image, 'fixed')
})

test('解析或上游错误不泄露密钥，媒体个人 false 不被覆盖', async t => {
  const f = fixture(t)
  writeFileSync(f.models, `[{"apiKey":"${key}" BROKEN]`)
  await assert.rejects(f.updates.check(), error => !error.message.includes(key))
  writeFileSync(f.models, '[]')
  f.ctx.catalog.refresh = async () => { throw new Error(key) }
  const failedCatalog = await f.updates.check({ force: true })
  assert.equal(failedCatalog.canApply, false)
  assert.equal(failedCatalog.catalogStatus, 'unavailable')
  assert(failedCatalog.absent.every(m => m.availability === 'unknown'))
  assert(!JSON.stringify(failedCatalog).includes(key))
  await assert.rejects(apply(f, failedCatalog), /不可应用/)
  f.ctx.catalog.refresh = async () => f.catalog
  const stored = JSON.parse(readFileSync(f.settings))
  stored.models = [{ id: 'image/yes', image: false, note: '个人声明' }]
  writeFileSync(f.settings, JSON.stringify(stored))
  const plan = await f.updates.check()
  assert.equal(plan.media[0].blocked, true)
  await assert.rejects(apply(f, plan, { mediaIds: ['image/yes'] }), /个人/)
})

test('ID 统一 256 UTF8 字节且忽略伪 defaults；计划拒绝任意路径', async t => {
  const f = fixture(t)
  const good = '模'.repeat(85) + 'x'
  const bad = '模'.repeat(86)
  f.state.manifest.recommendedChat.push(...[good, bad].map(id => ({ id, capabilities: { tools: true, images: false, reasoning: false }, verified: true })))
  f.catalog.models.push(...[good, bad].map(id => ({ id, availability: 'available' })))
  f.state.manifest.defaults = { vision: 'image/yes' }
  const plan = await f.updates.check()
  assert(plan.additions.some(m => m.id === good))
  assert(!plan.additions.some(m => m.id === bad))
  assert(!plan.defaults.some(m => m.capability === 'vision'))
  await apply(f, plan, { addIds: [good] })
  assert(JSON.parse(readFileSync(f.models)).some(m => m.id === good))
  await assert.rejects(f.updates.apply({ planId: '../../models.json', confirm: true }), /planId/)
  await assert.rejects(apply(f, await f.updates.check(), { baselinePath: f.models }), /未知/)
})

test('公开源和凭据发现线路不一致时拒绝；来源 origin/schema 精确验证', async t => {
  const f = fixture(t, [{ id: 'old', url: 'https://api.aitransx.com/v1/chat/completions', apiKey: key }])
  writeFileSync(f.settings, '{"models":[]}')
  const plan = await f.updates.check()
  assert.equal(plan.source, base)
  await assert.rejects(apply(f, plan, { addIds: ['chat/yes'] }), /明确设置 AITRANSX_BASE_URL/)
  f.state.source.origin = 'https://wrong.aitransx.com'
  await assert.rejects(f.updates.check(), /来源标识/)
})

test('工具 schema 限制选择数量且未知动作显式拒绝', async t => {
  const f = fixture(t)
  const tools = updateTools(f.ctx)
  assert.equal(tools[0].name, 'atx_check_updates')
  assert.equal(tools[1].inputSchema.properties.defaultChangeIds.maxItems, 3)
  const plan = await f.updates.check()
  await assert.rejects(apply(f, plan, { unsupported: true }), /未知/)
  await assert.rejects(apply(f, plan, { addIds: Array(51).fill('chat/yes') }), /不合法/)
  assert(readdirSync(join(f.root, 'atx-assistant/updates')).every(name => !name.includes(key)))
})
