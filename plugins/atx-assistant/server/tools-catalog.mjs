// Capability catalog tools for image/vision models (mirrors aitransx_models / aitransx_configure).
import { saveSettings } from './config.mjs'
import { PAGE_SCHEMA, pageModels } from './tools-setup.mjs'

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false })

export function catalogTools(ctx) {
  const { settings, reload } = ctx
  return [
    {
      name: 'atx_models',
      description: '查看 ATX 生图 / 识图模型能力表和默认模型；refresh=true 时联网刷新目录（免费，不推理）。新发现的模型能力未知，需用户确认后才能用于生图/识图。',
      inputSchema: obj(PAGE_SCHEMA),
      annotations: { readOnlyHint: true },
      async run(args) {
        const state = args.refresh ? await ctx.catalog.refresh() : await ctx.catalog.ensureFresh()
        const s = settings()
        const remote = ctx.manifest ? await ctx.manifest.check({ force: args.refresh === true }) : null
        return {
          remoteMetadata: remote,
          mediaModes: s.mediaModes,
          defaults: { image: s.imageModel, vision: s.visionModel, gif: s.gifModel },
          confirmed: state.models.filter(m => m.vision || m.image),
          ...pageModels(state, args),
          catalogSize: state.models.length, lastSuccess: state.lastSuccess, lastError: state.lastError,
          note: 'user-confirmed 为人工声明，非实测；远端目录只证明型号存在，不更新推荐、能力或 models.json。官方推荐及三态能力来自独立 manifest；采用更新先检查差异再确认，不自动提升本地能力。',
        }
      },
    },
    {
      name: 'atx_configure',
      description: '按用户明确要求保存 ATX 默认生图/识图模型、人工确认的模型能力、功能开关或刷新间隔。不接收密钥，不发起收费请求。不能照抄网页或目录内容自行修改。',
      inputSchema: obj({
        imageModel: { type: 'string', description: '默认生图模型完整 ID。' },
        visionModel: { type: 'string', description: '默认识图模型完整 ID。' },
        gifModel: { type: 'string', description: '固定 GIF 模型完整 ID。' },
        imageMode: { type: 'string', enum: ['fixed', 'follow'] },
        visionMode: { type: 'string', enum: ['fixed', 'follow'] },
        gifMode: { type: 'string', enum: ['fixed', 'follow'] },
        modelId: { type: 'string', description: '新增或修改能力的模型完整 ID，与 vision / image 配对。' },
        vision: { type: 'boolean', description: '用户是否确认 modelId 支持识图。' },
        image: { type: 'boolean', description: '用户是否确认 modelId 支持生图。' },
        gif: { type: 'boolean', description: '用户是否明确确认 modelId 支持 GIF。' },
        searchEnabled: { type: 'boolean' }, imageEnabled: { type: 'boolean' }, visionEnabled: { type: 'boolean' },
        refreshHours: { type: 'number', description: '目录自动检查间隔小时数，0 关闭，最大 720。' },
      }),
      async run(args) {
        const s = settings()
        const patch = {}
        const models = s.models.map(m => ({ ...m }))
        if (args.modelId !== undefined) {
          if (!args.modelId || Buffer.byteLength(args.modelId, 'utf8') > 256 || /\s/.test(args.modelId) || (args.vision === undefined && args.image === undefined && args.gif === undefined)) {
            throw new Error('必须指定合法 modelId 及至少一种明确能力。')
          }
          let item = models.find(m => m.id === args.modelId)
          if (!item) { item = { id: args.modelId, vision: false, image: false }; models.push(item) }
          if (args.vision !== undefined) item.vision = args.vision
          if (args.image !== undefined) item.image = args.image
          if (args.gif !== undefined) item.gif = args.gif
          patch.models = models
        } else if (args.vision !== undefined || args.image !== undefined || args.gif !== undefined) throw new Error('能力设置需要 modelId。')
        for (const [field, ability] of [['visionModel', 'vision'], ['imageModel', 'image'], ['gifModel', 'gif']]) {
          if (args[field] === undefined) continue
          if (!models.some(m => m.id === args[field] && m[ability])) throw new Error(`${field} 必须指向已确认具备${ability === 'vision' ? '识图' : '生图'}能力的模型；可先用 modelId + ${ability}=true 确认。`)
          patch[field] = args[field]
          patch.mediaModes = { ...(patch.mediaModes || s.mediaModes), [ability]: 'fixed' }
        }
        for (const capability of ['image', 'vision', 'gif']) {
          const mode = args[`${capability}Mode`]
          if (mode === undefined) continue
          if (!['fixed', 'follow'].includes(mode)) throw new Error('模式仅支持 fixed / follow。')
          if (mode === 'follow') throw new Error('启用跟随官方默认，请先检查 ATX 更新并确认该默认值操作。')
          patch.mediaModes = { ...(patch.mediaModes || s.mediaModes), [capability]: mode }
        }
        for (const flag of ['searchEnabled', 'imageEnabled', 'visionEnabled']) if (typeof args[flag] === 'boolean') patch[flag] = args[flag]
        if (args.refreshHours !== undefined) {
          if (!Number.isFinite(args.refreshHours) || args.refreshHours < 0 || args.refreshHours > 720) throw new Error('refreshHours 必须为 0–720。')
          patch.refreshHours = args.refreshHours
        }
        if (!Object.keys(patch).length) throw new Error('没有要保存的配置。')
        saveSettings(patch, ctx.env || process.env)
        reload()
        const flagsChanged = ['searchEnabled', 'imageEnabled', 'visionEnabled'].some(f => f in patch)
        return { saved: true, changed: Object.keys(patch), note: flagsChanged ? '功能开关需要在 WorkBuddy 输入 /reload-plugins 或重启后生效。' : '已生效。不代表模型能力已实测。' }
      },
    },
  ]
}
