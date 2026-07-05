# Windows Packaging

本文档记录 MistVault 初版 Windows 打包注意事项。打包不是普通文档更新阶段需要执行的动作。

## Packaging Tool

Windows installer 使用 `electron-builder`。当前 `package.json` 中相关命令：

```bash
npm run build
npm run dist
npx electron-builder --dir
npx electron-builder --win
```

`npm run dist` 会先执行：

```bash
npm run build
```

再运行 `electron-builder`。

## Preflight

打包前建议运行：

```bash
npm run typecheck
npm run build
npm run verify:db
npm run verify:ocr-runtime
npm run verify:extraction-stage1a
npm run verify:extraction-stage1b
```

`better-sqlite3` 是 native module，开发环境启动和数据库验证可能需要：

```bash
npm run rebuild:native
```

## OCR Runtime

OCR runtime 通过 `electron-builder.yml` 的 `extraResources` 打入安装包：

```yaml
extraResources:
  - from: resources/ocr/tesseract
    to: ocr/tesseract
```

打包后路径：

```txt
process.resourcesPath/ocr/tesseract
```

`win-unpacked` 中常见路径：

```txt
release/win-unpacked/resources/ocr/tesseract
```

发布前检查：

- `tesseract.exe`
- 必要 DLL
- `tessdata/chi_sim.traineddata`
- `tessdata/eng.traineddata`
- runtime license 文件

用户不需要单独安装 Tesseract，不需要配置系统 `PATH`。

## better-sqlite3

`better-sqlite3` 是 native dependency。打包后必须验证：

- 应用能启动。
- SQLite 能打开 `mistakes.db`。
- 数据库 migration 能正常运行。
- 错题列表、创建、编辑、删除可用。
- 没有 `better_sqlite3.node` 缺失、ABI 不匹配或文件锁错误。

当前文档不要求修改 `asarUnpack`。如果后续打包验证发现 native module 加载问题，应单独评估配置改动。

## Signing

当前 `electron-builder.yml` 包含：

```yaml
win:
  signAndEditExecutable: false
```

这是本地未签名测试策略，用于让初版本地打包更可控。不代表正式签名流程。未签名 installer 可能触发 Windows SmartScreen 或未知发布者提示。

正式发布如果需要签名，应单独恢复和验证签名流程。

## Cache Location

开发和打包缓存建议放在非系统盘，例如：

```txt
E:\develop
```

运行时代码不能依赖该路径。文档中除开发缓存建议外，不应暴露开发机真实绝对路径。

## Artifacts

当前输出目录：

```txt
release/
```

需要检查：

- `release/win-unpacked/`
- installer 文件。
- 安装后的应用启动。
- 卸载后用户数据保留。

## win-unpacked Verification

检查流程：

- 启动 `release/win-unpacked` 中的应用。
- 创建或读取本地错题。
- 打开设置页确认数据目录。
- 验证图片 OCR。
- 验证 `txt` / `md` / `docx` / PDF 文本层提取。
- 验证导出 `txt` / `md` / `docx` / `pdf`。
- 验证 AI 未配置时提示清楚。

## Installer Verification

检查流程：

- 安装 installer。
- 启动应用。
- 确认用户数据目录不是安装目录。
- 创建错题和附件。
- 卸载应用。
- 确认用户数据目录仍保留。
- 重新安装后确认能继续读取原数据。
