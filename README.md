# MistVault

MistVault 是面向考研复习的 Windows 本地错题本软件。它支持科目 / 章节管理、错题管理、附件、关键词搜索、OCR / 文档文本提取、AI 讲解、导出分享和本地复习推荐。

核心错题功能默认在本地可用。错题、附件和 SQLite 数据库保存在用户本地数据目录，不保存在安装目录。AI 讲解是可选在线能力，需要用户自行配置第三方 provider 和 API Key。

## 当前状态

当前项目处于初版收口 / 发布候选阶段。已完成的主要能力包括：

- Electron + React + TypeScript + Vite 主框架。
- SQLite / better-sqlite3 本地数据库与数据目录。
- 科目 / 章节树，错题新增、编辑、删除、移动。
- 附件保存、打开、预览、移除。
- 关键词 tag、关键词搜索、关联错题。
- `txt` / `md` / `docx` / `pdf` 导出。
- 设置模块、数据目录迁移入口、本地复习推荐。
- OpenAI-compatible provider 的 AI 讲解。
- 内置 Tesseract OCR runtime。
- 附件文本提取 UI：查看、编辑、保存、复制、重新提取、清除。
- 图片 OCR，`txt` / `md` 文本提取，`docx` 基础正文提取，PDF 文本层提取。

仍需注意：高级 OCR、数学公式精准识别、扫描版 PDF 自动 OCR、AI 多模态、云同步、账号系统和正式 MySQL 运行时切换都不是当前初版能力。

## 核心功能

- 科目 / 章节树：创建、重命名、移动和删除本地节点。
- 错题管理：新增、编辑、删除、移动错题，支持题目、解析、笔记等字段。
- 关键词 tag：每道错题至少包含一个文本关键词。
- 附件管理：为题目、解析、笔记添加本地附件，支持打开、预览和移除。
- 关键词搜索：按当前节点范围或全库范围搜索关键词。
- 关联错题：建立错题之间的本地关联。
- 导出分享：导出 `txt`、`md`、`docx`、`pdf` 学习材料。
- OCR / 文档文本提取：提取附件文本，用户可手动修正缓存结果。
- AI 讲解：可选发送当前错题文本给用户配置的第三方 provider。
- 复习推荐：本地艾宾浩斯风格的今日复习列表。
- 设置与数据目录管理：主题、导出默认值、AI 配置、数据目录迁移等。

## 本地数据与隐私

- 错题、附件、数据库默认保存在本地数据目录。
- 用户数据不保存在安装目录。
- 卸载应用默认不删除用户错题库。
- 核心错题功能无需账号。
- OCR 默认使用内置本地 runtime，不需要单独安装 Tesseract。
- AI 讲解需要用户配置第三方 provider、Base URL、模型和 API Key。
- AI 默认只发送当前错题文本上下文。
- AI 默认不发送附件提取文本。
- 只有用户明确选择包含附件提取文本时，才会发送对应的已提取文本给 AI。
- 不发送附件原文件、图片 base64、本地绝对路径或数据目录路径给 AI。
- API Key 不应写入日志、导出内容、示例文档或公开截图。

## 附件与文本提取能力

| 类型 | 当前能力 | 说明 |
|---|---|---|
| 图片 | `jpg` / `jpeg` / `png` / `bmp` 支持 OCR | 对数学公式、手写字、低清图片可能不准确。 |
| 文本 | `txt` / `md` 支持文本提取 | 支持常见文本编码和缓存。 |
| Word | `docx` 支持基础正文提取 | `.doc` 不支持；复杂公式、图片、批注、脚注、页眉页脚等可能不完整。 |
| PDF | 支持文本层提取 | 扫描版 PDF 第一版不支持自动 OCR，PDF 图片内容不会被自动识别。 |
| 其他附件 | 可保存 / 打开 | 不一定支持文本提取。 |

提取结果会写入本地 `attachment_text_cache`，用户可以在界面中查看、编辑、保存、复制、重新提取或清除。

## AI 讲解能力

MistVault 第一版 AI 讲解使用 OpenAI-compatible Chat Completions 风格接口。当前支持的 provider 以应用设置页和代码实现为准，第一版包括 OpenAI-compatible 的 OpenAI、DeepSeek、Qwen、Kimi、Doubao；Claude / Gemini 当前不作为原生 adapter 支持。

AI 请求边界：

- 默认只使用当前错题文本。
- 可选附带用户明确选择范围内的附件提取文本。
- 不上传附件原文件。
- 不上传本地路径、数据库路径、图片 base64 或整个错题库。
- AI 回答仅供学习参考，不应替代教材、老师或权威答案。

更多说明见 [docs/AI_USAGE.md](docs/AI_USAGE.md) 和 [docs/AI_PROVIDER_CONFIG.md](docs/AI_PROVIDER_CONFIG.md)。

## 导出能力

当前支持导出：

- `txt`
- `md`
- `docx`
- `pdf`

导出内容面向复习材料阅读，默认会生成主文档，并按需要复制可用附件到导出目录的 assets 子目录。缺失附件会被记录，不应导致整次导出全部失败。

## 安装与运行

普通用户使用 Windows installer 安装。初版本地测试安装包可能未签名，Windows SmartScreen 可能提示未知发布者。

开发运行前需要先安装依赖。本阶段文档更新不会执行安装命令。

```bash
npm install
npm run dev
```

在 Windows 上，依赖安装成功后，也可以双击：

```txt
start-dev.bat
```

## 开发环境

主要技术栈：

- Electron
- React
- TypeScript
- Vite / electron-vite
- SQLite
- better-sqlite3
- electron-builder

Renderer 只能通过 preload 暴露的 `window.mistVault` API 访问能力，不直接访问 `fs`、`path`、`electron`、SQLite 或 main 模块。

## 常用命令

以下命令以当前 `package.json` 为准：

```bash
npm run dev
npm run rebuild:native
npm run typecheck
npm run build
npm run verify:db
npm run verify:ocr-runtime
npm run verify:extraction-stage1a
npm run verify:extraction-stage1b
npm run verify:extraction-text
npm run verify:extraction-cache
npm run verify:extraction-errors
npm run verify:extraction-ocr
npm run dist
npx electron-builder --dir
npx electron-builder --win
```

说明：

- `npm run dev` 会先执行 `rebuild:native`，再启动 `electron-vite dev`。
- `better-sqlite3` 是 native module，开发和打包后都需要验证。
- 文档修改不需要运行打包命令。

## Windows 打包说明

Windows installer 使用 `electron-builder`。

当前 `electron-builder.yml` 会通过 `extraResources` 将 OCR runtime 打入安装包：

```yaml
extraResources:
  - from: resources/ocr/tesseract
    to: ocr/tesseract
```

打包后 OCR runtime 位于：

```txt
process.resourcesPath/ocr/tesseract
```

当前配置包含：

```yaml
win:
  signAndEditExecutable: false
```

这表示本地未签名测试策略，不代表正式签名流程。发布前仍需验证 installer、`win-unpacked`、OCR runtime、`better-sqlite3` native module 和卸载后用户数据保留。

更多说明见 [docs/PACKAGING_WINDOWS.md](docs/PACKAGING_WINDOWS.md)。

## 数据目录说明

MistVault 数据目录默认包含：

```txt
MistVault data directory/
  mistakes.db
  mistakes.db-wal
  mistakes.db-shm
  attachments/
  exports/
  backups/
  config.json
```

数据库、附件、导出和备份都属于用户数据。应用卸载默认不删除这些内容。迁移数据目录时，应用会复制已知数据项，不会主动删除旧目录。

## 已知限制

- OCR 不保证数学公式准确。
- OCR 不保证手写字准确。
- OCR 不保证低清图片准确。
- 扫描版 PDF 第一版不支持自动 OCR。
- PDF 只支持文本层提取。
- docx 复杂格式提取可能不完整。
- Word 图片内容不会被 OCR。
- AI 回答仅供学习参考。
- AI 需要联网和第三方 API Key，可能产生 provider 费用。
- 未签名安装包可能出现 Windows 安全提示。
- MySQL 是高级预留配置，默认运行时仍是 SQLite。

完整列表见 [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md)。

## 故障排查入口

常见问题见 [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)，包括：

- 启动白屏。
- `better_sqlite3.node` 文件锁或 EPERM。
- OCR 找不到 `tesseract.exe` 或语言包。
- 图片 OCR 不准。
- PDF 提取为空。
- AI 配置失败。
- 导出 PDF 失败。
- Windows 未知发布者提示。
- 数据目录查找、保留和迁移。

## 项目结构

```txt
src/main      Electron main，数据库、文件、OCR、文档提取、AI 请求、导出
src/preload   安全桥，只暴露 window.mistVault
src/renderer  React UI
src/shared    共享类型与 IPC 契约
resources     OCR runtime 等随包资源
scripts       验证脚本
docs          项目文档
release       electron-builder 输出目录
```

## 第三方组件与许可说明

项目使用 Electron、React、TypeScript、Vite、SQLite、better-sqlite3、electron-builder、Tesseract OCR runtime、jszip、pdfjs-dist、docx 等第三方组件。发布前应检查第三方 license 文件和随包资源许可说明，尤其是 OCR runtime 与语言包。
