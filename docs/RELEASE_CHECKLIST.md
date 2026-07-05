# Release Checklist

本文档用于 MistVault 初版发布前检查。不要把检查失败当作修改业务代码的许可；如果失败，应先记录原因，再单独安排修复。

## 文档与代码状态

- 确认 README 和 docs 没有写未实现能力。
- 确认没有真实 API Key 示例。
- 确认没有暴露本机真实绝对路径，开发缓存建议路径 `E:\develop` 除外。
- 确认 MySQL 只描述为高级预留，默认数据库是 SQLite。
- 确认扫描版 PDF 自动 OCR、Word 图片 OCR、AI 多模态没有写成已支持。

## 轻量验证命令

```bash
npm run typecheck
npm run build
npm run verify:db
npm run verify:ocr-runtime
npm run verify:extraction-stage1a
npm run verify:extraction-stage1b
```

可按问题范围补充运行：

```bash
npm run verify:extraction-text
npm run verify:extraction-cache
npm run verify:extraction-errors
npm run verify:extraction-ocr
```

## 打包验证

```bash
npx electron-builder --dir
npx electron-builder --win
npm run dist
```

检查项：

- `release/win-unpacked` 可以启动。
- installer 可以安装。
- installer 安装后可以启动。
- 未签名安装包的 Windows 安全提示已在文档中说明。
- `better-sqlite3` 在打包后可正常加载。
- OCR runtime 存在于 `process.resourcesPath/ocr/tesseract`。
- `tesseract.exe`、DLL、`chi_sim.traineddata`、`eng.traineddata` 都在包内。

## 功能抽查

- 新建科目 / 章节。
- 新建、编辑、删除、移动错题。
- 添加、打开、预览、移除附件。
- 关键词搜索。
- 关联错题。
- 今日复习推荐。
- 导出 `txt`、`md`、`docx`、`pdf`。
- 图片 OCR：`jpg` / `jpeg` / `png` / `bmp`。
- `txt` / `md` 文本提取。
- `docx` 基础正文提取。
- PDF 文本层提取。
- 扫描版 PDF 提示不支持自动 OCR。

## AI 检查

- 未配置 provider / API Key 时提示清楚。
- 配置 OpenAI-compatible provider 后可以请求讲解。
- Claude / Gemini 当前未支持时提示清楚。
- 默认请求不包含附件提取文本。
- 用户明确选择后，才包含对应范围的附件提取文本。
- 不发送附件原文件、本地路径、`relativePath`、图片 base64。
- API Key 不出现在 renderer、日志、导出内容或错误详情中。

## 数据目录与卸载检查

- 数据库和附件保存在用户本地数据目录。
- 数据不写入安装目录。
- 数据目录迁移不会删除旧目录。
- 卸载后用户错题库和附件仍保留。
- 重新安装后可继续读取原数据目录。
