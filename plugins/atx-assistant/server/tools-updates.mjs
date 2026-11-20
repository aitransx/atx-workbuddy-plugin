import { createUpdates } from './updates.mjs'

const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
const ids = maxItems => ({ type: 'array', items: { type: 'string', minLength: 1, maxLength: 512 }, maxItems, uniqueItems: true, default: [] })
export function updateTools(ctx) {
  const updates = createUpdates(ctx)
  return [
    {
      name: 'atx_check_updates',
      description: '检查公开清单并生成十分钟有效的无密钥更新计划；不修改模型或设置。公开清单请求不使用凭据；独立目录可用性检查可能使用本地凭据。检查后必须展示候选，让用户明确选择再应用。',
      inputSchema: obj({ force: { type: 'boolean', default: false } }),
      annotations: { readOnlyHint: true },
      run: args => updates.check(args),
    },
    {
      name: 'atx_apply_updates',
      description: '仅应用用户明确选中的计划操作。默认空选择，不自动更新、替代、删除或切换默认模型。未知及未验证能力须知情确认。个人字段、跨线路覆盖和 removeOld=true 均拒绝；失败会返回实际恢复备份路径。',
      inputSchema: obj({
        planId: { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' },
        confirm: { type: 'boolean', const: true },
        addIds: ids(50), mediaIds: ids(50), overrideChangeIds: ids(100), defaultChangeIds: ids(3),
        replacements: { type: 'array', maxItems: 50, default: [], items: obj({
          from: { type: 'string', minLength: 1, maxLength: 256 }, to: { type: 'string', minLength: 1, maxLength: 256 },
          removeOld: { type: 'boolean', default: false },
        }, ['from', 'to']) },
        confirmUnverified: { type: 'boolean', default: false },
      }, ['planId', 'confirm']),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      run: args => updates.apply(args),
    },
  ]
}
