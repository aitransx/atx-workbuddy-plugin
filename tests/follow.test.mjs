import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildContext } from '../plugins/atx-assistant/server/index.mjs'
import { saveSettings, publicBaseUrl, DEFAULT_BASE_URL, modelEntry } from '../plugins/atx-assistant/server/config.mjs'

const IMAGE = 'official/new-image'
function fixture() {
  const env = { WORKBUDDY_HOME: mkdtempSync(join(tmpdir(), 'atx-follow-')) }
  let remote = { canApply: true, manifest: { mediaDefaults: { image: IMAGE }, mediaModels: [{ id: IMAGE, capabilities: { image: true } }] } }
  const ctx = buildContext(env, {
    manifestFactory: () => ({ check: async () => remote }),
    clientFactory: () => ({ listModels: async () => ({ data: [{ id: IMAGE }, { id: 'openai/gpt-image-2' }] }) }),
  })
  return { env, ctx, setRemote: value => { remote = value } }
}

test('new default uses api-hk; public manifest source ignores model credential discovery', () => {
  const { env } = fixture()
  assert.equal(publicBaseUrl(env), DEFAULT_BASE_URL)
  assert.equal(DEFAULT_BASE_URL, 'https://api-hk.aitransx.com/v1')
  assert.equal(modelEntry('test', { baseUrl: DEFAULT_BASE_URL, tools: false }).supportsToolCall, false)
})

test('existing defaults remain fixed; remote defaults do not change them', async () => {
  const { ctx } = fixture()
  assert.equal(await ctx.resolveMediaModel('image'), 'openai/gpt-image-2')
})

test('follow requires exact source, chosen local declaration and explicit candidate authorization', async () => {
  const { env, ctx } = fixture()
  saveSettings({ mediaModes: { image: 'follow' }, models: [{ id: IMAGE, image: true }],
    manifestAuthorization: { source: DEFAULT_BASE_URL, models: [IMAGE] } }, env)
  ctx.reload()
  assert.equal(await ctx.resolveMediaModel('image'), IMAGE)
  saveSettings({ manifestAuthorization: { source: 'https://aitransx.com/v1', models: [IMAGE] } }, env)
  await assert.rejects(ctx.resolveMediaModel('image'), /不可安全采用/)
})

test('expired or disabled manifest never falls back silently in follow mode; explicit request wins', async () => {
  const { env, ctx, setRemote } = fixture()
  saveSettings({ mediaModes: { image: 'follow' }, manifestAuthorization: { source: DEFAULT_BASE_URL, models: [IMAGE] } }, env)
  ctx.reload()
  setRemote({ canApply: false, manifest: { mediaDefaults: { image: IMAGE } } })
  await assert.rejects(ctx.resolveMediaModel('image'), /不可安全采用/)
  assert.equal(await ctx.resolveMediaModel('image', 'openai/gpt-image-2'), 'openai/gpt-image-2')
})
