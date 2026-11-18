// 从干净的 Git HEAD 树生成发布包，不修改索引、不删除目录。
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const out = join(root, 'releases')
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
if (git(['status', '--porcelain', '--untracked-files=all'])) {
  throw new Error('打包要求工作区和索引干净；包括新增测试在内的修改须由维护者提交后再 pack。未生成发布包。')
}
const tree = git(['rev-parse', 'HEAD^{tree}'])
let scan = ''
try { scan = execFileSync('git', ['grep', '-nE', 'aitx-[A-Za-z0-9]{16,}', tree, '--', '.'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
catch (e) { if (e.status !== 1) throw e }
if (scan) throw new Error('仓库中疑似存在 API Key，拒绝打包。')
const temp = mkdtempSync(join(tmpdir(), 'atx-pack-'))
const names = ['ATX-workbuddy.zip', 'ATX-skill.zip']
try {
  const archive = join(temp, 'head.zip')
  execFileSync('git', ['archive', '--format=zip', '-o', archive, tree, '.codebuddy-plugin', 'plugins', 'skill-upload', 'README.md', 'NOTICE.md', 'RELEASING.md'], { cwd: root, stdio: 'inherit' })
  // 仅重组 HEAD 归档；白名单拒绝个人配置，原样保留现有设置脚本。
  execFileSync('python', ['-c', `
import sys, zipfile
from pathlib import PurePosixPath
source, market, skill = sys.argv[1:]
with zipfile.ZipFile(source) as src, zipfile.ZipFile(market, 'w', zipfile.ZIP_DEFLATED) as dst, zipfile.ZipFile(skill, 'w', zipfile.ZIP_DEFLATED) as upload:
    required = {'atx-assistant/SKILL.md', 'atx-assistant/scripts/cli.mjs', 'atx-assistant/server/index.mjs', 'atx-assistant/server/model-registry.json', 'atx-assistant/extras/set-key.ps1', 'atx-assistant/extras/设置ATX密钥.bat'}
    for info in src.infolist():
        if info.is_dir():
            continue
        path = PurePosixPath(info.filename)
        if path.name.lower() in {'settings.json', 'models.json'} or any(p.lower() in {'cache', '.cache', 'node_modules', '__pycache__'} or p.lower().startswith('.env') for p in path.parts):
            raise RuntimeError('归档含个人配置或缓存：' + info.filename)
        data = src.read(info)
        if path.parts[0] != 'skill-upload':
            dst.writestr(info, data)
        target = None
        if info.filename == 'skill-upload/SKILL.md':
            target = 'atx-assistant/SKILL.md'
        elif path.parts[:2] == ('plugins', 'atx-assistant') and len(path.parts) > 3 and path.parts[2] in {'scripts', 'server', 'extras', 'bin'}:
            target = str(PurePosixPath('atx-assistant', *path.parts[2:]))
        if target:
            info.filename = target
            upload.writestr(info, data)
            required.discard(target)
    if required:
        raise RuntimeError('技能包缺少必要文件：' + ', '.join(sorted(required)))
`, archive, ...names.map(name => join(temp, name))], { cwd: root, stdio: 'inherit' })
  mkdirSync(out, { recursive: true })
  const sums = names.map(name => {
    const data = readFileSync(join(temp, name))
    writeFileSync(join(out, name), data)
    return `${createHash('sha256').update(data).digest('hex')}  ${name}\n`
  }).join('')
  writeFileSync(join(out, 'SHA256SUMS.txt'), sums)
  console.log(`Created ${names.join(', ')}\n${sums}`)
} finally {
  rmSync(temp, { recursive: true, force: true })
}
