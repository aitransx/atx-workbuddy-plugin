# ATX 智能体助手 · WorkBuddy 版

**一句话把 ATX 中转的 Claude / GPT / Gemini 加进 WorkBuddy，并在聊天里用 ATX 搜索网页、生成图片、识别图片。**

这是 ATX 在 **WorkBuddy 桌面应用**中的唯一官方接入入口，不再推荐单独模型包。不需要写代码或手动编辑 JSON。

**启动前提（bootstrap）**：先使用 WorkBuddy 原有可用且支持工具调用的模型安装插件并执行配置。安装插件、保存 Key 不会凭空让所有模型具备聊天、tools、生图或识图能力。首次发送「ATX 新手引导」，`atx_onboarding` 会返回设置工具的绝对路径和步骤，不自动运行 GUI，也不会索要 Key。

| 能做什么 | 怎么说 | 收费吗 |
|---|---|---|
| 检查连接 | 检查 ATX 状态 | 免费 |
| 加入聊天模型 | 把 ATX 推荐模型加入 WorkBuddy | 免费（之后用模型聊天按 ATX 计费） |
| 联网搜索 / 读网页 | 用 ATX 搜索… / 用 ATX 读取 https://… | 可能按次收费 |
| 生成图片 | 用 ATX 生成一张… | 收费 |
| 识图 / 提取文字 | 用 ATX 识别这张图片："C:\…\a.png" | 收费 |

## 第一步：安装插件

### 方法 A：让 WorkBuddy 帮你装（最省事）

在 WorkBuddy 对话框发送：

> 请帮我安装 ATX 官方插件：先执行 `/plugin marketplace add aitransx/atx-workbuddy-plugin`，再执行 `/plugin install atx-assistant@aitransx`，最后 `/reload-plugins`。装好后检查 ATX 状态，不要发起收费测试。

### 方法 B：自己输入命令

在 WorkBuddy 对话框**逐行**发送：

```
/plugin marketplace add aitransx/atx-workbuddy-plugin
/plugin install atx-assistant@aitransx
/reload-plugins
```

### 方法 C：下载 ZIP 导入（GitHub 打不开时）

1. [**下载最新版 ATX-workbuddy.zip**](https://github.com/aitransx/atx-workbuddy-plugin/releases/latest/download/ATX-workbuddy.zip)（不要选发布页底部的 “Source code (zip)”）。
2. WorkBuddy → **设置 → 插件 → 添加自定义市场**，选择这个 ZIP。
3. 在插件列表中找到 **ATX 智能体助手**，点击安装 / 启用。

装好后**新开一个对话**，发送：**检查 ATX 状态**。

## 第二步：连接你的 ATX 账号

**安装插件不等于拥有 ATX 账号或额度。** 搜索、生图、识图、模型聊天都使用你自己的 ATX 账户。

### 你之前已经在 WorkBuddy 里配过 ATX 模型

什么都不用做，插件会自动复用 `models.json` 里的 ATX Key。发送「检查 ATX 状态并验证 Key」，看到 `credentialConfigured: true`、`keyCheck: 有效` 就可以了。

### 你还没有 ATX Key

1. 到 [ATX 控制台](https://aitransx.com/zh/login) 注册，创建 API Key（以 `aitx-` 开头），确认有余额。
2. 打开插件目录里的 `extras` 文件夹，双击 **「设置ATX密钥.bat」**，粘贴 Key 后回车。
   - 不知道插件目录在哪？发送「ATX 新手引导」，按 `setKeyTool` 返回的绝对路径手动打开；插件不自动打开文件夹或设置窗口。
   - Key 只保存在本机 `%USERPROFILE%\.workbuddy\atx-assistant\settings.json`，不会上传。
3. 回到 WorkBuddy 发送：**检查 ATX 状态并验证 Key**。

> **不要把 Key 发到聊天、群、GitHub Issue 或截图里。** 如果已经发过，到 ATX 控制台重置一个新的。

## 第三步：加入聊天模型

发送：

> 把 ATX 推荐模型加入 WorkBuddy。

或者指定型号：

> 查看 ATX 有哪些 claude 模型，把 anthropic/claude-sonnet-5.5 加入 WorkBuddy。

完成后**一定要彻底退出 WorkBuddy**（屏幕右下角托盘图标 → 右键 → 退出，只关窗口不算），再重新打开，然后在输入框下方的模型选择里切换到新模型。

仅在你明确要求导入时写 `models.json`，自动备份原文件；同 ID 的 ATX 条目可更新，非 ATX 同 ID 冲突会拒绝整次写入。每次最多 50 个，不要批量导入目录中的 1325 个型号（其中含语音、视频、embedding 等）。

**推荐仅为候选，并未实测聊天或工具调用**。导入前需你明确确认所选型号支持聊天与 tools（`confirmChatSupport=true`）；目录存在不等于支持。图片输入默认关闭，仅明确确认后开启。

更换 Key 或线路后，插件工具下次请求读取新配置，但已导入聊天模型不会自动更新。请明确说「将当前 Key 和线路同步到已有 ATX 聊天模型」，授权 `atx_sync_models(confirm=true)`；它会备份并保留原能力，不添加新型号，然后按提示彻底重启。也可明确重新导入选定型号。

推荐清单：`anthropic/claude-opus-5.5`、`anthropic/claude-sonnet-5.5`、`openai/gpt-6.1-sol`、`google/gemini-4-hydrogen`、`google/gemini-4-carbon`、`google/gemini-4-argon`。

## 第四步：直接在聊天里用

**不用记工具名，但当前聊天模型必须可用且能调用工具；媒体工具可独立选择声明的模型。** 下面每一句都会真实调用 ATX，可能收费，第一次只选一个试。

**联网搜索**

> 用 ATX 搜索最近一周 AI 行业的三条重要消息，简要总结并附来源链接。

**读取网页**

> 用 ATX 读取 https://aitransx.com/zh/docs ，总结主要接口。

**生成图片**（默认 `openai/gpt-image-2`，图片保存在当前工作目录的 `atx-images` 文件夹）

> 用 ATX 生成一张图片：秋天的公园里，一位穿红色外套的成年女性站在金色树下，温暖光线，精致动漫插画。生成一张即可。

**识别图片 / 提取文字**（默认 `openai/gpt-6.1-terra`，当前聊天模型不需要支持图片）

1. 在文件资源管理器里按住 **Shift + 右键** 图片 → **复制文件地址**。
2. 发送：

```
用 ATX 识别这张图片："C:\Users\你的名字\Pictures\screenshot.png"，提取所有可见文字，并解释其中的报错。
```

本地图片支持 PNG / JPEG / WebP，每张最多 4 MiB，一次最多 4 张，公开 HTTPS 链接也可以。

> **调用失败或超时后，先看 ATX 控制台的请求记录，不要马上重复生成**：上游可能已经处理并计费。插件不会自动重试，也不会自动换模型。

## 换模型：直接说，不用改文件

| 想做什么 | 发送 |
|---|---|
| 查看生图 / 识图模型 | 查看 ATX 模型，列出支持识图和生图的型号 |
| 刷新目录 | 刷新 ATX 模型列表，不要做收费测试 |
| 确认新型号能力 | 我确认 openai/gpt-image-2.6-flare 支持生图，请加入 ATX 能力表 |
| 改默认生图模型 | 把 ATX 默认生图模型设为 openai/gpt-image-2.6-flare |
| 移除聊天模型 | 从 WorkBuddy 删除 ATX 的 google/gemini-4-argon |
| 关掉某项功能 | 关闭 ATX 联网搜索 |

新型号不会自动获得聊天、tools、生图或识图声明。包内 `server/model-registry.json` 是唯一维护清单，无 Key，维护推荐候选、默认型号和已确认媒体能力，仅保留原始声明 `openai/gpt-image-2` 生图、`openai/gpt-6.1-terra` 识图；声明不等于收费实测。其他媒体能力必须由你明确确认后通过 `atx_configure` 保存本机覆盖。

清单改动随插件版本发布。`atx_models(refresh=true)` 或 `atx_list_chat_models(refresh=true)` 只刷新 `/models` 发现目录，不自动同步推荐、能力或本地模型。支持 `keyword`、`offset` 和 `limit`（每页 1–200），缓存上限 10000，能分页查看完整 1325 型号目录；查询不推断能力。模型可用性、权限与价格以 ATX 账户为准。

## 遇到问题怎么办？

| 现象 | 下一步 |
|---|---|
| 说找不到 ATX 工具 | 发送 `/reload-plugins`，或重启 WorkBuddy 后新开对话；在设置 → 插件里确认已启用 |
| `credentialConfigured: false` | 回到第二步，双击「设置ATX密钥.bat」 |
| 发现多个不同的 ATX Key | 双击「设置ATX密钥.bat」明确指定一个 |
| 导入后模型列表里看不到 | 从托盘彻底退出再打开 |
| 401 / Key 无效 | 控制台确认 Key 未停用，重新设置 |
| 402 / 429 / 余额或限流 | 到 ATX 控制台检查余额和权限 |
| 模型不存在 / 不支持 | 刷新模型列表，核对完整 ID（如 `openai/gpt-image-2`），不要只填显示名 |
| 超时、网络失败 | 先核对请求记录再决定是否重试 |
| 双击 .bat 被拦截 | 右键 `set-key.ps1` →「使用 PowerShell 运行」 |

还没解决？到 [GitHub Issues](https://github.com/aitransx/atx-workbuddy-plugin/issues) 提交：WorkBuddy 版本、插件版本、做了什么、完整报错或截图。**遮住 API Key 和个人信息。**

## 高级：环境变量

插件按以下顺序查找 Key：环境变量 `AITRANSX_API_KEY` → 「设置ATX密钥」保存的 Key → WorkBuddy `models.json` 中唯一的 ATX Key。接口地址可用 `AITRANSX_BASE_URL` 覆盖，只接受 ATX HTTPS 域名。环境变量仍优先于保存的配置；若设置后看似未变化，请检查环境覆盖。

Node 统一以 `~/.workbuddy/atx-assistant/settings.json` 为主配置（与现有双击工具一致）；`ATX_DATA_DIR/settings.json` 仅兼容已有数据，主配置同字段优先，下一次保存合并到主配置，不删除旧文件。`WORKBUDDY_HOME` 可覆盖主目录（测试/高级用途，现有 Windows 设置脚本仍使用用户主目录）。配置是本机明文文件，请保护访问权限，不提交或分享。

## 更新插件

发送 `/plugin marketplace update aitransx`，再 `/reload-plugins`。ZIP 安装的用户下载新版后重新导入。

## 当前版本与限制

版本 **0.2.0**。本版本仅以离线 mock 测试验证流程，未发起收费实测，不承诺所有型号或 tools 可用。生图每次只取第一张；不保证所有型号都支持参考图或所有尺寸。模型目录在插件运行期间每 24 小时检查一次（免费），可手动刷新。

开发与发布：[RELEASING.md](RELEASING.md) · 标识归属：[NOTICE.md](NOTICE.md) · 接口文档：[ATX 文档](https://aitransx.com/zh/docs)
