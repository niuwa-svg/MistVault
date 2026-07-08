# MistVault v0.2 RapidOCR Integration Notes

日期：2026-07-08

## 本阶段范围

本阶段只接入 Electron main 侧 OCR 引擎抽象、RapidOCR helper 调用骨架，以及 `rapidocr -> tesseract` fallback 策略。仓库不提交 RapidOCR runtime、模型、exe、DLL、venv、PoC 样本或输出文件。

当前 `attachment_text_cache` 仍只保存最终提取文本、状态和安全错误信息；不新增 `ocr_engine`、confidence、blocks 等字段，也不新增 migration。

## 资源布局约定

开发态 RapidOCR 资源位置：

```text
resources/ocr/rapidocr/rapidocr-helper.exe
resources/ocr/rapidocr/runtime/
resources/ocr/rapidocr/models/
resources/ocr/rapidocr/runtime-manifest.json
resources/ocr/rapidocr/licenses/
```

打包态 RapidOCR 资源位置：

```text
process.resourcesPath/ocr/rapidocr/rapidocr-helper.exe
process.resourcesPath/ocr/rapidocr/runtime/
process.resourcesPath/ocr/rapidocr/models/
process.resourcesPath/ocr/rapidocr/runtime-manifest.json
process.resourcesPath/ocr/rapidocr/licenses/
```

本阶段 `RapidOcrEngine.isAvailable()` 只要求 helper、`runtime/`、`models/` 存在。`runtime-manifest.json` 用于读取诊断版本号，不作为可用性的硬门槛。

## Fallback 策略

OCR registry 固定优先级为：

```text
rapidocr -> tesseract
```

RapidOCR helper 或 runtime 缺失时不报错给用户，直接走 Tesseract。RapidOCR 可用但识别失败、超时、退出码非 0、stdout 为空、stdout 不是 JSON，或 helper 返回 `ok:false` 时，也回退到 Tesseract。

如果 Tesseract 也失败，则沿用现有附件文本提取错误状态和中文错误码，不影响错题 CRUD、附件打开、AI 会话或文本类附件提取。

## 安全边界

- renderer 仍只传 `attachmentId`，不传本地绝对路径。
- 附件绝对路径只在 main 内部解析，并继续做 attachments 目录边界校验。
- OCR 子进程错误必须脱敏，不返回完整本地路径、系统用户名、helper/model/runtime 内部路径、`storedName`、`relativePath` 或堆栈。
- OCR 图片内容不会发送给 AI，也不会联网。
- engine、blocks、confidence 目前只作为内部结果参与 fallback 判断，不持久化到数据库。

## 后续工作

正式放入 RapidOCR runtime 时，应单独处理 helper/exe、models、licenses、打包资源复制、体积压缩、杀软误报和离线验证。后续如需展示引擎版本或置信度，应通过单独 migration 设计，不在本阶段混入 schema 变更。
