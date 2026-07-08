# MistVault v0.2 本地 RapidOCR PoC 报告

日期：2026-07-08  
范围：仅验证 Windows 本地 OCR PoC，不接入 MistVault 主线功能。

## 结论

- 已创建独立 PoC 目录：`E:\develop\mistvault-ocr-poc`。
- RapidOCR + ONNX Runtime CPU 能在 Windows 本地运行，首次模型就绪后可离线识别。
- 推荐后续正式接入采用“RapidOCR Python helper/exe + Electron main 子进程调用”，不建议 v0.2 直接用 `onnxruntime-node` 自研完整 OCR 流水线。
- Tesseract 应继续保留为 fallback。RapidOCR 失败、超时或资源缺失时，不应影响错题 CRUD、附件打开、AI 会话等核心功能。
- MistVault 仓库未新增运行依赖，未改 schema，未改主线 OCR/AI/附件/设置代码。

## 环境与安装

PoC 目录结构：

```text
E:\develop\mistvault-ocr-poc
  README.md
  requirements.txt
  rapidocr_cli.py
  node-call-demo.mjs
  samples/
  scripts/
    generate_samples.py
    run_benchmark.py
  outputs/
```

安装命令：

```powershell
py -3.12 -m venv E:\develop\mistvault-ocr-poc\.venv
$env:PIP_CACHE_DIR='E:\develop\mistvault-ocr-poc\pip-cache'
E:\develop\mistvault-ocr-poc\.venv\Scripts\python.exe -m pip install --upgrade pip
E:\develop\mistvault-ocr-poc\.venv\Scripts\python.exe -m pip install -r E:\develop\mistvault-ocr-poc\requirements.txt
```

实际 Python / Node 版本：

- Python：`3.12.10`
- Node：`v24.14.1`
- npm：`11.11.0`

实际 Python 包：

- `rapidocr==3.9.1`
- `onnxruntime==1.27.0`
- `pillow==11.3.0`
- 主要传递依赖：`opencv-python==5.0.0.93`、`numpy==2.5.1`、`pyclipper==1.4.0`、`Shapely==2.1.2`、`omegaconf==2.3.1`、`requests==2.34.2`

本次未安装任何全局 npm 包，未修改系统环境变量，未新增 MistVault 项目依赖。

## 现有 MistVault OCR 依据

当前主线 OCR 仍为 Tesseract：

- `AttachmentTextExtractionService` 通过 Electron main 的 `child_process.spawn` 调用 `tesseract.exe`。
- OCR 超时为 30 秒，调用时设置 `windowsHide: true`。
- Tesseract 路径由 `OcrRuntimeService` 解析：开发态为 `resources/ocr/tesseract`，打包态为 `process.resourcesPath\ocr\tesseract`。
- OCR 子进程使用 scoped env，不依赖系统 PATH 或系统 Tesseract。
- 错误信息会脱敏本地路径，并且 OCR 失败只影响附件提取状态。
- `attachment_text_cache` 当前没有 `ocr_engine`、`ocr_engine_version`、`ocr_confidence`、`ocr_orientation` 字段。

本 PoC 没有修改上述主线实现。

## PoC 验证

样本来源：

- `samples/01_clear_chinese.png`：生成的清晰中文题目截图。
- `samples/02_english_numbers.png`：生成的英文 + 数字样本。
- `samples/03_math_symbols.png`：生成的数学符号/公式样本。
- `samples/04_408_cs_text.png`：生成的 408 / 计算机专业课风格文本。
- `samples/05_phone_skew.png`：生成的手机拍照略歪样本。
- `samples/06_low_contrast_blur.png`：生成的低对比度 / 轻微模糊样本。
- `samples/07_mistvault_public_fixture.png`：复制自项目公开 fixture `resources/ocr/fixtures/phase0-zh-en.png`。

PoC 命令：

```powershell
E:\develop\mistvault-ocr-poc\.venv\Scripts\python.exe E:\develop\mistvault-ocr-poc\scripts\generate_samples.py
E:\develop\mistvault-ocr-poc\.venv\Scripts\python.exe E:\develop\mistvault-ocr-poc\rapidocr_cli.py --image E:\develop\mistvault-ocr-poc\samples\01_clear_chinese.png
E:\develop\mistvault-ocr-poc\.venv\Scripts\python.exe E:\develop\mistvault-ocr-poc\scripts\run_benchmark.py
node E:\develop\mistvault-ocr-poc\node-call-demo.mjs E:\develop\mistvault-ocr-poc\samples\01_clear_chinese.png
```

JSON 输出格式已验证：

```json
{
  "ok": true,
  "engine": "rapidocr",
  "engineVersion": "3.9.1",
  "elapsedMs": 2913,
  "text": "清晰中文题目截图\n已知函数f(x)=x^2-3x+2，求f(4)的值。\n请写出因式分解过程，并说明零点含义。",
  "blocks": [
    {
      "text": "清晰中文题目截图",
      "confidence": 0.99965,
      "box": [[50, 54], [391, 56], [391, 104], [50, 102]]
    }
  ],
  "warning": null,
  "errorCode": null
}
```

失败输出已验证：

```json
{
  "ok": false,
  "engine": "rapidocr",
  "engineVersion": "3.9.1",
  "elapsedMs": 0,
  "text": "",
  "blocks": [],
  "warning": null,
  "errorCode": "OCR_INPUT_INVALID",
  "message": "Input image does not exist."
}
```

注意：Node 调 Python helper 时必须设置 `PYTHONIOENCODING=utf-8`，否则 Windows 默认代码页可能导致中文 JSON 乱码。PoC 的 `node-call-demo.mjs` 已加入该环境项。

## 速度与体积

7 个样本各运行 3 次，全部成功。

| 样本 | 成功次数 | 首次耗时 | 平均耗时 | 效果摘要 |
| --- | ---: | ---: | ---: | --- |
| 清晰中文 | 3/3 | 2715 ms | 2873.0 ms | 中文题目基本准确，函数和数字保留良好 |
| 英文 + 数字 | 3/3 | 3300 ms | 3044.0 ms | 英文、IP、百分比和 ns 单位准确 |
| 数学符号 | 3/3 | 2873 ms | 2805.3 ms | `∑`、条件概率、上下标文本化可识别，但公式结构不是数学语义解析 |
| 408 文本 | 3/3 | 3080 ms | 3279.7 ms | 操作系统、数据结构、网络术语识别良好 |
| 手机略歪 | 3/3 | 3162 ms | 3060.0 ms | 轻微倾斜仍可用，`4KB` 等短数字单位可识别 |
| 低对比/模糊 | 3/3 | 3136 ms | 2964.0 ms | 轻微模糊仍能识别主要文本，但应保留人工校对 |
| 项目公开 fixture | 3/3 | 2645 ms | 2621.7 ms | 中英文混合和数字识别良好 |

体积统计：

| 项目 | 体积 |
| --- | ---: |
| PoC 根目录总计 | 388.40 MB |
| venv | 279.53 MB |
| site-packages | 277.95 MB |
| RapidOCR 包 | 31.54 MB |
| RapidOCR 模型 | 30.28 MB |
| ONNX Runtime 包 | 41.55 MB |
| pip-cache | 108.53 MB |
| samples | 0.28 MB |
| outputs | 0.04 MB |

本次 RapidOCR 模型文件位于 venv 的 `Lib\site-packages\rapidocr\models`，未写入 MistVault 仓库。首次运行日志显示模型文件已存在且校验有效，未观察到运行时下载大模型。

离线模拟：

- 设置 `HTTP_PROXY=http://127.0.0.1:9`、`HTTPS_PROXY=http://127.0.0.1:9` 后，`02_english_numbers.png` 仍识别成功。
- 结论：当前 venv / 模型就绪后，可以完全离线运行。

## 方案对比

### 方案 A：Python RapidOCR CLI/helper

结论：推荐。

优点：

- PoC 已跑通，调用模型简单，中文/英文/数字/408 文本效果明显优于继续投入 Tesseract 调参。
- JSON helper 与现有 Tesseract 子进程模型一致，适合放在 Electron main 进程内调用。
- 后续可以用 PyInstaller 或 Nuitka 打包为 `rapidocr-helper.exe`，再与 runtime / models 一起放入 `resources`。
- 可将 stderr 完全丢弃或脱敏，只向主线返回稳定 JSON，安全边界清晰。

风险：

- venv 体积约 280 MB，正式打包成 exe 后仍需实际压缩和裁剪验证。
- Python 打包后需要检查 VC runtime、OpenCV、ONNX Runtime DLL、杀软误报、启动耗时。
- 需要为 helper 加超时、取消、并发限制和错误码映射。

### 方案 B：Node.js `onnxruntime-node` 直连模型

结论：v0.2 不建议采用。

原因：

- `onnxruntime-node` 只解决 ONNX 推理 runtime，不提供完整 OCR pipeline。
- 仍需在 TypeScript/Node 里自研图片预处理、文本检测框后处理、方向分类、识别解码、字典映射、box 合并与排序。
- Electron native module 打包、ABI、`electron-builder` extraResources / unpack 配置复杂度高。
- 相比 Python helper，短期维护成本显著更高，收益主要是少一个 Python helper 进程，但不足以抵消复杂度。

可保留为长期研究项：如果未来需要完全 JS runtime，建议先做单独 OCR pipeline spike，而不是在 v0.2 正式接入时冒险直连。

### 方案 C：Tesseract fallback

结论：必须保留。

理由：

- 现有 Tesseract 已内置并被主线验证。
- RapidOCR helper 不存在、模型缺失、超时、崩溃、输出 JSON 无效时，可以回退到 Tesseract，避免核心错题功能受影响。
- 用户已经能查看和手动修正 OCR 缓存，fallback 与现有 UX 一致。

## 正式接入建议

接口草案：

```ts
type OcrEngineName = "rapidocr" | "tesseract";

type OcrBlock = {
  text: string;
  confidence: number | null;
  box: Array<[number, number]> | null;
};

type OcrResult = {
  ok: boolean;
  engine: OcrEngineName;
  engineVersion: string;
  elapsedMs: number;
  text: string;
  blocks: OcrBlock[];
  warning: string | null;
  errorCode: string | null;
};

interface OcrEngine {
  readonly name: OcrEngineName;
  recognize(input: { absolutePath: string }, options: { timeoutMs: number; signal?: AbortSignal }): Promise<OcrResult>;
}
```

组件建议：

- `RapidOcrEngine`：spawn `rapidocr-helper.exe`，读取 stdout JSON，忽略或脱敏 stderr。
- `TesseractOcrEngine`：封装现有 Tesseract 调用。
- `OcrEngineRegistry`：按配置优先 RapidOCR，失败时 fallback 到 Tesseract。
- 超时策略：默认 30 秒；超时 kill 子进程，返回 `EXTRACTION_TIMEOUT`，再按策略 fallback。
- 取消策略：v0.2 正式接入建议支持 cancel/timeout；细粒度 progress 暂不做，批量 OCR 再扩展。
- 并发策略：初版建议单机限制 1-2 个 OCR 子进程，避免 ONNX Runtime 抢 CPU。

推荐资源布局：

```text
resources/
  ocr/
    tesseract/
    rapidocr/
      runtime/
      models/
      rapidocr-helper.exe
      runtime-manifest.json
      licenses/
```

后续 `electron-builder.yml` 建议：

```yaml
extraResources:
  - from: resources/ocr/tesseract
    to: ocr/tesseract
  - from: resources/ocr/rapidocr
    to: ocr/rapidocr
```

开发态路径使用项目内 `resources\ocr\rapidocr`，打包态路径使用 `process.resourcesPath\ocr\rapidocr`。安装后的 MistVault 不得依赖 `E:\develop`。

## 后续 migration 建议

本 PoC 未改 schema、未新增 migration。正式接入时建议给 `attachment_text_cache` 增加：

- `ocr_engine`
- `ocr_engine_version`
- `ocr_confidence`
- `ocr_orientation`

用途：

- 区分 Tesseract / RapidOCR 结果。
- 支持后续按引擎版本重新提取。
- 记录整体置信度和方向修正信息。

## 安全与隐私

本 PoC：

- 未上传任何图片到云端。
- 未使用 API Key。
- 未把用户文件路径写入 AI prompt。
- 未把绝对路径暴露给 renderer。
- helper stdout 只输出 JSON；RapidOCR 默认 stderr 路径日志已在 helper 内静默。
- Node demo 验证了无效图片路径错误不会返回完整本地路径。

正式接入仍需确保：

- renderer 只传 `attachmentId`，绝不传本地路径。
- main 解析附件路径并做目录边界校验。
- 错误信息不得包含完整路径、堆栈、系统用户名、模型内部路径。
- OCR 失败只更新提取状态，不影响错题 CRUD、附件打开、AI 会话。

## MistVault 验证结果

在 `E:\projects\codex_projects\MistVault` 内执行：

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run build` | 普通沙箱因 esbuild `spawn EPERM` 失败；提升权限重跑通过 |
| `npm run verify:db` | 普通沙箱因 electron-rebuild `spawn EPERM` 失败；提升权限重跑通过 |

未运行 `electron-builder`，未打包 MistVault。

## 仓库变更与未提交内容

MistVault 仓库内只新增本文档：

```text
docs/ocr/rapidocr-poc-report.md
```

未提交到 Git 的 PoC 大文件 / 环境：

- `E:\develop\mistvault-ocr-poc\.venv`
- `E:\develop\mistvault-ocr-poc\pip-cache`
- `E:\develop\mistvault-ocr-poc\samples`
- `E:\develop\mistvault-ocr-poc\outputs`
- `E:\develop\mistvault-ocr-poc` 下的 PoC 脚本与 README
- RapidOCR 模型文件
- ONNX Runtime DLL / 包文件
- 任何后续可能生成的 exe / dll / zip

未清理 `.tmp/`，未删除用户数据，未修改 `release/`、现有 OCR runtime 或用户数据目录。

## 上游资料

- RapidOCR GitHub：https://github.com/RapidAI/RapidOCR
- RapidOCR PyPI：https://pypi.org/project/rapidocr/
- ONNX Runtime Node 文档：https://onnxruntime.ai/docs/get-started/with-javascript/node.html
- onnxruntime PyPI：https://pypi.org/project/onnxruntime/

