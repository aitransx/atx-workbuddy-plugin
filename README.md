# ATX · WorkBuddy 技能

在 WorkBuddy 中使用 ATX 中转模型、搜索、读网页、生图和识图。

## 安装

打开 WorkBuddy 的 Agent 模式，发送：

> 帮我安装这个仓库的 ATX 技能，按 INSTALL.md 操作：https://github.com/aitransx/atx-workbuddy-plugin

AI 会下载、检查并安装技能。遇到旧版先确认，安装时不做收费测试。

也可[下载 ATX-skill.zip](https://github.com/aitransx/atx-workbuddy-plugin/releases/latest/download/ATX-skill.zip)，解压后通过「专家·技能·连接器 → 技能 → 添加技能 → 上传技能」选择完整的 `atx-assistant` 文件夹。

## 设置 Key

安装后新开对话，发送：

> ATX 新手引导

到 [ATX 控制台](https://aitransx.com/zh/login) 创建 API Key，按引导打开本地设置工具填写。**不要把 Key 发到聊天里。**

## 使用

直接告诉 WorkBuddy：

- 查看 ATX 推荐聊天模型。
- 把这些模型加入 WorkBuddy 试用。
- 用 ATX 生成一张秋日公园插画。
- 用 ATX 生成一张落叶飘动的 GIF 动图（可能收费，仅执行一次）。
- 用 ATX 识别这张图片：图片路径。
- 用 ATX 搜索这个问题，并附来源。

导入聊天模型后，从托盘彻底退出 WorkBuddy 再打开，然后切换模型。

## 更新

> 按仓库 INSTALL.md 帮我更新 ATX 技能，保留现有配置。

模型推荐由官方更新服务维护；发送「检查 ATX 模型更新」查看计划，明确选择并确认后才应用，不后台通知、不自动改配置。

更换 Key 或线路后，可发送「将当前 Key 和线路同步到已有 ATX 模型，我同意备份并更新」。

## 注意

- 先用 WorkBuddy 原有可用模型完成安装配置。
- API 调用可能收费；失败后先看 ATX 请求记录，不要反复重试。
- Key 本机明文保存，调用时发送给 ATX，请勿公开。
- 当前通过离线测试；自动安装全流程及真实模型能力尚未全面实测。模型目录存在不代表能力可用。

[AI 安装步骤](INSTALL.md) · [发布说明](RELEASING.md) · [问题反馈](https://github.com/aitransx/atx-workbuddy-plugin/issues)
