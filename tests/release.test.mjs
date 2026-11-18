import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, cpSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const psQuote = value => "'" + value.replaceAll("'", "''") + "'"

test('0.3.0 版本在全部发布清单和服务入口保持一致', async () => {
  const { VERSION } = await import('../plugins/atx-assistant/server/index.mjs')
  assert.equal(VERSION, '0.3.0')
  for (const file of ['package.json', 'plugins/atx-assistant/.codebuddy-plugin/plugin.json']) {
    assert.equal(JSON.parse(readFileSync(join(root, file), 'utf8')).version, VERSION)
  }
  const market = JSON.parse(readFileSync(join(root, '.codebuddy-plugin/marketplace.json'), 'utf8'))
  assert.equal(market.plugins.find(plugin => plugin.name === 'atx-assistant').version, VERSION)
})

test('Windows 真正 ZIP 解压目录经 shell 和 PATHEXT 完成 stdio initialize', { skip: process.platform !== 'win32', timeout: 30000 }, async () => {
  const temp = mkdtempSync(join(tmpdir(), 'atx-zip-'))
  const source = join(temp, 'source'), unpacked = join(temp, 'unpacked')
  mkdirSync(source)
  // 只复制既有文件，不生成或改写 ps1/bat；保留解压样本供检查。
  cpSync(join(root, 'plugins'), join(source, 'plugins'), { recursive: true })
  cpSync(join(root, '.codebuddy-plugin'), join(source, '.codebuddy-plugin'), { recursive: true })
  for (const name of ['README.md', 'NOTICE.md', 'RELEASING.md']) cpSync(join(root, name), join(source, name))
  const zip = join(temp, 'test.zip')
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory(${psQuote(source)}, ${psQuote(zip)}); [IO.Compression.ZipFile]::ExtractToDirectory(${psQuote(zip)}, ${psQuote(unpacked)})`])
  assert.ok(existsSync(join(unpacked, 'RELEASING.md')))
  const plugin = join(unpacked, 'plugins', 'atx-assistant')
  const mcp = JSON.parse(readFileSync(join(plugin, '.mcp.json'), 'utf8')).mcpServers.atx
  const expand = value => value.replaceAll('${CODEBUDDY_PLUGIN_ROOT}', plugin)
  const command = expand(mcp.command)
  assert.ok(!command.endsWith('.cmd'))
  const child = spawn(`"${command}"`, mcp.args.map(arg => `"${expand(arg)}"`), {
    cwd: plugin, shell: true, windowsHide: true,
    env: { ...process.env, WORKBUDDY_HOME: join(temp, 'home'), ATX_DATA_DIR: join(temp, 'data'), AITRANSX_API_KEY: '', AITRANSX_BASE_URL: '', WORKBUDDY_EXTRA_PATHS: dirname(process.execPath), PATHEXT: '.COM;.EXE;.BAT;.CMD' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const result = await new Promise((resolve, reject) => {
    let output = '', errors = ''
    const timer = setTimeout(() => { child.stdin.end(); reject(new Error('初始化超时：' + errors)) }, 15000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.stderr.on('data', data => { errors += data })
    child.stdout.on('data', data => { output += data })
    child.on('close', code => {
      clearTimeout(timer)
      if (code !== 0) return reject(new Error(`启动退出码 ${code}: ${errors}`))
      try { resolve(output.trim().split(/\r?\n/).map(line => JSON.parse(line))) } catch (error) { reject(error) }
    })
    child.stdin.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) + '\n')
  })
  assert.equal(result[0].result.serverInfo.name, 'atx-assistant')
  assert.equal(result[0].result.serverInfo.version, '0.3.0')
})

test('打包在脏工作区拒绝且不覆盖已有产物，不修改索引', () => {
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' })
  if (!status.trim()) return
  const files = ['ATX-workbuddy.zip', 'ATX-skill.zip', 'SHA256SUMS.txt'].map(name => join(root, 'releases', name))
  const before = files.map(path => existsSync(path) ? readFileSync(path) : null)
  const index = execFileSync('git', ['diff', '--cached', '--binary'], { cwd: root })
  assert.throws(() => execFileSync(process.execPath, ['scripts/pack.mjs'], { cwd: root, stdio: 'pipe' }), error => {
    assert.match(error.stderr.toString(), /工作区和索引干净/)
    return true
  })
  files.forEach((path, i) => assert.deepEqual(existsSync(path) ? readFileSync(path) : null, before[i]))
  assert.deepEqual(execFileSync('git', ['diff', '--cached', '--binary'], { cwd: root }), index)
  assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' }), status)
})
