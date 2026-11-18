// 配置与模型管理不发起收费推理；只有明确导入或同步才写 models.json。
import { resolveCredential, saveSettings, loadSettings, readModels, modelsPath, settingsPath, importModels, removeModels,
  modelEntry, isAtxUrl, normalizeBaseUrl, mask, KEY_PATTERN } from './config.mjs'
import { RECOMMENDED_CHAT } from './catalog.mjs'
export { RECOMMENDED_CHAT } from './catalog.mjs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

export const SET_KEY_TOOL = join(dirname(dirname(fileURLToPath(import.meta.url))), 'extras', '设置ATX密钥.bat')
const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
const restart = '请从右下角托盘彻底退出 WorkBuddy 再打开，在模型选择中切换；只关窗口不生效。'
export const PAGE_SCHEMA = {
  keyword: { type: 'string', description: '按完整型号 ID 关键词查询；不推断能力。' },
  offset: { type: 'integer', minimum: 0, maximum: 10000, description: '分页起点，默认 0。' },
  limit: { type: 'integer', minimum: 1, maximum: 200, description: '每页 1–200，默认 40。' },
  refresh: { type: 'boolean', description: '立即刷新 /models 目录；不更新推荐或已导入模型。' },
}
export function pageModels(state, { keyword = '', offset = 0, limit = 40 }) {
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000 || !Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('分页参数：offset 为 0–10000，limit 为 1–200 的整数。')
  const matched = state.models.filter(m => m.id.toLowerCase().includes(keyword.trim().toLowerCase()))
  return { matched: matched.slice(offset, offset + limit), total: matched.length, offset, limit,
    nextOffset: offset + limit < matched.length ? offset + limit : null }
}
export function setupTools(ctx) {
  const env = ctx.env || process.env
  const path = () => modelsPath(env)
  const imported = () => readModels(path()).models.filter(m => isAtxUrl(m?.url))
  return [
    {
      name: 'atx_onboarding',
      description: 'ATX 新手入口：返回明确的本地设置工具路径和步骤。不索要 Key、不自动打开 GUI、不联网。',
      inputSchema: obj(), annotations: { readOnlyHint: true },
      async run() { return { setKeyTool: SET_KEY_TOOL, settingsFile: settingsPath(env), steps: [
        '先使用 WorkBuddy 原有可用且支持工具调用的模型完成配置；插件不能凭空提供可用聊天模型。',
        '手动打开 setKeyTool 指向的设置工具，私下粘贴 Key；不要把 Key 发到聊天。无需编辑 JSON。',
        '回到对话请求检查 ATX 状态，必要时 verify=true 验证目录访问；这不证明全部模型能力。',
        '查看推荐候选与目录。聊天和 tools 支持未实测，知晓风险后明确授权导入试用，不要批量导入全目录。',
        restart, '按需要求 ATX 生图或识图，这些调用可能收费；失败先核对记录，不自动重试。',
      ], note: '本插件是唯一官方接入入口，无需单独模型包；不会自动运行设置工具或打开文件夹。' } },
    },
    {
      name: 'atx_status', description: '检查 Key 来源（脱敏）、默认模型和已导入 ATX 模型；verify=true 仅验证目录接口访问，不证明能力。',
      inputSchema: obj({ verify: { type: 'boolean' } }), annotations: { readOnlyHint: true },
      async run({ verify = false }) {
        const cred = resolveCredential(env), s = loadSettings(env)
        let ids = [], modelsError
        try { ids = imported().map(m => m.id) } catch { modelsError = '无法读取 models.json，请检查格式或权限；未改动文件。' }
        let keyCheck = '未验证'
        if (verify && cred.key) {
          try { await ctx.client.post('/models', undefined, undefined, 'GET', { requireKey: true }); keyCheck = '目录访问有效（不代表能力已实测或余额保证）' }
          catch (e) { keyCheck = e.status === 401 ? '无效或已停用（401）' : '暂时无法验证目录访问' }
        }
        return { credentialConfigured: !!cred.key, key: mask(cred.key), keySource: cred.source, diagnostic: cred.diagnostic,
          keyCheck, baseUrl: cred.baseUrl, defaults: { image: s.imageModel, vision: s.visionModel },
          workbuddyModels: { file: path(), atxModels: ids, error: modelsError }, setKeyTool: SET_KEY_TOOL,
          catalog: { lastSuccess: ctx.catalog.snapshot().lastSuccess, lastError: ctx.catalog.snapshot().lastError },
          next: cred.key ? 'Key 已配置，能力不保证。导入聊天需明确授权与确认；改 Key 后可明确要求 atx_sync_models 同步已有模型。' : '请调用 atx_onboarding 获取设置工具绝对路径；私下设置 Key，不要发到聊天。' }
      },
    },
    {
      name: 'atx_set_key', description: '仅用户主动提供 Key 且明确要求保存时调用，不索要或复述 Key。保存本机配置，不自动修改已导入聊天模型。',
      inputSchema: obj({ apiKey: { type: 'string' }, baseUrl: { type: 'string' } }),
      async run({ apiKey, baseUrl }) {
        const patch = {}
        if (apiKey !== undefined) {
          if (!KEY_PATTERN.test(apiKey.trim())) throw new Error('Key 格式不对：应以 aitx- 开头，请私下使用设置工具。')
          patch.apiKey = apiKey.trim()
        }
        if (baseUrl !== undefined) {
          patch.baseUrl = baseUrl.trim() ? normalizeBaseUrl(baseUrl) : ''
        }
        if (!Object.keys(patch).length) throw new Error('没有要保存的内容。')
        saveSettings(patch, env); ctx.reload()
        return { saved: Object.keys(patch), note: '已保存本机配置。工具下次请求使用新 Key 和线路（环境变量仍优先）；已导入聊天模型不会自动同步，请用户明确授权 atx_sync_models 或重新导入。Key 已出现在聊天记录，如有顾虑请重置。' }
      },
    },
    {
      name: 'atx_list_chat_models', description: '查看推荐聊天候选与完整目录分页；目录含语音、视频、embedding 等，不代表聊天或 tools 支持。',
      inputSchema: obj(PAGE_SCHEMA), annotations: { readOnlyHint: true },
      async run(args) {
        const state = args.refresh ? await ctx.catalog.refresh() : await ctx.catalog.ensureFresh()
        const ids = imported().map(m => m.id)
        const available = RECOMMENDED_CHAT.filter(id => state.models.some(m => m.id === id && m.availability === 'available'))
        return { recommended: available.map(id => ({ id, imported: ids.includes(id), chatSupport: 'unknown', toolsSupport: 'unknown', availability: 'available' })),
          skipped: RECOMMENDED_CHAT.filter(id => !available.includes(id)),
          ...pageModels(state, args), catalogSize: state.models.length, catalogError: state.lastError,
          note: '推荐仅为候选，未实测。刷新只发现型号，不自动更新推荐、能力或本地模型。聊天/tools 未实测，知晓风险并授权后可导入试用，无需证明能力。' }
      },
    },
    {
      name: 'atx_import_models', description: '仅用户知晓聊天/tools 未实测并授权试用后导入；默认仅导入推荐的目录可用子集，返回 skipped。备份并拒绝非 ATX 同 ID 冲突，不导入全目录。',
      inputSchema: obj({ models: { type: 'array', items: { type: 'string' }, maxItems: 50 },
        confirmUnverified: { type: 'boolean', description: '用户知晓聊天及工具调用能力未知、未实测，仍明确授权导入试用；不是能力证明。' },
        confirmChatSupport: { type: 'boolean', description: '兼容旧参数；仅表示知情试用授权，不表示验证能力。' },
        supportsImages: { type: 'boolean', description: '仅用户明确确认图片输入时为 true，默认 false。' } }),
      async run({ models, confirmUnverified = false, confirmChatSupport = false, supportsImages = false }) {
        const cred = resolveCredential(env)
        if (!cred.key) throw new Error('还没有 ATX Key，请先用 atx_onboarding 私下设置。')
        const recommended = !models?.length || (models.length === 1 && models[0] === 'recommended')
        let ids = recommended ? [...RECOMMENDED_CHAT] : models.map(s => String(s).trim())
        ids = [...new Set(ids)]
        if (ids.length > 50 || ids.some(id => !id || /\s|[\u0000-\u001f\u007f]/u.test(id) || id.length > 200)) throw new Error('模型 ID 不合法或超过 50 个；请按需选择完整型号，不要导入全目录。')
        const state = await ctx.catalog.ensureFresh()
        if (state.lastError || state.lastSuccess === null) throw new Error('模型目录获取失败或尚未刷新，未写入。请检查 Key/线路后明确刷新目录，再导入；目录存在也不证明能力。')
        const missing = ids.filter(id => !state.models.some(m => m.id === id && m.availability === 'available'))
        if (missing.length && !recommended) throw new Error(`以下模型不在 ATX 目录中，未写入：${missing.join(', ')}。请查询或刷新完整 ID。`)
        ids = ids.filter(id => !missing.includes(id))
        if (!ids.length) return { added: [], skipped: missing, note: '没有目录可用的推荐候选，未写入；目录不证明能力。' }
        if (confirmUnverified !== true && confirmChatSupport !== true) throw new Error('这些型号的聊天及工具调用能力未知、未实测。请先展示目录可用候选和 skipped，用户知晓风险并明确授权导入试用后才能继续；不要求用户证明能力。')
        const result = importModels(ids.map(id => modelEntry(id, { baseUrl: cred.baseUrl, key: cred.key, vision: supportsImages })), { path: path() })
        return { ...result, skipped: missing, next: restart, note: '按知情试用授权写入聊天/tools 配置，能力仍未知、未实测，不保证可用。' }
      },
    },
    {
      name: 'atx_sync_models', description: '用户明确授权后，将当前有效 Key 和线路同步到已导入 ATX 聊天模型；保留能力与其他字段并备份，不添加新型号。',
      inputSchema: obj({ confirm: { type: 'boolean', description: '用户明确同意同步已有 ATX 模型时为 true。' } }, ['confirm']),
      async run({ confirm }) {
        if (confirm !== true) throw new Error('需要用户明确授权同步（confirm=true）。')
        const cred = resolveCredential(env)
        if (!cred.key) throw new Error('未找到 Key，请先私下设置。')
        const entries = imported().map(m => ({ ...m, apiKey: cred.key, url: `${normalizeBaseUrl(cred.baseUrl)}/chat/completions` }))
        if (!entries.length) return { synced: [], note: '没有已导入 ATX 模型，未写入。' }
        return { ...importModels(entries, { path: path() }), next: restart }
      },
    },
    {
      name: 'atx_remove_models', description: '仅用户明确要求时移除指定 ATX 模型并备份，非 ATX 条目不动。',
      inputSchema: obj({ models: { type: 'array', items: { type: 'string' } } }, ['models']),
      async run({ models }) {
        if (!Array.isArray(models) || !models.length) throw new Error('请指定要移除的模型 ID。')
        return { ...removeModels(models, { path: path() }), note: restart }
      },
    },
  ]
}
