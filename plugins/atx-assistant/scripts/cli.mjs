#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import { buildContext, buildTools } from '../server/index.mjs'
import { resolveCredential } from '../server/config.mjs'

const paidTools = new Set(['atx_search', 'atx_fetch', 'atx_generate_image', 'atx_recognize_image'])
const privateKeyHint = 'CLI 禁止设置或传入 API Key；请运行 atx_onboarding，手动打开返回的 setKeyTool 私下设置，不要把 Key 放进 argv 或聊天。'

function validate(value, schema) {
  const invalid = () => { throw new Error('参数不符合工具 inputSchema；请运行 list 查看类型、必填项、范围及允许字段。') }
  switch (schema.type) {
    case 'object':
      if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid()
      for (const name of schema.required || []) if (!Object.hasOwn(value, name)) invalid()
      for (const [name, item] of Object.entries(value)) {
        if (!Object.hasOwn(schema.properties || {}, name)) {
          if (schema.additionalProperties === false) invalid()
        } else validate(item, schema.properties[name])
      }
      break
    case 'array':
      if (!Array.isArray(value)) invalid()
      if (schema.maxItems !== undefined && value.length > schema.maxItems) invalid()
      for (const item of value) validate(item, schema.items)
      break
    case 'string': if (typeof value !== 'string') invalid(); break
    case 'boolean': if (typeof value !== 'boolean') invalid(); break
    case 'integer': if (!Number.isSafeInteger(value)) invalid(); break
    case 'number': if (typeof value !== 'number' || !Number.isFinite(value)) invalid(); break
    default: throw new Error('工具 schema 类型不受 CLI 支持，未执行。')
  }
  if (schema.minimum !== undefined && value < schema.minimum) invalid()
  if (schema.maximum !== undefined && value > schema.maximum) invalid()
}

export async function runCli(argv, { env = process.env, contextFactory = buildContext } = {}) {
  let secret = ''
  const redact = text => {
    if (secret) text = text.replaceAll(secret, '[已脱敏]')
    return text.replace(/aitx-[A-Za-z0-9]+/g, '[已脱敏]')
  }
  try {
    const [name, json] = argv
    if (name === 'atx_set_key' || argv.some(arg => /aitx-|apiKey|AITRANSX_API_KEY/i.test(arg))) throw new Error(privateKeyHint)
    if (!name || argv.length > 2 || (name === 'list' && argv.length !== 1)) {
      throw new Error('用法：node cli.mjs list 或 node cli.mjs toolName [JSON参数]；不要通过 argv 传入 Key。')
    }
    let args = {}
    if (json !== undefined) {
      try { args = JSON.parse(json) } catch { throw new Error('JSON 参数格式无效；未执行。') }
    }
    secret = resolveCredential(env).key
    const tools = buildTools(contextFactory(env)).filter(tool => tool.name !== 'atx_set_key')
    let result
    if (name === 'list') {
      result = { tools: tools.map(({ name, description, inputSchema, annotations }) => ({
        name, description, inputSchema, annotations, potentiallyPaid: paidTools.has(name),
      })), note: privateKeyHint }
    } else {
      const tool = tools.find(tool => tool.name === name)
      if (!tool) throw new Error('未知或未启用的工具；请运行 list。')
      validate(args, tool.inputSchema)
      if (paidTools.has(name) && !secret) throw new Error('未找到 ATX API Key；未发起请求或读取图片。请通过 atx_onboarding 私下设置。')
      result = await tool.run(args)
    }
    return { exitCode: 0, output: redact(JSON.stringify({ ok: true, result })) }
  } catch (error) {
    return { exitCode: 1, output: JSON.stringify({ ok: false, error: redact(String(error?.message || '执行失败；未输出内部堆栈。')) }) }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { exitCode, output } = await runCli(process.argv.slice(2))
  process.stdout.write(output + '\n')
  process.exitCode = exitCode
}
