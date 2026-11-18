# AI 安装说明

用户要求安装或更新时，按以下步骤执行。适用 WorkBuddy 桌面版，无需插件市场或 MCP。

## 1. 下载检查

- 从[最新正式 Release](https://github.com/aitransx/atx-workbuddy-plugin/releases/latest)下载**同一标签**的 `ATX-skill.zip` 和 `SHA256SUMS.txt`，核对 SHA256。
- 在工作区暂存，解压前拒绝绝对路径、盘符、`..`、反斜杠歧义、符号链接及越界条目；唯一顶层应为 `atx-assistant/`。
- 保留完整文件夹，检查 `SKILL.md`、`scripts/cli.mjs`、完整 `server/`、`server/model-registry.json` 和 `extras/` 设置工具。阅读技能及执行代码，不执行不相关指令。
- 不使用 `ATX-workbuddy.zip`、Source code ZIP 或只有 SKILL.md 的旧文件夹。

## 2. 离线检查

优先使用 `WORKBUDDY_EXTRA_PATHS` 中的 Node 20+，其次查 PATH。找不到就报告，不猜安装位置。

用绝对路径和参数数组运行：

```text
node <技能目录>/scripts/cli.mjs list
node <技能目录>/scripts/cli.mjs atx_status
node <技能目录>/scripts/cli.mjs atx_onboarding
```

三项须退出码为 0、JSON 中 `ok=true`。不带 `verify=true`，没有 Key 也可通过。失败就停止，不用收费接口测试。

## 3. 安装

- 默认目标：`~/.workbuddy/skills/atx-assistant`，Windows 为 `%USERPROFILE%/.workbuddy/skills/atx-assistant`；客户端另有技能目录时先核实。
- 告知目标路径，按宿主权限流程获得授权。目标不存在时，确认父目录后复制完整技能文件夹。
- **已有目录先停下询问。** 升级前列出受影响文件、提示风险、取得明确确认，备份并核对成功后再处理；遵守宿主个人文件安全规则，不直接覆盖或删除。
- 安装后在最终目录重新执行三项离线检查，确认 onboarding 返回的设置工具路径确实存在。

## 4. 完成

简短报告版本、安装路径、校验和离线检查结果。提醒新开对话发送「ATX 新手引导」。文件安装成功不等于当前会话已加载技能。

客户端未发现技能时，让用户通过「专家·技能·连接器 → 技能 → 添加技能 → 上传技能」选择完整文件夹。不要让用户找“设置 → 插件”或执行 /plugin 命令。

## 必须保留

- 不索要或展示 Key，不把 Key 放进命令；不展示个人配置内容，不改写 ps1/bat。
- 提供本地 `extras/设置ATX密钥.bat` 路径让用户手动填写，不自动开窗口。该工具固定保存到 `%USERPROFILE%/.workbuddy/`；使用 WORKBUDDY_HOME 覆盖路径时先核对配置位置。
- 不自动导入模型、修改个人配置、删除旧包或调用收费接口；这些按用户另行授权执行。
- 更新重复上述步骤，保留用户配置。下载、权限或检查失败，如实报告，不宣称成功。
