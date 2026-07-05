# AI Usage

MistVault 第一版 AI 讲解是可选在线能力。核心错题功能本地可用，不依赖 AI。

## 配置要求

使用 AI 讲解前，用户需要在设置页配置：

- Provider。
- Base URL。
- Model。
- API Key。
- 是否启用 AI 配置。

第一版使用 OpenAI-compatible Chat Completions 风格接口。OpenAI、DeepSeek、Qwen、Kimi、Doubao 这类兼容 provider 以当前应用实现为准。Claude / Gemini 第一版未作为原生 adapter 支持，不能写成已支持。

Provider 配置示例见 `AI_PROVIDER_CONFIG.md`。

## 默认发送内容

默认情况下，AI 请求只包含当前错题文本上下文，例如：

- 题目。
- 关键词。
- 答案 / 解析。
- 笔记。
- 所在科目 / 章节路径。

AI 默认不发送附件提取文本。

## 附件提取文本

当附件已经完成文本提取后，用户可以在 AI 面板明确选择是否包含附件提取文本。只有用户选择后，MistVault 才会读取对应范围内成功缓存的提取文本并发送给 AI。

当前可提取的附件文本来源包括：

- `txt` / `md`。
- `jpg` / `jpeg` / `png` / `bmp` OCR。
- `docx` 基础正文。
- PDF 文本层。

即使用户选择包含附件提取文本，也不会发送：

- 附件原文件。
- 图片 base64。
- DOCX / PDF 原始二进制。
- 本地绝对路径。
- `relativePath`。
- 数据目录路径。
- 整个错题库。

## API Key 安全

- API Key 只应在设置页输入。
- renderer 读取设置时只能看到是否已配置，不能读取明文 Key。
- 错误信息、日志、导出内容和截图中不应出现真实 API Key。
- 文档示例不能包含真实 API Key。
- 第一版本地保存 secret 是临时方案，后续可迁移到 Electron `safeStorage` 或系统凭据存储。

## 使用限制

- AI 需要联网。
- 第三方 provider 可能计费。
- provider 可能因为余额、权限、区域、模型名称或限流导致失败。
- AI 回答仅供学习参考，不保证完全正确。
- 当前不支持 AI 多模态附件输入。
- 当前不持久化 AI 回答，不自动写回错题笔记。

## 常见失败原因

- API Key 未配置。
- Base URL 填写错误。
- Model 不是 provider 官方可用模型 ID。
- provider 账户无权限或余额不足。
- 网络不可用。
- 当前选择了第一版不支持的 provider。
