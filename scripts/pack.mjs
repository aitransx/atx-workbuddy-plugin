// 从干净的 Git HEAD 树生成发布包，不修改索引、不删除目录。
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const out = join(root, 'releases')
const zip = join(out, 'ATX-workbuddy.zip')
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
if (git(['status', '--porcelain', '--untracked-files=all'])) {
  throw new Error('打包要求工作区和索引干净；包括新增测试在内的修改须由维护者提交后再 pack。未生成发布包。')
}
const tree = git(['rev-parse', 'HEAD^{tree}'])
let scan = ''
try { scan = execFileSync('git', ['grep', '-nE', 'aitx-[A-Za-z0-9]{16,}', tree, '--', '.'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
catch (e) { if (e.status !== 1) throw e }
if (scan) throw new Error('仓库中疑似存在 API Key，拒绝打包。')
mkdirSync(out, { recursive: true })
execFileSync('git', ['archive', '--format=zip', '-o', zip, tree, '.codebuddy-plugin', 'plugins', 'README.md', 'NOTICE.md', 'RELEASING.md'], { cwd: root, stdio: 'inherit' })
if (!existsSync(zip)) throw new Error('未生成 ZIP。')
const sum = createHash('sha256').update(readFileSync(zip)).digest('hex')
writeFileSync(join(out, 'SHA256SUMS.txt'), `${sum}  ATX-workbuddy.zip\n`)
console.log(`Created ${zip}\nSHA256 ${sum}`)
