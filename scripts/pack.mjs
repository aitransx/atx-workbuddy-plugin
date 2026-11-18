// Build releases/ATX-workbuddy.zip (marketplace root) and SHA256SUMS.txt from the staged git tree.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const out = join(root, 'releases')
const zip = join(out, 'ATX-workbuddy.zip')

// Refuse to package anything that looks like a real key (git grep exits 1 when nothing matches).
let scan = ''
try { scan = execFileSync('git', ['grep', '--cached', '-nE', 'aitx-[A-Za-z0-9]{16,}', '--', '.'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
catch (e) { if (e.status !== 1) throw e }
if (scan) throw new Error('Possible API key found in repository://n' + scan)

// Keep any other release artifacts; replace only this build's named outputs.
mkdirSync(out, { recursive: true })
// Archive the staged tree: portable '/' paths, UTF-8 names, .gitattributes eol rules and exec bits applied.
const tree = execFileSync('git', ['write-tree'], { cwd: root, encoding: 'utf8' }).trim()
execFileSync('git', ['archive', '--format=zip', '-o', zip, tree, '.codebuddy-plugin', 'plugins', 'README.md', 'NOTICE.md'], { cwd: root, stdio: 'inherit' })
if (!existsSync(zip)) throw new Error('ZIP was not created.')
const sum = createHash('sha256').update(readFileSync(zip)).digest('hex')
writeFileSync(join(out, 'SHA256SUMS.txt'), `${sum}  ATX-workbuddy.zip\n`)
console.log(`Created ${zip}\nSHA256 ${sum}`)
