# 发布与更新

仓库：https://github.com/aitransx/atx-workbuddy-plugin

## 目录结构

```
.codebuddy-plugin/marketplace.json   # 插件市场清单（市场名 aitransx）
plugins/atx-assistant/               # 插件本体
  .codebuddy-plugin/plugin.json      # 插件清单
  .mcp.json                          # MCP 服务器声明（server: atx → 工具名 mcp__atx__*）
  bin/run-node(.cmd)                 # 使用 WorkBuddy 自带 Node 启动，零依赖
  server/*.mjs                       # MCP 服务器与工具实现
  skills/atx-assistant/SKILL.md      # 意图路由与安全规则
  extras/                            # 双击设置密钥工具（Windows）
tests/                               # node --test 离线测试
skill-upload/SKILL.md                # 独立上传技能最终用户说明模板
plugins/atx-assistant/scripts/cli.mjs # 独立技能 CLI 入口
scripts/pack.mjs                     # 从干净 HEAD 生成两个 Release ZIP
tests/artifacts.check.mjs            # 打包后手动运行的真实产物验收
```

## 公开内容

仅提交插件源码、测试、图标和说明。**不要提交 API Key、环境文件、个人 models.json / settings.json、本地压缩包或 .github 目录。** 尚未选择开源许可证，暂为 UNLICENSED。

## 清单维护与新手边界（0.3.0）

- 默认 Windows 新手交付 ATX-skill.zip，上传解压的完整 atx-assistant 文件夹；完整市场插件保留为高级兼容方式。两包共用插件实现，不是独立模型包；不要删除既有 WorkBuddy-Model-Pack。自然语言安装仅为请求，不是已验证保证；禁止引导仅上传旧 SKILL.md。
- `plugins/atx-assistant/server/model-registry.json` 是包内可信单一维护清单，包含推荐聊天候选、默认媒体型号及已确认媒体声明，绝不放 Key。推荐候选聊天和 tools 支持未知，不得声称已实测。
- 初始媒体声明只保留 gpt-image-2 生图及 terra 识图。其他能力要有用户明确确认，不能用名字、目录存在或远端 metadata 推测。用户通过 configure 保存的本机声明优先于默认清单。
- 清单更新只能随插件版本交付；`/models` 刷新仅发现型号，缓存上限 10000，查询分页不写本地模型，不更新推荐。
- 新手先使用 WorkBuddy 原有可用模型调用 onboarding，拿到设置工具绝对路径，私下设置 Key；不自动运行 GUI、不要求编辑 JSON。不保证保存 Key 后全部能力可用。
- Node 主配置兼容读取 ATX_DATA_DIR 旧数据，损坏的可选旧配置不阻断有效主配置。Windows 设置脚本保持原样：保存 Key 和所选线路，对已有聊天模型只同步 Key、不同步线路 URL；插件改 Key/线路不自动写 models.json，换线路后须明确授权 sync 或导入。
- 推荐默认只展示和导入目录可用子集，缺失项返回 skipped。confirmUnverified（兼容 confirmChatSupport）表示知情试用授权，不是能力证明。目录验证不保证能力或余额。
- 保留 `.mcp.json` 的 `bin/run-node` 启动方式，与内置 weixinpay 同类入口一致。Windows 宿主可经 shell 和 PATHEXT 解析 run-node.cmd；此前 0.1 宿主实际 shell 启动成功，不能用直接 spawn 失败断言不支持。离线测试须在真正 ZIP 解压目录使用 spawn shell:true 完成 stdio initialize；这只验证该启动链路，不代替真实宿主兼容性验证。
- 不修改 Windows 设置 ps1/bat，尤其禁止写非 ASCII 路径的此类脚本；测试也不生成此类脚本。
- 所有测试使用离线 mock，不执行真实收费请求，不以测试通过替代上游能力实测。失败不自动重试或换模型。
- 未经用户要求，不安装/更新本机插件、不 stage、不 commit、不打包；以下发布步骤仅供维护者交付时手动执行。

## 手动发布新版

1. 同步修改版本号：`package.json`、`plugins/atx-assistant/.codebuddy-plugin/plugin.json`、`.codebuddy-plugin/marketplace.json`、`server/index.mjs` 的 `VERSION`、README「当前版本」。
2. 运行 `npm test`（离线，不发起收费请求），并检查无敏感信息：`git grep -nE "aitx-[A-Za-z0-9]{16,}"` 应无结果。
3. 由维护者审查并提交全部修改（包括新增测试），确认工作区、索引及未跟踪文件均干净后运行 `npm run pack`。脚本只归档 `HEAD` 树，不读取暂存区内容、不修改索引；不干净时在生成产物前拒绝。需要 Node 20+、git 和 PATH 可用的 python（仅标准库 zipfile）。git archive 先将 HEAD 导出到临时 ZIP，Python 只从该归档重组，不读取未提交工作树；不生成 ps1/bat，只原样携带已有设置脚本。生成 `releases/ATX-workbuddy.zip`、`releases/ATX-skill.zip` 与包含两包 SHA256 的 `releases/SHA256SUMS.txt`。市场 ZIP 顶层仍是市场根目录，包含 README、NOTICE、RELEASING 和完整插件；技能 ZIP 顶层唯一 `atx-assistant/`，SKILL.md 来自 skill-upload 模板，scripts/server/extras/bin 来自插件，不含 MCP 声明、个人配置、Key 或缓存。临时目录完成后清理，不删除既有 releases。打包后运行 `npm run test:artifacts` 验证真实双包结构、HEAD 文件一致性、校验和及解压后 CLI；此命令必须有最终包，常规 `npm test` 不要求包已存在。
4. 经授权后由维护者推送 main，创建 `vX.Y.Z` 标签。
5. 由官方维护者手动创建 GitHub Release，上传两个 ZIP 和 SHA256SUMS.txt。
6. 核对 Release 非草稿、附件可下载后再通知用户。

固定最新版下载地址：
https://github.com/aitransx/atx-workbuddy-plugin/releases/latest/download/ATX-workbuddy.zip

## 验收边界

- 常规测试只验证离线 mock、CLI 和临时 ZIP 启动链路；打包后测试验证最终 HEAD 双包，不代表 WorkBuddy 技能上传 UI、自然语言安装、真实宿主 MCP 或 ATX 收费能力已实测。
- 未提交状态下 pack 应拒绝且不覆盖产物、不改索引。不要为跑通打包绕过干净 HEAD 检查；未授权提交时只报告最终产物验收待维护者提交后执行。
- Node CLI 优先使用 WORKBUDDY_EXTRA_PATHS 的 WorkBuddy 自带 Node，再查 PATH；未找到停止，不下载。Windows 设置脚本固定使用 `%USERPROFILE%/.workbuddy`，不遵循 Node 的 WORKBUDDY_HOME / ATX_DATA_DIR 覆盖；文档必须提示配置目录差异。
- 技能包不带 `.mcp.json` 或插件清单，完整 server 内部模块仍保留供 CLI 复用。不要仅凭缺少 MCP 声明认为依赖可删减。

## 本地开发调试

```
/plugin marketplace add C:\path\to\atx-workbuddy-plugin
/plugin install atx-assistant@aitransx
/reload-plugins
```

修改代码后再次 `/reload-plugins` 即可。
