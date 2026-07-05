# Troubleshooting

本文档记录 MistVault 初版常见问题。优先保护用户数据；不要通过删除数据库、清空 release 或重装依赖来掩盖问题。

## 启动白屏怎么办

- 先确认是否是开发环境还是打包后环境。
- 开发环境可查看终端和 DevTools 错误。
- 打包后先确认 `out/` 是否由当前代码构建生成。
- 如果只改了 Markdown 文档，通常不需要重新 build。

## `better_sqlite3.node` 文件锁 / EPERM 怎么办

- 先关闭正在运行的 MistVault / Electron 进程。
- 确认没有杀毒软件或编辑器占用 native module。
- 开发环境可重新运行：

```bash
npm run rebuild:native
```

- 不要删除用户数据目录中的 `mistakes.db`。

## OCR 找不到 `tesseract.exe` 怎么办

- 开发环境检查 `resources/ocr/tesseract/tesseract.exe`。
- 打包环境检查 `process.resourcesPath/ocr/tesseract/tesseract.exe`。
- 确认 `electron-builder.yml` 中存在：

```yaml
extraResources:
  - from: resources/ocr/tesseract
    to: ocr/tesseract
```

- 用户不需要单独安装 Tesseract，也不需要配置系统 `PATH`。

## OCR 找不到 `chi_sim` / `eng` 语言包怎么办

- 检查：

```txt
resources/ocr/tesseract/tessdata/chi_sim.traineddata
resources/ocr/tesseract/tessdata/eng.traineddata
```

- 打包后检查：

```txt
process.resourcesPath/ocr/tesseract/tessdata/
```

## 图片 OCR 识别不准怎么办

- 确认图片格式是 `jpg`、`jpeg`、`png`、`bmp`。
- 尽量使用清晰、正向、背景简单的图片。
- 数学公式、手写字、低清图片可能不准确。
- 使用界面中的编辑功能修正提取文本后再用于学习或 AI。

## PDF 提取为空怎么办

- MistVault 第一版只支持 PDF 文本层提取。
- 如果 PDF 是扫描版或图片型 PDF，提取结果可能为空。
- 第一版不支持扫描版 PDF 自动 OCR。
- 可先用其他工具转成可复制文本的 PDF，或手动整理成 `txt` / `md`。

## 扫描版 PDF 为什么不支持

扫描版 PDF 通常只有页面图片，没有可直接提取的文本层。MistVault 初版没有实现 PDF 页面渲染加 OCR 的流程，因此不会自动识别扫描版 PDF。

## AI 未配置怎么办

- 打开设置页。
- 启用 AI 配置。
- 选择 OpenAI-compatible provider。
- 填写 Base URL、Model、API Key。
- 保存后重新发起讲解。

## AI Key 配置后仍失败怎么办

- 检查 Base URL 是否是 provider 的 API base。
- 检查 Model 是否是该账号可用的官方模型 ID。
- 检查 API Key 权限、余额、区域和服务开通状态。
- 检查网络连接。
- Claude / Gemini 当前未作为原生 adapter 支持。

## 导出 PDF 失败怎么办

- 先尝试导出 `txt` 或 `md`，确认错题数据本身可读。
- 检查默认导出目录或用户选择目录是否可写。
- 检查附件是否被外部程序占用。
- 如果 PDF 中包含图片附件，确认图片文件存在且格式受支持。

## Windows 提示未知发布者怎么办

初版本地测试安装包可能未签名。Windows SmartScreen 或未知发布者提示属于未签名安装包的常见现象，不代表用户数据会被删除。正式发布签名流程需要单独处理。

## C 盘缓存占用过大怎么办

- 用户数据目录、安装目录、打包输出目录和开发缓存可能分别位于不同位置。
- 开发缓存建议放在 `E:\develop` 这类非系统盘路径。
- 不要手动删除用户数据目录中的 `mistakes.db`、`attachments/`、`exports/`、`backups/`。

## 数据目录在哪里

应用内设置页应显示当前数据目录。典型数据目录包含：

```txt
mistakes.db
attachments/
exports/
backups/
config.json
```

用户数据不保存在安装目录。卸载默认不删除错题库。

## 卸载后怎么保留 / 迁移数据

- 默认卸载不会删除用户错题库。
- 迁移前先关闭应用。
- 使用应用内数据目录迁移入口优先于手动复制。
- 手动备份时至少保留 `mistakes.db`、SQLite WAL/SHM 文件、`attachments/`、`exports/`、`backups/`、`config.json`。
