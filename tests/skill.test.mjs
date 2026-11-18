import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readdirSync, copyFileSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { runCli } from '../plugins/atx-assistant/scripts/cli.mjs'
import { buildContext } from '../plugins/atx-assistant/server/index.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const cli = join(root, 'plugins/atx-assistant/scripts/cli.mjs')
const KEY = 'aitx-' + 'z'.repeat(32)

function sandbox(t) {
  const home = mkdtempSync(join(tmpdir(), 'atx-skill-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const env = { ...process.env, HOME: home, USERPROFILE: home, WORKBUDDY_HOME: join(home, '.workbuddy'),
    ATX_DATA_DIR: join(home, 'legacy'), AITRANSX_API_KEY: '', AITRANSX_BASE_URL: '',
    WORKBUDDY_PROJECT_DIR: home, CODEBUDDY_PROJECT_DIR: home }
  return { home, env }
}

function call(env, args, script = cli) {
  // 子进程禁止所有 fetch；任何网络尝试均以专用退出码使测试失败。
  const code = `globalThis.fetch = async () => { process.exitCode = 98; throw new Error('测试禁止联网') };
    const { runCli } = await import(${JSON.stringify(pathToFileURL(script).href)});
    const result = await runCli(process.argv.slice(1));
    process.stdout.write(result.output + '\\n');
    if (process.exitCode !== 98) process.exitCode = result.exitCode;`
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code, '--', ...args], {
    env, encoding: 'utf8', timeout: 10000, cwd: env.HOME,
  })
  assert.ifError(child.error)
  assert.notEqual(child.status, 98, '不得尝试联网')
  assert.equal(child.stderr, '')
  return { status: child.status, text: child.stdout, data: JSON.parse(child.stdout) }
}

test('CLI list、status、onboarding 离线运行，使用临时 HOME 且不写配置', t => {
  const { env } = sandbox(t)
  const list = call(env, ['list'])
  assert.equal(list.status, 0)
  assert.ok(list.data.result.tools.some(tool => tool.name === 'atx_status'))
  assert.ok(!list.data.result.tools.some(tool => tool.name === 'atx_set_key'))
  for (const tool of list.data.result.tools) assert.equal(tool.inputSchema.type, 'object')
  assert.equal(list.data.result.tools.filter(tool => tool.potentiallyPaid).length, 4)
  const status = call(env, ['atx_status'])
  assert.equal(status.status, 0)
  assert.equal(status.data.result.credentialConfigured, false)
  assert.equal(status.data.result.workbuddyModels.file, join(env.WORKBUDDY_HOME, 'models.json'))
  assert.equal(call(env, ['atx_status', '{"verify":true}']).status, 0)
  const onboarding = call(env, ['atx_onboarding'])
  assert.equal(onboarding.status, 0)
  assert.ok(existsSync(onboarding.data.result.setKeyTool))
  assert.ok(!existsSync(env.WORKBUDDY_HOME))
})

test('CLI 拒绝非法参数且不回显敏感输入、不写文件', t => {
  const { env } = sandbox(t)
  const cases = [[], ['list', '{}'], ['unknown'], ['atx_status', '{'], ['atx_status', 'null'],
    ['atx_status', '[]'], ['atx_status', '{"verify":"true"}'], ['atx_status', '{}', '{}'],
    ['atx_status', '{"extra":true}'], ['atx_status', '{"__proto__":{}}'],
    ['atx_models', '{"limit":0}'], ['atx_models', '{"limit":201}'], ['atx_models', '{"offset":0.5}'],
    ['atx_sync_models', '{}'], ['atx_remove_models', '{"models":[1]}'], ['atx_search', '{}'],
    ['atx_configure', '{"refreshHours":1e400}'],
    ['atx_import_models', JSON.stringify({ models: Array(51).fill('test') })],
    ['atx_set_key', JSON.stringify({ apiKey: KEY })], ['atx_search', JSON.stringify({ query: KEY })]]
  for (const args of cases) {
    const result = call(env, args)
    assert.equal(result.status, 1)
    assert.equal(result.data.ok, false)
    assert.ok(!result.text.includes(KEY))
    assert.ok(!result.text.includes('SyntaxError'))
  }
  assert.ok(!existsSync(env.WORKBUDDY_HOME))
})

test('四种收费操作无 Key 时在联网或读取图片之前安全失败', t => {
  const { env } = sandbox(t)
  for (const [name, args] of [
    ['atx_search', { query: '测试' }], ['atx_fetch', { url: 'https://example.com' }],
    ['atx_generate_image', { prompt: '测试', references: ['不存在的图片.png'] }],
    ['atx_recognize_image', { images: ['不存在的图片.png'] }],
  ]) {
    const result = call(env, [name, JSON.stringify(args)])
    assert.equal(result.status, 1)
    assert.match(result.data.error, /未找到 ATX API Key/)
  }
  assert.ok(!existsSync(env.WORKBUDDY_HOME))
})

test('已配置 Key 的 list/status/onboarding 不自动执行收费操作', t => {
  const { env } = sandbox(t)
  env.AITRANSX_API_KEY = KEY
  for (const args of [['list'], ['atx_status'], ['atx_onboarding']]) {
    const result = call(env, args)
    assert.equal(result.status, 0)
    assert.ok(!result.text.includes(KEY))
  }
})

test('CLI 调用真实 handler，错误脱敏且收费失败只执行一次', async t => {
  const { env } = sandbox(t)
  env.AITRANSX_API_KEY = KEY
  let calls = 0
  const contextFactory = env => buildContext(env, { clientFactory: () => ({
    async search() { calls++; throw new Error(`上游拒绝 ${KEY} ${'aitx-' + 'anotherSecretValue123'}`) },
  }) })
  const result = await runCli(['atx_search', '{"query":"测试"}'], { env, contextFactory })
  assert.equal(result.exitCode, 1)
  assert.equal(calls, 1)
  assert.ok(!result.output.includes(KEY))
  assert.ok(!result.output.includes('aitx-' + 'anotherSecretValue123'))
  assert.match(JSON.parse(result.output).error, /已脱敏/)
})

test('配置解析错误也以脱敏 JSON 返回', t => {
  const { env } = sandbox(t)
  mkdirSync(join(env.WORKBUDDY_HOME, 'atx-assistant'), { recursive: true })
  writeFileSync(join(env.WORKBUDDY_HOME, 'atx-assistant/settings.json'), `{"apiKey":"${KEY}" broken}`)
  const result = call(env, ['atx_status'])
  assert.equal(result.status, 1)
  assert.ok(!result.text.includes(KEY))
})

test('独立上传布局离开仓库后通过 CLI 主入口执行，无需 MCP', t => {
  const { home, env } = sandbox(t)
  const skill = join(home, '含 空格', 'atx-assistant')
  mkdirSync(skill, { recursive: true })
  copyFileSync(join(root, 'skill-upload/SKILL.md'), join(skill, 'SKILL.md'))
  for (const dir of ['scripts', 'server', 'extras']) {
    const source = join(root, 'plugins/atx-assistant', dir)
    mkdirSync(join(skill, dir))
    for (const name of readdirSync(source)) copyFileSync(join(source, name), join(skill, dir, name))
  }
  const packagedCli = join(skill, 'scripts/cli.mjs')
  const child = spawnSync(process.execPath, [packagedCli, 'atx_onboarding'], { env, cwd: home, encoding: 'utf8', timeout: 10000 })
  assert.equal(child.status, 0, child.stderr)
  assert.equal(child.stderr, '')
  assert.equal(JSON.parse(child.stdout).result.setKeyTool, join(skill, 'extras/设置ATX密钥.bat'))
  assert.equal(call(env, ['list'], packagedCli).status, 0)
  assert.equal(call(env, ['atx_status'], packagedCli).status, 0)
  assert.ok(!existsSync(join(skill, '.mcp.json')))
  const template = readFileSync(join(skill, 'SKILL.md'), 'utf8')
  assert.match(template, /WORKBUDDY_EXTRA_PATHS/)
  assert.match(template, /禁止 CLI 调用 `atx_set_key`/)
  assert.match(template, /不自动重试/)
})
