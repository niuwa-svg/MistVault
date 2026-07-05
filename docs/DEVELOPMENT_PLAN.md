# Development Plan

本文档记录 MistVault 当前开发阶段和后续方向。当前状态以初版收口 / 发布候选为准，不把后续调研能力写成已完成能力。

## 当前阶段

MistVault 已从早期骨架进入初版收口 / 发布候选阶段。当前已完成：

- Electron + React + TypeScript + Vite 主框架。
- SQLite 本地数据库、迁移机制、数据目录初始化。
- 科目 / 章节树。
- 错题新增、查看、编辑、删除、移动。
- 附件保存、打开、预览、移除。
- 关键词 tag、关键词搜索、关联错题。
- `txt` / `md` / `docx` / `pdf` 导出。
- 设置模块与数据目录迁移入口。
- 本地艾宾浩斯风格复习推荐。
- OpenAI-compatible provider 的 AI 讲解初版。
- AI 输出格式优化：普通中文和纯文本公式风格，避免默认输出大量 LaTeX 符号。
- OCR runtime 内置与验证。
- 附件文本提取 Stage 1A：`txt` / `md` 提取，`jpg` / `jpeg` / `png` / `bmp` OCR。
- 附件文本提取 UI：查看、编辑、保存、复制、重新提取、清除。
- AI 可选包含附件提取文本。
- 附件文本提取 Stage 1B：`docx` 基础正文提取，PDF 文本层提取。
- Windows 初版打包链路曾经跑通过。

## 已完成阶段

### Phase 1: Skeleton

- 初始化 Electron / React / TypeScript / Vite 项目结构。
- 建立 main / preload / renderer / shared 分层。
- 暴露安全的 `window.mistVault` preload API。
- 建立统一 `ApiResult<T>` IPC 返回结构。
- 初始化本地数据目录骨架。

### Phase 2: Core Data

- 建立 SQLite schema 和 migration 机制。
- 实现 node、mistake、keyword、attachment、settings、review state 等本地数据模型。
- 保留 MySQL adapter / 配置类型作为高级预留，但默认运行时仍是 SQLite。
- renderer 不直接访问 SQLite、文件系统或 Electron main 能力。

### Phase 3: Core UI

- 实现科目 / 章节树创建、重命名、移动和受保护删除。
- 实现错题列表、详情、新增、编辑、删除、移动。
- 支持题目、解析、笔记字段附件。
- 附件通过 main 进程安全复制到用户数据目录，renderer 不接触源文件绝对路径。

### Phase 4: Search, Export, Settings

- 实现按关键词和节点范围搜索。
- 实现 `txt`、`md`、`docx`、`pdf` 导出。
- 导出会把可用附件复制到导出目录，并记录缺失附件。
- 实现主题、默认导出格式、默认导出目录、附件导出偏好、备份偏好、AI 配置、数据库高级设置等设置项。
- 实现安全的数据目录迁移入口：复制已知数据项，写入下次启动指针，不热切换当前 SQLite 连接，不删除旧目录。

### Phase 5: Optional Extensions

- AI 讲解初版已完成：支持 OpenAI-compatible provider，非流式返回中文讲解。
- Claude / Gemini 当前未作为原生 adapter 支持。
- AI 默认只发送当前错题文本上下文；只有用户明确选择时，才会附带已提取的附件文本。
- AI 不发送附件原文件、图片 base64、本地路径、整个错题库或无关错题。
- OCR runtime 已内置到 Windows 包资源中，不依赖系统 PATH 或用户单独安装 Tesseract。
- 附件文本提取已支持 `txt` / `md`、图片 OCR、`docx` 基础正文、PDF 文本层。
- 提取失败隔离在附件文本提取功能内，不影响错题 CRUD、附件打开、搜索、导出、设置、复习推荐或 AI 面板基本可用性。

## 当前收口重点

- README 和 docs 与当前实现保持一致。
- 发布前轻量验证：typecheck、build、数据库验证、OCR runtime 验证、Stage 1A / 1B 提取验证。
- 打包后验证 `better-sqlite3` native module、OCR runtime、`win-unpacked` 启动、installer 安装和卸载后数据保留。
- 明确所有用户可见限制，避免把后续能力写成当前能力。

## 后续调研方向

以下能力不是当前初版已完成能力：

- 高级 OCR。
- 数学公式精准识别。
- 手写内容高质量识别。
- 扫描版 PDF 自动 OCR。
- Word 图片 OCR。
- AI 多模态附件输入。
- AI 流式输出、多轮对话、持久化 AI 回答。
- 云同步和账号系统。
- MySQL 正式运行时切换。
- 更完善的安装包签名流程。

这些方向需要单独设计、验证和发布计划，不能在当前文档中描述为已支持。
