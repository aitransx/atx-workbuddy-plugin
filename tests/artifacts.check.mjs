// 显式打包后验收；不纳入常规 *.test.mjs，不要求开发时已有发布包。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
test('最终双包与 HEAD 一致，校验和正确且技能解压后离线运行', t => {
  for (const name of ['ATX-workbuddy.zip', 'ATX-skill.zip', 'SHA256SUMS.txt']) {
    assert.ok(existsSync(join(root, 'releases', name)), `缺少 ${name}；请维护者提交并从干净 HEAD 运行 npm run pack`)
  }
  const temp = mkdtempSync(join(tmpdir(), 'atx-artifacts-'))
  t.after(() => rmSync(temp, { recursive: true, force: true }))
  execFileSync('python', ['-c', `
import hashlib, io, pathlib, subprocess, sys, zipfile
root, target = map(pathlib.Path, sys.argv[1:])
names = ['ATX-workbuddy.zip', 'ATX-skill.zip']
expected = {name: {} for name in names}
archive = subprocess.check_output(['git', 'archive', '--format=zip', 'HEAD', '.codebuddy-plugin', 'plugins', 'skill-upload', 'README.md', 'NOTICE.md', 'RELEASING.md'], cwd=root)
with zipfile.ZipFile(io.BytesIO(archive)) as src:
    for info in src.infolist():
        if info.is_dir():
            continue
        p = pathlib.PurePosixPath(info.filename)
        data = src.read(info)
        if p.parts[0] != 'skill-upload':
            expected[names[0]][info.filename] = data
        if info.filename == 'skill-upload/SKILL.md':
            expected[names[1]]['atx-assistant/SKILL.md'] = data
        elif p.parts[:2] == ('plugins', 'atx-assistant') and len(p.parts) > 3 and p.parts[2] in {'scripts', 'server', 'extras', 'bin'}:
            expected[names[1]][str(pathlib.PurePosixPath('atx-assistant', *p.parts[2:]))] = data
sums = ''
for name in names:
    path = root / 'releases' / name
    sums += hashlib.sha256(path.read_bytes()).hexdigest() + '  ' + name + '\\n'
    with zipfile.ZipFile(path) as z:
        entries = z.namelist()
        assert len(entries) == len(set(entries)), '重复 ZIP 条目'
        assert all(not pathlib.PurePosixPath(n).is_absolute() and '..' not in pathlib.PurePosixPath(n).parts and '\\\\' not in n for n in entries), '不安全路径'
        actual = {i.filename: z.read(i) for i in z.infolist() if not i.is_dir()}
        assert actual == expected[name], name + ' 文件集合或内容与 HEAD 不一致'
        for n, data in actual.items():
            p = pathlib.PurePosixPath(n)
            assert p.name.lower() not in {'settings.json', 'models.json'}
            assert not any(part.lower() in {'cache', '.cache', 'node_modules', '__pycache__'} or part.lower().startswith('.env') for part in p.parts)
        if name == names[1]:
            assert {pathlib.PurePosixPath(n).parts[0] for n in entries} == {'atx-assistant'}
            assert 'atx-assistant/.mcp.json' not in actual
            for n in ['SKILL.md', 'scripts/cli.mjs', 'server/index.mjs', 'server/model-registry.json', 'extras/set-key.ps1', 'extras/设置ATX密钥.bat']:
                assert 'atx-assistant/' + n in actual, n
            z.extractall(target)
assert (root / 'releases' / 'SHA256SUMS.txt').read_text() == sums, '双包 SHA256 不匹配'
`, root, temp], { cwd: root, stdio: 'pipe' })
  const home = join(temp, '隔离 HOME')
  const skill = join(temp, 'atx-assistant')
  const env = { ...process.env, HOME: home, USERPROFILE: home, WORKBUDDY_HOME: join(home, '.workbuddy'),
    ATX_DATA_DIR: join(home, 'legacy'), AITRANSX_API_KEY: '', AITRANSX_BASE_URL: '' }
  for (const name of ['list', 'atx_status', 'atx_onboarding']) {
    const code = `globalThis.fetch = () => { throw new Error('产物测试禁止联网') }; const {runCli} = await import(${JSON.stringify(pathToFileURL(join(skill, 'scripts/cli.mjs')).href)}); const r = await runCli([${JSON.stringify(name)}]); process.stdout.write(r.output); process.exitCode = r.exitCode;`
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { env, cwd: temp, encoding: 'utf8' }))
    assert.equal(result.ok, true)
    if (name === 'atx_onboarding') assert.equal(result.result.setKeyTool, join(skill, 'extras/设置ATX密钥.bat'))
    if (name === 'atx_status') assert.equal(result.result.credentialConfigured, false)
  }
  assert.ok(!existsSync(home), '只读 CLI 不应写个人配置')
})
