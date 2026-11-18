import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveCredential, importModels, removeModels, readModels, modelEntry, mask, saveSettings, loadSettings, isAtxUrl } from '../plugins/atx-assistant/server/config.mjs'

const KEY_A = 'aitx-' + 'a'.repeat(40)
const KEY_B = 'aitx-' + 'b'.repeat(40)
const sandbox = () => {
  const home = mkdtempSync(join(tmpdir(), 'atx-cfg-'))
  return { home, env: { WORKBUDDY_HOME: home, ATX_DATA_DIR: join(home, 'data') }, models: join(home, 'models.json') }
}
const atx = (id, key, url = 'https://api-hk.aitransx.com/v1/chat/completions') => ({ id, name: id, url, apiKey: key })

test('isAtxUrl only accepts https aitransx domains', () => {
  assert.ok(isAtxUrl('https://api.aitransx.com/v1'))
  assert.ok(isAtxUrl('https://api-hk.aitransx.com/v1/chat/completions'))
  assert.ok(!isAtxUrl('http://api.aitransx.com/v1'))
  assert.ok(!isAtxUrl('https://aitransx.com.evil.example/v1'))
  assert.ok(!isAtxUrl('https://evilaitransx.com/v1'))
})

test('credential is reused from a single ATX key in models.json, with base url derived', () => {
  const s = sandbox()
  writeFileSync(s.models, JSON.stringify([atx('x', KEY_A), atx('y', KEY_A), { id: 'other', url: 'https://example.com/v1/chat/completions', apiKey: 'sk-zzz' }]))
  const c = resolveCredential(s.env)
  assert.equal(c.key, KEY_A)
  assert.equal(c.source, 'workbuddy-models.json')
  assert.equal(c.baseUrl, 'https://api-hk.aitransx.com/v1')
})

test('multiple distinct ATX keys are ambiguous and never guessed', () => {
  const s = sandbox()
  writeFileSync(s.models, JSON.stringify([atx('x', KEY_A), atx('y', KEY_B)]))
  const c = resolveCredential(s.env)
  assert.equal(c.key, '')
  assert.equal(c.source, 'ambiguous')
})

test('priority: env > plugin settings > models.json; unexpanded ${} placeholders are ignored', () => {
  const s = sandbox()
  writeFileSync(s.models, JSON.stringify([atx('x', KEY_A)]))
  saveSettings({ apiKey: KEY_B }, s.env)
  assert.equal(resolveCredential(s.env).source, 'plugin-settings')
  assert.equal(resolveCredential({ ...s.env, AITRANSX_API_KEY: '${AITRANSX_API_KEY:-}' }).source, 'plugin-settings')
  assert.equal(resolveCredential({ ...s.env, AITRANSX_API_KEY: KEY_A }).source, 'env:AITRANSX_API_KEY')
})

test('settings defaults are applied and persisted patches merge', () => {
  const s = sandbox()
  assert.equal(loadSettings(s.env).imageModel, 'openai/gpt-image-2')
  saveSettings({ imageModel: 'm1' }, s.env)
  saveSettings({ refreshHours: 0 }, s.env)
  const v = loadSettings(s.env)
  assert.equal(v.imageModel, 'm1'); assert.equal(v.refreshHours, 0); assert.equal(v.visionModel, 'openai/gpt-6.1-terra')
})

test('import merges, replaces same id, keeps others and creates a backup', () => {
  const s = sandbox()
  writeFileSync(s.models, JSON.stringify([{ id: 'mine', url: 'https://example.com/v1', apiKey: 'k' }, atx('anthropic/claude-opus-5.5', 'old')]))
  const r = importModels([modelEntry('anthropic/claude-opus-5.5', { baseUrl: 'https://api.aitransx.com/v1/', key: KEY_A })], { path: s.models })
  assert.ok(r.backup)
  const list = readModels(s.models).models
  assert.deepEqual(list.map(m => m.id), ['mine', 'anthropic/claude-opus-5.5'])
  assert.equal(list[1].apiKey, KEY_A)
  assert.equal(list[1].url, 'https://api.aitransx.com/v1/chat/completions')
  assert.equal(list[1].supportsToolCall, true)
  assert.ok(list[1].iconUrl)
  assert.ok(readdirSync(s.home).some(f => f.startsWith('models.json.bak-')))
})

test('import preserves the { models: [...] } layout and works without an existing file', () => {
  const s = sandbox()
  importModels([modelEntry('a/b', { baseUrl: 'https://api.aitransx.com/v1', key: KEY_A })], { path: s.models })
  assert.ok(Array.isArray(JSON.parse(readFileSync(s.models, 'utf8'))))
  writeFileSync(s.models, JSON.stringify({ models: [], availableModels: ['x'] }))
  importModels([modelEntry('a/b', { baseUrl: 'https://api.aitransx.com/v1', key: KEY_A })], { path: s.models })
  const data = JSON.parse(readFileSync(s.models, 'utf8'))
  assert.deepEqual(data.availableModels, ['x']); assert.equal(data.models.length, 1)
})

test('BOM-prefixed models.json (written by Windows tools) is readable', () => {
  const s = sandbox()
  writeFileSync(s.models, '\uFEFF' + JSON.stringify([atx('x', KEY_A)]))
  assert.equal(resolveCredential(s.env).key, KEY_A)
})

test('remove only deletes ATX entries', () => {
  const s = sandbox()
  writeFileSync(s.models, JSON.stringify([{ id: 'same', url: 'https://example.com/v1', apiKey: 'k' }, atx('same', KEY_A), atx('keep', KEY_A)]))
  const r = removeModels(['same', 'missing'], { path: s.models })
  assert.deepEqual(r.removed, ['same'])
  assert.deepEqual(readModels(s.models).models.map(m => m.url.includes('example') ? 'foreign' : m.id), ['foreign', 'keep'])
  assert.equal(removeModels(['nothing'], { path: s.models }).backup, null)
})

test('主配置兼容旧数据且优先读取设置工具写入的 Key', () => {
  const s = sandbox()
  mkdirSync(s.env.ATX_DATA_DIR)
  writeFileSync(join(s.env.ATX_DATA_DIR, 'settings.json'), JSON.stringify({ apiKey: KEY_A, refreshHours: 2 }))
  assert.equal(resolveCredential(s.env).key, KEY_A)
  mkdirSync(join(s.home, 'atx-assistant'))
  writeFileSync(join(s.home, 'atx-assistant', 'settings.json'), '\uFEFF' + JSON.stringify({ apiKey: KEY_B }))
  assert.equal(resolveCredential(s.env).key, KEY_B)
  assert.equal(loadSettings(s.env).refreshHours, 2)
  saveSettings({ searchEnabled: false }, s.env)
  assert.equal(JSON.parse(readFileSync(join(s.home, 'atx-assistant', 'settings.json'), 'utf8')).apiKey, KEY_B)
})

test('保守图片默认、非 ATX 冲突拒绝且无备份副作用、备份不重名', () => {
  const s = sandbox()
  const entry = modelEntry('same', { baseUrl: 'https://api.aitransx.com/v1', key: KEY_A })
  assert.equal(entry.supportsImages, false)
  writeFileSync(s.models, JSON.stringify([{ id: 'same', url: 'https://example.com/v1' }]))
  const before = readFileSync(s.models, 'utf8')
  assert.throws(() => importModels([entry], { path: s.models }), /非 ATX 模型冲突/)
  assert.equal(readFileSync(s.models, 'utf8'), before)
  assert.equal(readdirSync(s.home).length, 1)
  writeFileSync(s.models, '[]')
  const now = new Date()
  const a = importModels([entry], { path: s.models, now })
  const b = importModels([entry], { path: s.models, now })
  assert.notEqual(a.backup, b.backup)
})

test('非法 models.json 结构拒绝覆盖', () => {
  const s = sandbox()
  writeFileSync(s.models, '{"unexpected":true}')
  assert.throws(() => importModels([], { path: s.models }), /格式不受支持/)
  assert.equal(readFileSync(s.models, 'utf8'), '{"unexpected":true}')
})

test('mask never reveals the full key', () => {
  const m = mask(KEY_A)
  assert.ok(!m.includes(KEY_A.slice(7, -4)))
  assert.equal(mask(''), '(未设置)')
})
