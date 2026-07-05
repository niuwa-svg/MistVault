# Phase 0 OCR Runtime Verification

本文档记录 MistVault 初版内置 OCR runtime 的资源来源、打包路径和验证方式。

## Runtime Source

- Tesseract runtime: `tesseract-ocr-w64-setup-5.5.0.20241111.exe`
- Source: UB Mannheim / Tesseract GitHub release
- Runtime version verified by `tesseract.exe --version`: `tesseract v5.5.0.20241111`
- Leptonica version: `leptonica-1.85.0`
- 已验证 runtime 报告的图片库包括 `libjpeg`、`libpng`、`libtiff`、`libwebp`、`libopenjp2`、`zlib`。
- 初版实际开放的图片 OCR 类型保持保守：`jpg`、`jpeg`、`png`、`bmp`。
- `webp` 和 `gif` 第一版不作为支持格式。

## Project Layout

```txt
resources/ocr/tesseract/
  tesseract.exe
  *.dll
  runtime-manifest.json
  licenses/
    tesseract_LICENSE.txt
    tessdata_fast_LICENSE.txt
  tessdata/
    chi_sim.traineddata
    eng.traineddata

resources/ocr/fixtures/
  phase0-zh-en.png
```

开发下载 / 缓存可以放在 `E:\develop\mistvault-ocr-runtime-cache`。运行时代码不能依赖 `E:\develop`。

## Packaging

`electron-builder.yml` 通过 `extraResources` 复制 OCR runtime：

```yaml
extraResources:
  - from: resources/ocr/tesseract
    to: ocr/tesseract
```

打包后 runtime 路径：

```txt
process.resourcesPath/ocr/tesseract/
```

`win-unpacked` 中的典型路径：

```txt
release/win-unpacked/resources/ocr/tesseract/
```

用户不需要单独安装 Tesseract，不需要配置系统 `PATH`，也不需要设置 `TESSDATA_PREFIX`。

## Verification

运行：

```bash
npm run verify:ocr-runtime
```

脚本行为：

- 开发环境使用项目内 `resources/ocr/tesseract`。
- 打包环境使用 `process.resourcesPath/ocr/tesseract`。
- 使用 `chi_sim+eng`。
- 不通过系统 `PATH` 查找 Tesseract。
- 不要求用户环境变量。
- 输出中应避免暴露本机绝对路径。

阶段 0 曾验证到一个真实限制：中文样例中 `零` 可能被识别成相近字符。这说明 OCR 结果需要允许用户查看和手动修正，不能声称数学公式、手写字或低清图片可以稳定准确识别。

## Packaging Note

OCR runtime 通过 `extraResources` 打入安装包。当前 Windows 本地测试配置包含：

```yaml
win:
  signAndEditExecutable: false
```

这是本地未签名测试策略，用于避免本机打包时因为签名工具缓存权限导致失败。不代表正式发布签名流程。若后续需要正式签名安装包，应单独恢复签名流程并在具备权限的环境中验证。

## Limits

- 图片 OCR 支持 `jpg`、`jpeg`、`png`、`bmp`。
- OCR 对数学公式、手写字、低清图片可能不准确。
- 扫描版 PDF 第一版不自动走 OCR。
- Word 文档中的图片第一版不做 OCR。
