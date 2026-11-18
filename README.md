# ATX 智能体助手 · WorkBuddy 版

版本 **0.2.1**。在 WorkBuddy 中接入 ATX 中转模型，并按需搜索、读网页、生图、识图。无需写代码或手动编辑 JSON。

**开始前**：先有一个 WorkBuddy 原有、可用且支持工具调用的聊天模型来完成安装和配置。插件和 Key 不会凭空提供可用模型、账户或余额。

## 1. 安装

在 WorkBuddy 对话框逐行发送：

```
/plugin marketplace add aitransx/atx-workbuddy-plugin
/plugin install atx-assistant@aitransx
/reload-plugins
```

也可从 [GitHub Release 下载 ATX-workbuddy.zip](https://github.com/aitransx/atx-workbuddy-plugin/releases/latest/download/ATX-workbuddy.zip)，在 WorkBuddy「设置 → 插件 → 添加自定义市场」中导入，安装并启用。不要选 “Source code (zip)”。**这个下载链接同样需要能访问 GitHub**；如果打不开，请先解决访问问题，或请可信维护者提供同一发布包并核对 SHA256。

安装后新开对话，发送：

> ATX 新手引导。不要发起收费测试。

## 2. 私下设置 Key

先到 [ATX 控制台](https://aitransx.com/zh/login) 注册或登录，创建以 `aitx-` 开头的 API Key，并确认账户余额与所需模型权限。

引导会返回设置工具的绝对路径；手动双击 `extras/设置ATX密钥.bat`，在本地窗口粘贴 Key。不知道路径就再次请求新手引导，插件不会自动打开窗口。

- 已经配置过 ATX 模型的用户，插件可以复用本机唯一的 ATX Key；多个不同 Key 时需要明确设置一个。
- 设置脚本会保存 Key 和所选线路，但对已有 ATX 聊天模型**只按提示同步 Key，不同步线路 URL**。改线路后，需另行明确要求同步当前 Key 和线路到已有模型。
- 配置是本机明文文件，请保护访问权限。Key 不应公开到聊天、截图、群或 Issue；正常 API 请求会把 Key 发送给 ATX，不是“永不上传”。如果曾公开，请在控制台重置。

然后发送：

> 检查 ATX 状态并验证目录访问，不做收费测试。

目录访问成功只表示当次目录接口可访问，**不保证聊天、工具调用、生图、识图能力，也不保证余额、权限或后续请求成功**。

## 3. 知情试用推荐聊天模型

先发送：

> 查看 ATX 推荐候选中当前目录可用的型号，以及跳过的型号，不要导入。

推荐清单只是未实测候选。看过结果后，如果愿意承担试用风险，再发送：

> 我知道这些推荐候选的聊天和工具调用能力未知、未实测，仍同意把当前目录可用的推荐子集导入 WorkBuddy 试用，跳过缺失型号。不要发起收费测试。

不要求你证明未知能力。导入时会备份 `models.json`，只更新同 ID 的 ATX 条目；非 ATX 同 ID 冲突会拒绝写入。图片输入默认关闭，不自动导入整个目录。

完成后，**从右下角托盘彻底退出 WorkBuddy 再打开**，再切换模型；只关闭窗口不算。若试用模型不能聊天或调用工具，请切回原有可用模型。

## 4. 按需使用（可能收费）

- 「用 ATX 搜索这个技术问题，并附来源。」
- 「用 ATX 生成一张秋日公园插画，只生成一张。」
- 「用 ATX 识别这张图片：`C:/Users/你的名字/Pictures/screenshot.png`，提取报错文字。」

每条都会真实调用 ATX，可能收费。失败或超时后先看 ATX 请求记录，不要立即重复；上游可能已处理并计费。插件不自动重试或换模型。

默认生图 `openai/gpt-image-2`、识图 `openai/gpt-6.1-terra`。这些是保留的原始媒体能力声明，**声明不等于收费实测**；旧推荐同样未实测。当前版本仅用离线 mock 验证流程，不保证上游能力。新增媒体声明需用户明确确认，不能从名称或目录存在推断。

## 更换 Key、线路与更新

插件工具会读取新配置，并在 Key 或线路变化后使旧目录缓存失效；已导入聊天模型不会由插件自动同步。设置脚本只同步 Key。换线路后明确发送：

> 将当前 Key 和线路同步到已有 ATX 聊天模型，我同意备份并更新。

同步不添加型号、不重判能力，完成后按提示彻底重启。环境变量优先于本机配置，若仍用旧设置请检查环境覆盖。

刷新目录只发现型号，不更新推荐、能力声明或本机模型。更新插件可发送 `/plugin marketplace update aitransx`，再 `/reload-plugins`；ZIP 用户重新导入新版。

## 常见问题

| 现象 | 处理 |
|---|---|
| 找不到工具 | 确认启用插件，重新加载或重启后新开对话 |
| 没有 Key / 多个 Key | 按新手引导私下使用设置工具 |
| 导入后找不到模型 | 从托盘彻底退出再打开 |
| 401、余额、限流或权限问题 | 去 ATX 控制台核对 Key、余额、权限及请求记录 |
| 型号缺失 / 能力不支持 | 刷新目录核对完整 ID；目录存在也不保证能力 |
| 设置脚本被拦截 | 核实来源后在同一 extras 目录对 set-key.ps1 使用 PowerShell 运行 |

仍有问题可到 [GitHub Issues](https://github.com/aitransx/atx-workbuddy-plugin/issues) 提交版本、操作及报错，遮住 Key 和个人信息。

## 高级配置

Key 优先级：`AITRANSX_API_KEY` → 主配置 Key → `models.json` 中唯一 ATX Key。`AITRANSX_BASE_URL` 可覆盖线路，仅接受无 userinfo、query、fragment 的 ATX HTTPS 域名，自动去掉末尾 `/chat/completions`。

主配置为 `~/.workbuddy/atx-assistant/settings.json`，兼容 `ATX_DATA_DIR/settings.json` 旧数据，主配置同字段优先，损坏的可选旧文件不阻断有效主配置。`WORKBUDDY_HOME` 可覆盖 Node 主目录，但现有 Windows 设置脚本仍使用用户主目录。

开发与发布：[RELEASING.md](RELEASING.md) · 标识归属：[NOTICE.md](NOTICE.md)
