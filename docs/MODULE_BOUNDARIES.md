# Module Boundaries

本文档定义 MistVault 初版模块边界。核心原则是：renderer 保持 UI 层，main 负责本地能力，preload 只暴露白名单 API；AI、OCR、文档提取和复习推荐都必须失败隔离，不能影响核心错题功能。

## Core Modules

- `src/main`：拥有窗口、IPC、SQLite、文件、附件、OCR runtime、文档提取、AI 请求、导出和数据目录。
- `src/preload`：只暴露 `window.mistVault`，不暴露任意 Node / Electron 能力。
- `src/renderer`：只做 React UI 和用户交互，不导入 `fs`、`path`、`electron`、SQLite driver 或 main 模块。
- `src/shared`：保存纯类型、IPC channel 和跨层契约。

所有 IPC 返回值使用统一的 `ApiResult<T>` 结构。

## Forbidden Coupling

- renderer 不访问本地文件系统。
- renderer 不打开 SQLite，不读取数据库文件。
- renderer 不读取 API Key、MySQL 密码或用户本地绝对路径。
- main 不把附件源路径、存储路径、`relativePath`、数据目录路径、OCR 命令行返回给 renderer。
- extension 模块失败不能阻止主界面、错题 CRUD、附件打开、搜索、导出、设置或复习推荐加载。
- 任何模块都不能硬编码真实 API Key 或开发机绝对路径。`E:\develop` 只能作为文档里的开发缓存建议路径出现。

## Storage Boundary

main 进程管理用户数据目录。默认数据位于本地用户数据目录，不在安装目录中。

- SQLite 数据库：`mistakes.db`。
- 附件文件：`attachments/`。
- 导出文件：`exports/` 或用户选择目录。
- 备份文件：`backups/`。
- 数据目录迁移只复制已知数据项，写入下次启动指针，不热切换当前 SQLite 连接，不删除旧目录。

MySQL 是高级预留配置。默认运行时仍是 SQLite，不应在文档或 UI 中暗示 MySQL 已正式启用。

## Subject / Chapter Boundary

科目 / 章节树只负责节点组织：

- 根科目和子章节创建。
- 节点重命名、移动、受保护软删除。
- 当前选中节点和节点路径显示。

节点模块不负责错题 CRUD、附件、搜索、导出、AI、OCR、文档提取或复习推荐。节点删除必须保守：有子节点或非删除错题的节点不能直接删除。

## Mistake CRUD Boundary

错题模块负责本地错题生命周期：

- 按当前节点和非删除子孙节点列出错题。
- 新增、查看、编辑、软删除、移动错题。
- 管理关键词 tag。
- 管理简单的错题关联。
- 创建错题时可 best-effort 初始化 `review_states`。

错题模块不负责 OCR、文档提取、AI 请求、导出文件写入、数据目录迁移或复杂复习算法。可选模块失败不能回滚或阻塞核心错题保存。

## Attachment Boundary

附件模块负责本地附件选择、复制、元数据、预览、打开和软删除。

- renderer 只接收 staged token 和展示元数据，不接收源文件绝对路径。
- main 在内存中保存 token 到源路径的短期映射，复制后消费 token。
- 附件复制到用户数据目录下的 `attachments/`。
- 数据库只保存附件元数据和相对路径。
- 新附件字段限制为 `question`、`answerAnalysis`、`note`；旧 `general` 数据可读。
- 移除附件只软删除元数据，不删除用户原文件，也不物理删除已复制文件。

附件模块本身不解析文本、不运行 OCR、不调用 AI。

## Attachment Text Extraction Boundary

附件文本提取由 main 进程服务负责，通过 `window.mistVault.extensions.extraction` 暴露：

- `getStatus(attachmentId)`
- `extractAttachmentText(attachmentId)`
- `getExtractedText(attachmentId)`
- `updateExtractedText(attachmentId, text)`
- `clearExtractedText(attachmentId)`

renderer 只能传 `attachmentId` 和用户编辑后的纯文本。main 解析数据库中的 `relativePath`，校验文件位于数据目录 `attachments/` 下，并且不向 renderer 返回：

- 绝对路径。
- `relativePath`。
- 存储文件名。
- 原始文件二进制。
- 图片 base64。
- OCR 命令行。

当前提取能力：

- `txt` / `md` 文本提取。
- `jpg` / `jpeg` / `png` / `bmp` 使用内置 Tesseract OCR。
- `docx` 基础正文提取。
- PDF 文本层提取。

当前不支持：

- `.doc`。
- 扫描版 PDF 自动 OCR。
- Word 图片 OCR。
- 复杂 Word 版式完整还原。
- 数学公式精准识别。

提取结果写入 `attachment_text_cache`。用户可以编辑缓存文本。提取失败只影响对应附件的提取状态，不影响核心错题功能。

## AI Explanation Boundary

AI 讲解模块只负责当前错题的按需文本讲解：

- 在 Electron main 内读取 AI 设置和 API Key。
- 通过 main 服务读取当前错题、节点路径、附件展示元数据和用户选择范围内的附件提取文本。
- 调用 OpenAI-compatible provider。
- 返回一次性中文回答，不实现流式输出或多轮对话。
- Claude / Gemini 第一版返回未支持，不作为原生 adapter。

默认 AI 请求只包含当前错题文本上下文。只有用户明确选择 `attachmentTextScope` 时，才读取并发送成功缓存的附件提取文本。

AI 模块不得发送：

- 附件原文件。
- 图片 data URL 或 base64。
- 本地绝对路径、数据目录路径、`relativePath`、存储文件名。
- 整个错题库或无关错题。
- API Key 给 renderer、日志或导出内容。

AI 模块不得自动运行 OCR、自动解析附件、持久化 AI 回答、写回错题笔记、安装 SDK、修改 schema 或创建 migration。AI 失败只影响 AI 面板。

## Export Boundary

导出模块只负责本地导出：

- 导出选中错题、当前列表或当前搜索结果。
- 支持 `txt`、`md`、`docx`、`pdf`。
- 在用户选择目录或数据目录 `exports/` 下创建不覆盖的导出目录。
- 复制可用附件到导出目录的 assets 子目录。
- 缺失附件写入导出说明，不让整次导出全部失败。

导出模块不修改原始错题，不移动或删除原附件，不运行 OCR，不调用 AI，不迁移数据目录，不实现复习推荐。

## Keyword Search Boundary

关键词搜索模块只负责本地关键词关系查询：

- 虚拟根节点搜索所有非删除错题。
- 真实节点搜索该节点和非删除子孙节点下的错题。
- 通过 `keywords` 和 `mistake_keywords` 查询。
- 返回供 renderer 展示的简要结果和节点路径。

当前搜索不包含全文搜索、附件 OCR 文本搜索或 AI 语义搜索。

## Review Recommendation Boundary

复习推荐模块是本地可选扩展，只负责今日复习建议：

- 使用 `review_states`。
- 读取复习推荐开关和每日数量设置。
- 查询到期错题。
- 标记完成复习并更新下一次复习时间。

复习推荐不调用 AI、不运行 OCR、不解析附件、不导出内容、不修改错题 schema。

## Settings Boundary

设置模块负责本地偏好：

- 主题。
- 默认导出格式、目录和附件包含策略。
- 备份偏好。
- 数据目录迁移。
- SQLite 默认数据库设置和 MySQL 高级预留配置。
- AI provider 配置。
- OCR / 提取 / 复习推荐相关偏好。

AI API Key 和 MySQL 密码只能作为设置输入写入。读取 API 只返回是否已配置，不返回明文值。第一版本地保存 secret 是临时方案，后续可迁移到 Electron `safeStorage` 或系统凭据存储。
