# Attachment Text Extraction Stage 1B

Stage 1B 在既有 `attachment_text_cache` 流程上增加本地 `docx` 基础正文提取和 PDF 文本层提取。renderer 仍只传 `attachmentId`，Electron main 读取附件元数据并在数据目录 `attachments/` 下安全解析文件，不向 renderer 返回本地路径。

## Supported Inputs

- `.docx`：从 `word/document.xml` 提取基础正文文本。
- `.pdf`：只提取 PDF 文本层，最多 200 页。

DOCX 和 PDF 的结果复用现有缓存表，不新增数据库 schema。缓存只保存提取后的纯文本、状态和源文件元数据，不保存绝对路径、`relativePath`、存储文件名、base64、原始 DOCX/PDF 二进制或 AI prompt。

## DOCX Boundary

DOCX 提取使用 `jszip@3.10.1`，读取 `word/document.xml`，处理基础文本节点和换行：

- `w:t`
- `w:tab`
- `w:br`
- `w:cr`
- `w:p`

第一版不支持：

- `.doc`
- Word 图片 OCR
- 样式还原
- 页眉 / 页脚
- 脚注
- 批注
- 复杂公式完整提取
- 复杂表格和版式完整还原

## PDF Boundary

PDF 提取使用 `pdfjs-dist@4.10.38`，通过 `pdfjs-dist/legacy/build/pdf.mjs` 动态导入，并只调用 `getTextContent()`。

第一版不做：

- 页面渲染。
- 扫描版 PDF OCR。
- PDF 图片内容识别。
- 云端解析。
- Poppler 依赖。
- native canvas 依赖。

如果 PDF 没有可提取文本，用户侧应看到类似提示：

```txt
该 PDF 可能是扫描版，第一版暂不支持扫描 PDF 文本提取。
```

## AI Boundary

Stage 1B 只负责把 DOCX / PDF 文本层内容提取到本地缓存。它不自动发送内容给 AI。

AI 默认不包含附件提取文本。只有用户在 AI 面板明确选择包含附件提取文本时，AI 服务才读取成功缓存的文本。即使选择包含，也不发送：

- 附件原文件。
- DOCX / PDF 原始二进制。
- 本地路径。
- `relativePath`。
- 图片 base64。

## Limits and Packaging

- DOCX / PDF 源文件大小限制：20 MB。
- 缓存文本限制：100000 字符，超过按既有逻辑截断。
- PDF 页数限制：200 页。
- Stage 1B 不需要新增数据库 migration。
- Stage 1B 不需要修改 `electron-builder.yml`、`asarUnpack` 或 `extraResources`。
- `jszip@3.10.1` 是纯 JS 依赖。
- `pdfjs-dist@4.10.38` 是 JS / ESM 依赖，但体积较大，发布前应复查安装包大小。

## Verification

运行：

```bash
npm run verify:extraction-stage1b
```

验证覆盖：

- DOCX 正文文本。
- DOCX 段落换行。
- XML entity 解码。
- `.doc` 不支持。
- PDF 文本层提取。
- 空白 / 无文本 PDF 失败提示。
- DOCX / PDF 大小限制。
- 错误信息脱敏。
- 成功结果写入 `attachment_text_cache`。
