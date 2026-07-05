# Data Model

MistVault 默认使用 SQLite 作为本地数据库。数据库文件名为 `mistakes.db`，位于用户本地数据目录，不位于安装目录。

## Local Data Directory

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

附件文件保存在 `attachments/` 下。数据库只保存附件元数据和相对路径。导出默认写入 `exports/`，也可以写入用户通过系统对话框选择的目录。

数据目录迁移的下次启动指针保存在 Electron `app.getPath("userData")` 下的 `mistvault-app-settings.json`，它是应用级配置，不作为被迁移的数据目录内容。

## SQLite Tables

- `schema_migrations`：已执行 migration 版本。
- `nodes`：科目 / 章节树，支持软删除。
- `mistakes`：错题记录，支持软删除。
- `keywords`：唯一关键词。
- `mistake_keywords`：错题和关键词多对多关系。
- `attachments`：附件元数据、相对路径、大小、hash 和软删除状态。
- `mistake_links`：错题关联关系。字段名保留 source / target，但服务层按无向关系处理。
- `settings`：本地设置，JSON text。
- `review_states`：本地复习推荐状态。
- `attachment_text_cache`：附件提取文本缓存。

## Mistakes, Keywords, And Attachments

- `mistakes.question` 仍为 `TEXT NOT NULL`。
- 错题必须有题目文本，或至少一个保存成功的 `question` 附件。
- 如果只有题目附件，没有题目文本，`mistakes.question` 写入 `[题目见附件]` 作为兼容占位。
- 关键词是文本 tag，不是内容字段，不能挂附件。
- 错题列表和关键词搜索都排除软删除节点和软删除错题。
- 虚拟根节点覆盖所有非删除节点下的错题；真实节点范围包含该节点和非删除子孙节点。

附件保存规则：

- `attachments.original_name` 只作为展示元数据。
- `attachments.stored_name` 使用 UUID 和安全扩展名生成。
- `attachments.relative_path` 形如 `attachments/<storedName>`。
- renderer 不接收附件绝对路径或 `relativePath`。
- 新附件 `field` 限制为 `question`、`answerAnalysis`、`note`。
- 旧 `general` 行保留兼容，可读可显示。
- 移除附件只软删除元数据，不删除用户原文件，也不物理删除已复制文件。

附件选择使用 main 进程短期 token。token 到源路径的映射只存在于 main 内存中，过期或复制后失效。

## Attachment Text Cache

`attachment_text_cache` 按 `attachment_id` 关联附件，保存提取后的纯文本、提取状态、错误码 / 错误信息、源文件大小 / hash、提取时间、编辑时间和用户编辑状态。

该表不保存：

- 本地绝对路径。
- `attachments.relative_path`。
- 存储文件名。
- 原始文件二进制。
- 图片 base64。
- PDF / Word 原始二进制。
- AI prompt payload。

当前已接入的提取能力：

- `txt` / `md`：文本提取。
- `jpg` / `jpeg` / `png` / `bmp`：通过内置 Tesseract OCR。
- `docx`：基础正文文本提取。
- `pdf`：文本层提取。

当前不支持：

- `.doc`。
- `webp` / `gif` OCR。
- 扫描版 PDF 自动 OCR。
- PDF 图片内容识别。
- Word 图片 OCR。
- Word 复杂公式、批注、脚注、页眉页脚完整提取。

AI 默认不读取 `attachment_text_cache`。只有用户在 AI 面板明确选择包含附件提取文本时，AI 服务才读取成功缓存的文本，并且仍不发送原文件、路径或 base64。

## Export Output

导出模块读取 `mistakes`、`keywords`、`mistake_keywords`、`nodes`、`attachments`、`mistake_links` 等现有数据，不改变 schema。

- 主文档生成 `mistakes.txt`、`mistakes.md`、`mistakes.docx` 或 `mistakes.pdf`。
- 可用附件复制到导出目录的 assets 子目录。
- 附件源文件由 main 根据数据库相对路径解析，renderer 不接收真实路径。
- 缺失附件记录在主文档中，不让整次导出全部失败。
- 当前列表 / 搜索导出使用 UI 已加载的错题 ID，不代表数据库全量搜索导出。

## Nodes Table

`nodes` 保存科目 / 章节树：

- `parent_id = null` 表示根科目。
- 子章节通过 `parent_id` 指向父节点。
- UI 中可见的 MistVault root 是虚拟根，不写入数据库。
- `sort_order` 预留给稳定排序或后续拖拽排序。
- `deleted_at` 用于软删除。

删除和移动由服务层保护：

- 有子节点的节点不能直接删除。
- 有非删除错题的节点不能删除。
- 移动到虚拟根写作 `parent_id = null`。
- 节点不能移动到自身或子孙节点下。

## Settings Values

`settings` 保存本地偏好，包括主题、默认导出格式、默认导出目录、默认是否包含附件、备份目录、AI provider 配置、数据库高级设置、OCR / 提取 / 复习推荐相关设置。

AI API Key 和 MySQL 密码只在写入时接收。renderer 读取设置时只得到是否已配置，不得到明文值。第一版 secret 本地保存是临时方案，后续可迁移到 Electron `safeStorage` 或系统凭据存储。

数据目录迁移会复制 `mistakes.db`、SQLite WAL/SHM 文件、`attachments/`、`exports/`、`backups/`、`config.json` 等已知数据项。缺失的可选目录会创建或跳过。旧目录不会被设置模块删除。

## Review States

`review_states` 按 `mistake_id` 关联错题，用于本地复习推荐，不改变核心 `mistakes` 表。

- `review_count`：已完成复习次数。
- `next_review_at`：下次应复习时间。
- `last_reviewed_at`：上次完成复习时间。
- `enabled`：该错题是否参与推荐。
- `updated_at`：维护和排序时间。

新错题会 best-effort 创建 review state。失败不阻止错题保存。今日复习 API 会为已有非删除错题懒修复缺失状态。

## Advanced Database Option

MySQL 保留在 adapter 和配置类型之后，属于高级预留项。默认数据库始终是 SQLite。即使设置中存在 MySQL 配置，也不表示当前正式切换到 MySQL 运行。

## Access Rule

Electron main 进程中的 repository 和 service 是数据库唯一入口。renderer 不访问 SQLite、文件系统路径或 Node API。
