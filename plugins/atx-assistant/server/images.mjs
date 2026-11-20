// Image input/output helpers: read user-specified local images and save generated images to disk.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, join, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import { validateImage } from './core.mjs'

export const INPUT_LIMIT = 4 * 1024 * 1024

export function sniffImage(bytes) {
  const b = Buffer.from(bytes)
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg'
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  throw new Error('只接受 PNG、JPEG、WebP 图片。')
}

export function decodeImage(encoded) {
  if (typeof encoded !== 'string' || !encoded.length || encoded.length > 28 * 1024 * 1024 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error('服务返回的图片编码无效或过大。请勿自动重试，先检查 ATX 请求记录。')
  }
  const data = Buffer.from(encoded, 'base64')
  const signature = data.toString('ascii', 0, 6)
  return { data, mediaType: signature === 'GIF87a' || signature === 'GIF89a' ? 'image/gif' : sniffImage(data) }
}

/** Strip surrounding quotes that Windows "Copy as path" adds. */
export const cleanPath = value => value.trim().replace(/^["']|["']$/g, '')

/** Turn a public HTTPS URL, data URL or local path into something the ATX API accepts. */
export async function imageInput(value, { cwd = process.cwd() } = {}) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('图片路径不能为空。')
  const v = cleanPath(value)
  if (/^(https:|data:)/i.test(v)) return validateImage(v)
  if (/^http:/i.test(v)) throw new Error('只接受 HTTPS 图片链接或本地文件路径。')
  const expanded = v.startsWith('~') ? join(homedir(), v.slice(1)) : v
  const target = isAbsolute(expanded) ? expanded : resolve(cwd, expanded)
  let info
  try { info = await stat(target) } catch { throw new Error(`找不到图片文件：${target}。请确认路径，Windows 可在文件上按 Shift+右键「复制文件地址」。`) }
  if (!info.isFile()) throw new Error(`不是文件：${target}`)
  if (info.size > INPUT_LIMIT) throw new Error('本地图片每张不能超过 4 MiB。')
  const data = await readFile(target)
  const mediaType = sniffImage(data)
  return validateImage(`data:${mediaType};base64,${data.toString('base64')}`)
}

export async function imageInputs(values, max = 4, opts) {
  if (!Array.isArray(values) || values.length < 1 || values.length > max) throw new Error(`图片数量必须为 1–${max}。`)
  const out = []
  for (const v of values) out.push(await imageInput(v, opts))
  return out
}

/** Save generated image bytes into the output directory; name is content-addressed to avoid duplicates. */
export async function saveImage(data, mediaType, dir) {
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[mediaType]
  if (!ext) throw new Error('服务返回的图片格式不受支持。')
  await mkdir(dir, { recursive: true })
  const path = join(dir, `atx-${createHash('sha256').update(data).digest('hex').slice(0, 12)}.${ext}`)
  await writeFile(path, data)
  return path
}
