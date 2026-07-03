# MistVault Project Handoff

## 1. 当前技术栈

- Electron + React + TypeScript + Vite / electron-vite
- Windows 本地桌面应用
- SQLite：`better-sqlite3`
- React 18
- 文档导出：`docx`
- 打包预留：`electron-builder`
- 本地数据目录默认使用 Electron `app.getPath("userData")`

当前主要脚本：

```bash
npm install
npm run dev
npm run typecheck
npm run build
npm run verify:db
```

Windows 简化启动方式：

```txt
start-dev.bat
```

## 2. 已完成模块

- 第一阶段主框架骨架
- 本地数据目录初始化
- SQLite 数据库初始化与迁移骨架
- 科目/章节树模块
- 错题 CRUD 模块
- 附件模块
- 关键词搜索模块
- 导出分享模块
- preload 安全 IPC 桥
- AI / OCR / 复习推荐 noop 占位状态接口

## 3. 已完成模块主要功能

### 主框架

- Electron main / preload / renderer / shared 分层已建立。
- renderer 通过 `window.mistVault` 调用 main 能力。
- renderer 不直接访问 Node.js、文件系统、数据库或 Electron API。
- 三栏 UI 已存在：
  - 左侧：科目/章节树
  - 中间：错题列表与搜索
  - 右侧：错题详情、编辑、附件、链接、导出入口

### 本地数据与数据库

- 初始化数据目录：
  - `mistakes.db`
  - `attachments/`
  - `exports/`
  - `backups/`
  - `config.json`
- SQLite schema 已有核心表。
- migration 机制已有 `schema_migrations` 和 `version 1: create_core_schema`。
- `verify:db` 可验证数据库初始化。

### 科目/章节树

- 支持创建根节点与子节点。
- 支持树形读取。
- 支持重命名、移动、删除。
- 有循环移动保护、删除保护等基础校验。
- 错题可挂载在具体节点下。

### 错题 CRUD 与附件

- 支持新增、查看、编辑、删除错题。
- 支持移动错题到其他节点。
- 支持关键词保存。
- 支持错题之间链接 / 取消链接 / 查看链接。
- 支持选择本地文件作为 staged attachment。
- 支持将附件绑定到错题字段。
- 支持附件列表、删除、系统打开。
- 图片预览已有基础支持。
- 附件本体保存在数据目录 `attachments/`，数据库只保存元数据与相对路径。

### 关键词搜索

- 支持按关键词模糊搜索。
- 支持 `OR` / `AND` 匹配。
- 支持全局搜索与节点范围搜索。
- 节点范围搜索会包含该节点及其子节点。
- 搜索结果包含所属路径。

### 导出分享

- 支持导出当前错题或当前已加载列表。
- 支持格式：
  - `txt`
  - `md`
  - `docx`
  - `pdf`
- 当前只支持 folder package，`zip` 是明确 unsupported placeholder。
- 导出会创建独立文件夹。
- 主文档写入文字内容。
- 附件复制到导出目录 `assets/`。
- 原始附件不会被移动、删除或破坏。
- 缺失附件不会导致整个导出失败，会记录到 `missingAttachments`。
- 导出目录选择通过 main 进程 Electron dialog 完成。
- 打开导出目录通过 main 进程 `shell.openPath` 完成。

## 4. 当前项目目录结构概要

```txt
MistVault/
  docs/
    SPEC.md
    ARCHITECTURE.md
    MODULE_BOUNDARIES.md
    DATA_MODEL.md
    DEVELOPMENT_PLAN.md
    HANDOFF.md

  scripts/
    verify-db.mjs

  src/
    main/
      db/
        adapters/
        migrations/
        index.ts
        schema.ts
      export/
        exporters/
        export.service.ts
        types.ts
        index.ts
      extensions/
        ai/
        ocr/
        review/
      ipc/
      repositories/
      services/
      storage/
      index.ts

    preload/
      api.ts
      index.ts

    renderer/
      components/
      layouts/
      services/
      styles/
      App.tsx
      main.tsx
      index.html

    shared/
      types/
        api.ts
        domain.ts
        global.d.ts
        ipc.ts
        index.ts

  electron-builder.yml
  electron.vite.config.ts
  vite.config.ts
  tsconfig*.json
  package.json
  start-dev.bat
```

## 5. main / preload / renderer / shared 分层规则

### main

负责所有本地能力：

- 文件系统
- 数据库
- 附件保存与打开
- 导出
- 系统 dialog
- `shell.openPath`
- 数据目录初始化
- 服务与 repository 编排

main 入口：

```txt
src/main/index.ts
```

### preload

只暴露白名单 API：

```txt
src/preload/api.ts
src/preload/index.ts
```

规则：

- 使用 `contextBridge.exposeInMainWorld("mistVault", mistVaultApi)`
- 可以使用 `ipcRenderer.invoke`
- 不允许暴露原始 `ipcRenderer`
- 不允许把通用 Node 能力透传给 renderer

### renderer

负责 UI 和用户交互：

```txt
src/renderer/
```

规则：

- 不直接导入 `fs`
- 不直接导入 `path`
- 不直接导入 `electron`
- 不直接导入 `better-sqlite3`
- 只能通过 `window.mistVault` 调用本地能力

### shared

只放共享类型、API 类型、IPC channel 常量：

```txt
src/shared/types/
```

不能依赖 main-only 或 renderer-only 实现。

## 6. 当前已有的 window.mistVault API

所有 API 都应返回统一结构：

```ts
type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } };
```

当前 API：

```ts
window.mistVault.app.getVersion()

window.mistVault.settings.getBasicInfo()

window.mistVault.storage.getDataDirectoryInfo()

window.mistVault.database.getStatus()

window.mistVault.nodes.listTree()
window.mistVault.nodes.create(input)
window.mistVault.nodes.rename(id, name)
window.mistVault.nodes.move(id, targetParentId)
window.mistVault.nodes.delete(id)
window.mistVault.nodes.getPath(id)

window.mistVault.mistakes.listByNode(nodeId)
window.mistVault.mistakes.get(id)
window.mistVault.mistakes.create(input)
window.mistVault.mistakes.update(id, input)
window.mistVault.mistakes.delete(id)
window.mistVault.mistakes.move(id, targetNodeId)
window.mistVault.mistakes.link(sourceId, targetId)
window.mistVault.mistakes.unlink(sourceId, targetId)
window.mistVault.mistakes.listLinks(id)
window.mistVault.mistakes.search(input)

window.mistVault.attachments.chooseFiles()
window.mistVault.attachments.addToMistake(mistakeId, field, tokens)
window.mistVault.attachments.listByMistake(mistakeId)
window.mistVault.attachments.open(attachmentId)
window.mistVault.attachments.remove(attachmentId)
window.mistVault.attachments.getPreview(attachmentId)

window.mistVault.export.chooseDirectory()
window.mistVault.export.exportMistakes(input)
window.mistVault.export.openExportDirectory(directory)

window.mistVault.extensions.ai.getStatus()
window.mistVault.extensions.ocr.getStatus()
window.mistVault.extensions.review.getStatus()
```

## 7. 当前数据库表和数据模型概要

当前 schema 在：

```txt
src/main/db/schema.ts
```

已有表：

- `nodes`
  - 科目/章节树节点
  - `id`, `parent_id`, `name`, `sort_order`, `created_at`, `updated_at`, `deleted_at`

- `mistakes`
  - 错题主体
  - `id`, `node_id`, `question`, `answer_analysis`, `note`, `created_at`, `updated_at`, `deleted_at`

- `keywords`
  - 关键词字典
  - `id`, `name`, `created_at`
  - `name` 使用 `COLLATE NOCASE UNIQUE`

- `mistake_keywords`
  - 错题与关键词多对多关系

- `attachments`
  - 附件元数据
  - `id`, `mistake_id`, `field`, `original_name`, `stored_name`, `mime_type`, `ext`, `relative_path`, `size`, `hash`, `created_at`, `deleted_at`
  - 附件本体不入库

- `mistake_links`
  - 错题之间的链接关系
  - `source_mistake_id`, `target_mistake_id`, `created_at`

- `settings`
  - key-value JSON 设置
  - 当前已有默认项：theme、databaseType、aiProvider、reviewRecommendationEnabled、defaultExportPath、defaultExportFormat、autoBackupEnabled、backupDirectory

- `review_states`
  - 复习状态基础表
  - 当前还不是完整复习推荐算法

- `schema_migrations`
  - migration 版本记录

共享类型在：

```txt
src/shared/types/domain.ts
```

核心类型包括：

- `NodeItem`
- `Keyword`
- `Attachment`
- `Mistake`
- `SearchMistakesInput`
- `SearchMistakeResult`
- `ExportMistakesInput`
- `ExportMistakesResult`
- `Settings`
- `DatabaseStatus`
- `DataDirectoryInfo`
- `ExtensionStatus`

## 8. 当前已有文档及其作用

```txt
docs/SPEC.md
```

记录产品需求与阶段目标。

```txt
docs/ARCHITECTURE.md
```

记录 Electron main / preload / renderer / shared 架构原则。

```txt
docs/MODULE_BOUNDARIES.md
```

记录模块边界，说明核心模块与扩展模块如何隔离。

```txt
docs/DATA_MODEL.md
```

记录数据目录、SQLite 表、核心数据模型。

```txt
docs/DEVELOPMENT_PLAN.md
```

记录阶段化开发计划和后续模块顺序。

```txt
docs/HANDOFF.md
```

当前交接总结，供新对话快速接手。

注意：`README.md` 当前仍偏第一阶段骨架描述，已经落后于实际实现状态，后续应更新。

## 9. 当前仍然是 placeholder 的模块

- AI 讲解
  - 当前只有 noop status。
  - 没有真实 provider。
  - 没有 API Key 管理完整实现。
  - 没有真实网络请求。

- OCR / 文档解析
  - 当前只有 noop status。
  - 没有 OCR。
  - 没有 PDF/docx/txt 自动解析。
  - 不会自动填充错题内容。

- 艾宾浩斯复习推荐
  - 当前有 `review_states` 基础表和 `ReviewService` 的状态读写能力。
  - 当前 extension status 仍是 noop。
  - 没有完整推荐算法。
  - 没有完整首页推荐流。

- MySQL
  - 类型和 adapter 边界存在。
  - 当前不是可用高级数据库功能。
  - 不应宣传为已完成。

- 数据目录迁移
  - 设置需求中预留。
  - 当前未实现完整迁移流程。

- ZIP 导出
  - 类型中有 `zip`。
  - 当前导出服务明确返回 `EXPORT_PACKAGE_MODE_UNSUPPORTED`。

## 10. 明确尚未实现的功能

- 账号系统：按需求本来就不需要。
- 数据上传 / 云同步：按需求不实现。
- 真实 AI 讲解请求。
- AI provider 配置 UI 的完整保存与调用。
- API Key 安全存储策略。
- OCR 图片识别。
- PDF / docx 文本提取。
- 附件内容自动识别并填充字段。
- 完整艾宾浩斯推荐算法。
- 首页今日复习完整工作流。
- 复习完成标记的完整 UI 流程。
- 数据目录迁移。
- MySQL 真实连接与切换。
- ZIP 打包导出。
- 完整 Windows 安装包发布验证。
- 自动备份完整策略。
- 设置页完整功能。
- 大规模数据性能优化。
- 自动化测试体系。

## 11. 当前已知风险或技术债

- `README.md` 内容落后，仍写着很多模块未实现，和实际状态不一致。
- `better-sqlite3` 是 native dependency：
  - `npm run dev` 会执行 `electron-rebuild`。
  - 用 Node 脚本直接测服务层时可能需要 `npm rebuild better-sqlite3`，之后再跑 `npm run dev` 让 Electron ABI 恢复。
- PDF 导出依赖 Electron `BrowserWindow.printToPDF`，纯 Node 环境不能直接测。
- 当前缺少正式测试框架，之前测试多为临时集成脚本和手动运行命令。
- 设置模块还比较薄，很多设置项只有默认读取，没有完整 UI/保存/校验。
- 复习相关已有部分 repository/service，但 extension 层仍是 noop，容易被误解为“已完成推荐”。
- MySQL 类型存在，但不应在 UI 或文档中暗示已经可用。
- 导出当前支持 folder，不支持 zip。
- PowerShell 可能显示 UTF-8 中文乱码，但实际源码是 UTF-8。
- C 盘空间有限，后续不要把模型、OCR 引擎、大 SDK、大工具默认塞到 C 盘。

### Windows PowerShell 编码注意事项

项目源码和文档按 UTF-8 读写。Windows PowerShell 旧版控制台默认输出编码可能不是 UTF-8，因此直接用 `Get-Content`、构建日志或脚本输出查看中文时，可能出现 `锛`、`闄`、`缂` 等乱码。这通常是终端显示问题，不代表文件内容已经损坏。

新对话接手时如果看到中文乱码，应先用 UTF-8 方式确认原文，例如：

```bash
node -e "console.log(require('fs').readFileSync('src/renderer/components/ExportDialog.tsx','utf8'))"
```

也可以在 PowerShell 会话中临时切换输出编码：

```powershell
chcp 65001
$OutputEncoding = [System.Text.UTF8Encoding]::new()
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
```

确认规则：如果 Node 按 `utf8` 读取正常，优先判断为 PowerShell 显示编码问题，不要因此修改源码里的中文。

## 12. 后续开发新模块必须遵守的边界

- renderer 不得直接访问：
  - `fs`
  - `path`
  - `electron`
  - `better-sqlite3`
  - 数据库连接
  - 本地文件系统能力

- 所有本地能力必须在 main：
  - 数据库
  - 文件读写
  - 附件复制/打开
  - 导出
  - OCR 本地引擎调用
  - 系统 dialog
  - shell 打开文件

- preload 只能暴露白名单 API：
  - 不暴露原始 `ipcRenderer`
  - 不暴露任意 channel 调用器
  - 新 API 必须先加 shared 类型，再加 preload 映射，再加 main IPC handler

- 所有 IPC 返回统一 `ApiResult<T>`。

- 扩展模块失败不能影响核心错题本：
  - AI 失败只影响 AI 面板
  - OCR 失败只影响识别结果
  - 推荐失败只影响推荐入口
  - 导出失败不能破坏原附件和数据库

- 附件原则：
  - 数据库只存元数据和相对路径
  - 原始附件不可被导出、OCR、解析流程移动或删除
  - OCR/解析结果不能自动覆盖用户手写内容

- 数据原则：
  - 用户数据不放安装目录
  - 默认不随卸载删除
  - 路径不要硬编码
  - API Key 不写死在代码里

- 新模块应优先放入明确边界：
  - main service
  - repository
  - ipc
  - preload API
  - shared types
  - renderer component/page

## 13. 环境要求

- C 盘容量有限。
- 除 Node.js、Git 等基础工具或必须安装到 C 盘的工具外，额外工具优先放在：

```txt
E:\develop
```

包括但不限于：

- SDK
- 数据库工具
- OCR 引擎
- 本地模型文件
- 打包工具
- 大型二进制依赖
- 临时资源库

依赖管理原则：

- 项目运行依赖写入 `package.json`。
- 不随意全局安装。
- 不随意把大文件写入仓库。
- 不把模型文件、OCR 数据包、安装器产物提交进源码目录。
- 如必须引入大工具，先说明原因、安装位置和清理方案。

## 14. 下一步建议开发模块

推荐顺序：

1. 更新 README 和 docs，让文档状态与当前实现一致。
2. 设置模块：
   - 设置页 UI
   - 主题切换
   - 默认导出格式/路径
   - 自动备份开关占位
   - AI provider 配置入口占位
3. 自动备份模块：
   - 只备份数据库和附件元数据/目录结构
   - 不影响正常 CRUD
4. 复习推荐模块：
   - 从简单间隔策略开始
   - 首页显示今日推荐
   - 支持标记已复习
   - 可关闭
5. OCR 扩展入口：
   - 先做 txt 提取或图片 OCR noop-to-real 的最小垂直切片
   - 识别结果只作为建议，不覆盖用户内容
6. AI provider 接口：
   - 先完善 provider 抽象和设置保存
   - 再实现单一 provider
   - 最后扩展多 provider
7. 打包发布验证：
   - electron-builder Windows 安装包
   - 验证用户数据目录不在安装目录
   - 验证卸载不删除用户数据

## 15. 新对话接手应先阅读哪些文件

优先阅读：

```txt
package.json
README.md
docs/SPEC.md
docs/ARCHITECTURE.md
docs/MODULE_BOUNDARIES.md
docs/DATA_MODEL.md
docs/DEVELOPMENT_PLAN.md
docs/HANDOFF.md
src/shared/types/api.ts
src/shared/types/domain.ts
src/shared/types/ipc.ts
src/shared/types/global.d.ts
src/main/index.ts
src/preload/api.ts
src/preload/index.ts
src/main/db/schema.ts
src/main/db/migrations/index.ts
src/main/services/index.ts
src/main/ipc/index.ts
```

如果接手具体模块，再读：

```txt
src/main/services/node.service.ts
src/main/services/mistake.service.ts
src/main/services/attachment.service.ts
src/main/export/export.service.ts
src/main/repositories/
src/main/ipc/
src/renderer/App.tsx
src/renderer/components/
src/renderer/services/mistVaultApi.ts
```

接手前建议先运行：

```bash
npm run typecheck
npm run verify:db
npm run build
npm run dev
```

并做 renderer 权限扫描：

```bash
rg 'from "fs"|from "path"|from "electron"|from "better-sqlite3"|require\(' src/renderer
```
