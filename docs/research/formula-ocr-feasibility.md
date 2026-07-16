# Formula OCR feasibility for MistVault

Date: 2026-07-16
Branch: `research/formula-ocr-feasibility`
Scope: research only. This document does not change MistVault's default OCR behavior, schema, migrations, AI fixed context, or runtime packaging.

## 1. Background

MistVault currently extracts image text through the OCR engine registry. The registry prefers RapidOCR when the packaged helper/runtime/models are available, and falls back to Tesseract when RapidOCR is unavailable or fails. OCR output is then passed through `cleanupOcrText` before being saved for image attachments.

The current cleanup step improves readability of ordinary OCR text. It can normalize whitespace, reduce excessive blank lines, preserve option/numbered lines, compact common Chinese text spacing, and tidy simple inline math spacing such as `f ( x )`, `x ^ 2`, or `x _ 1`.

The user concern is different: exam screenshots often contain semantic formula structures. A normal OCR engine can return readable nearby Chinese text but flatten or corrupt formula structure. Cleanup cannot infer a missing numerator/denominator, rebuild a matrix, restore a root bar, or convert a cropped expression into LaTeX.

## 2. Current RapidOCR + cleanup capability

What it can solve:

- Improves general Chinese/English OCR readability when the text is printed clearly and the OCR engine returns valid text.
- Keeps simple multiple-choice lines more likely to remain independent after cleanup.
- Makes some simple inline expressions easier to read by normalizing spaces around function calls, superscript markers, subscript markers, and common operators.
- Keeps the current offline Windows deployment model: no cloud OCR call, no model download at runtime, and no AI dependency for baseline extraction.
- Provides a practical fallback chain through `OcrEngineRegistry`, so RapidOCR failure can fall back to Tesseract without changing attachment extraction APIs.

What it cannot solve:

- It does not understand mathematical layout. Fractions, radicals, summations, integrals, matrices, determinants, and piecewise functions may become misleading linear text.
- It cannot recover missing superscript/subscript semantics when the OCR engine did not output the symbols correctly.
- It cannot reliably preserve table structure, probability tables, matrices, or aligned equation groups.
- It cannot convert formulas into LaTeX.
- It cannot distinguish "OCR text cleanup damaged a formula" from "the OCR engine already returned a damaged formula" without comparing against the original image.
- It is unlikely to handle handwritten annotations well unless the handwriting is simple and close to printed text.

## 3. Sample test results

Local sample input directory: `.tmp/ocr-formula-samples/`
Local result output directory: `.tmp/ocr-formula-results/`
Runner: `node scripts/research-formula-ocr.mjs`

Four local PNG samples were tested. They are intentionally kept under `.tmp/` and are not committed. The research runner was first attempted in the normal sandbox, where the OCR subprocess could not produce real OCR results. It was rerun with elevated permission so the local OCR runtime could start. For all four samples, the registry returned successful Tesseract results; RapidOCR did not return the final result for these images.

| Sample | Category | Current OCR + cleanup result | Main observed failures | Notes |
| --- | --- | --- | --- | --- |
| `ChatGPT Image Jul 16, 2026, 07_07_30 PM (1).png` | 高等数学：极限、导数、积分、分段函数 | Not enough for direct entry. It preserves scattered numbers/options, but Chinese text and formulas are unreliable. | Chinese mojibake, broken fractions, lost integral structure, damaged superscripts/subscripts, broken piecewise braces. | `cleaned.txt` length 662; final engine `tesseract`. |
| `ChatGPT Image Jul 16, 2026, 07_07_30 PM (2).png` | 线性代数与概率论：矩阵、行列式、线性方程组、概率表 | Not enough for direct entry. Some numbers survive, but the important matrix/table structures are lost. | Determinant/matrix alignment lost, equation-system brace lost, probability table flattened, subscripts damaged. | `cleaned.txt` length 559; final engine `tesseract`. |
| `ChatGPT Image Jul 16, 2026, 07_07_31 PM (3).png` | 408 综合：中文题干、选项、填空、网络/数据结构术语 | Partially useful as a rough correction draft. English abbreviations, IP addresses, and option labels survive better than math samples. | Chinese mojibake, option wrapping errors, some mixed symbols such as `n0/n1/n2` and `W[i][j]` damaged. | `cleaned.txt` length 1169; final engine `tesseract`. |
| `ChatGPT Image Jul 16, 2026, 07_07_32 PM (4).png` | 数学练习与批注：打印文字 + 手写批注 + 简单公式 | Poor for direct entry. Printed options are partially visible, but formulas and handwritten notes are not reliable. | Handwriting mostly missed, fractions/root/sum/integral damaged, inequality-system brace lost, many Chinese lines mojibake. | `cleaned.txt` length 875; final engine `tesseract`. |

Per-sample manual notes were written under `.tmp/ocr-formula-results/<sample>/notes.md`. They are local research artifacts only and should not be committed.

## 4. Observed failure types

- Chinese recognition/decoding is not reliable on these samples. Large parts of the output are mojibake-like text, so even ordinary题干 need manual correction.
- Two-dimensional formula layout is the main unsolved problem. Fractions, integrals, roots, summations, piecewise braces, equation-system braces, matrices, determinants, and tables are flattened or broken.
- Option labels survive better than formula content. A/B/C/D markers often remain visible, but options may merge with题干 or lose their mathematical meaning.
- Handwritten annotations are not dependable. The sample with notes such as "顶点式", "注意定义域", and "再算一遍" did not produce usable handwritten text.
- Cleanup helps readability only after OCR has returned usable text. In these samples it can reduce spacing noise and keep some option lines, but it cannot restore formula semantics or fix mojibake.

## 5. Formula OCR candidates

| Option | Direction | Expected benefit | Main cost/risk | Fit for MistVault |
| --- | --- | --- | --- | --- |
| A | Keep RapidOCR + cleanup + manual correction | Lowest implementation and packaging risk. Good enough for ordinary printed Chinese text and simple inline math when OCR output is valid. | Complex formulas remain unreliable and users must correct important expressions. | Best short-term default. |
| B | Optional AI cleanup of extracted OCR text | Can improve formatting, prose cleanup, Markdown organization, and some obvious text corruption when the user already configured AI. No new OCR runtime. | AI cannot see the original pixels if only OCR text is sent; it may hallucinate formulas or make wrong math look polished. Must be opt-in. | Good medium-term optional button, not default. |
| C | Independent formula OCR / LaTeX OCR for cropped formulas | Can turn formula image regions into LaTeX and preserve semantic math structure better than normal OCR. | Requires formula detection/cropping UX or pipeline, model packaging, latency checks, and careful confidence handling. | Worth a long-term plugin-style spike. |
| D | Full document structure parsing: layout + OCR + formula + table | Best chance to preserve full page structure, tables, formulas, and reading order. | Heaviest deployment and integration surface; likely larger models, more dependencies, slower inference, and harder Windows packaging. | Not suitable as default near-term feature. |

Candidate technologies:

- PaddleOCR / PaddleX / PP-FormulaNet: promising formula and document intelligence direction. PaddleOCR's public project describes PP-StructureV3 for structured PDF/image conversion and mentions formula model improvements. The PP-FormulaNet paper describes small and large variants intended to balance accuracy and speed.
- pix2tex / LaTeX-OCR: focused image-to-LaTeX formula OCR. Its project states that it uses a learned model to convert formula images to LaTeX and downloads checkpoints automatically. This is useful for a PoC but risky for default offline packaging.
- UniMERNet and similar offline formula recognition models: relevant for real-world mathematical expression recognition research, but still require model/runtime packaging validation before any product decision.

References:

- PaddleOCR: https://github.com/PaddlePaddle/PaddleOCR
- PaddleX: https://github.com/PaddlePaddle/PaddleX
- PP-FormulaNet paper: https://arxiv.org/abs/2503.18382
- pix2tex / LaTeX-OCR: https://github.com/lukas-blecher/LaTeX-OCR
- UniMERNet paper: https://arxiv.org/abs/2404.15254

## 6. Deployment risks

Offline deployment:

- Formula OCR models usually require extra model files and a runtime stack. They must be bundled with the app or installed through a controlled optional flow; runtime downloads are not acceptable for MistVault's offline baseline.
- If a PoC is attempted, environments and models should live outside the repository, preferably under `E:\develop\mistvault-formula-ocr-poc`, with no dependency on `E:\develop` in the final app.
- Python/PyTorch-based options are convenient for research but can be difficult to package into a small, predictable Windows desktop runtime.

Package size:

- Current RapidOCR packaging already adds runtime/model assets. Formula OCR would add another model family or a larger document parsing stack.
- pix2tex-style PyTorch deployments are likely too large for a default OCR feature unless heavily optimized or made optional.
- Full structure parsing stacks may be substantially larger than a formula-only OCR helper because they include layout, table, text, formula, and post-processing components.

Windows compatibility:

- Windows packaging must validate helper startup, DLL lookup, long paths, non-ASCII user paths, antivirus false positives, and child-process timeout handling.
- GPU-specific builds are not acceptable as the only path. CPU inference must be available and stable.
- Any Python-based PoC needs a separate packaging decision before product integration. A working venv is not enough evidence for a shippable Windows app.

GPU requirement:

- Default MistVault OCR should not require GPU.
- Formula OCR may benefit from GPU, especially large transformer-based models, but a default feature must run on CPU with acceptable latency.
- If CPU latency is too high for whole-page processing, formula OCR should remain a manual, optional, cropped-region tool or plugin rather than automatic extraction.

## 7. Recommendation for MistVault

Current OCR + cleanup is acceptable only as a rough draft for manual correction. It is not enough for automatic high-quality entry of math-heavy screenshots. For 408-style text pages it may save some typing, especially for English abbreviations, IP addresses, and option labels. For math pages, the user must still inspect the original image and manually correct formulas.

Short term:

- Keep RapidOCR/Tesseract registry + cleanup + manual correction as the default.
- Do not add formula OCR to the default flow now.
- Improve user-facing expectations: math OCR output should be treated as editable draft text, not a faithful formula transcript.

Medium term:

- Consider an optional "AI 整理 OCR 文本" action after product design review. It should be explicit, reversible, and based on the user's configured AI provider.
- Make clear that AI text cleanup is not formula OCR and cannot guarantee mathematical correctness.
- If implemented, prefer asking AI to structure and clean existing text while warning users to compare formulas against the original image.

Long term:

- Research a plugin-style formula OCR path for cropped formulas. Treat LaTeX OCR as an advanced optional capability, not a default extraction behavior.
- Only consider document-structure parsing if more real samples show that tables/matrices/page layout are more important than isolated formula conversion.
- Any formula OCR PoC should live under `E:\develop\mistvault-formula-ocr-poc` or `.tmp/formula-ocr-poc/`, with no model/runtime files committed.

Answers to the required decision questions:

1. 对考研数学题截图，formula OCR could provide meaningful benefit, but only if it preserves LaTeX or structured layout. Current OCR + cleanup is not enough.
2. For daily entry, manual correction is still more predictable than adding a heavy model immediately.
3. Default bundling risks unacceptable installer growth, especially for PyTorch or full document parsing stacks.
4. Whole-page formula/document parsing may noticeably slow OCR; cropped formula OCR is more controllable.
5. Formula OCR can bring a complex runtime, especially Python/PyTorch/Paddle stacks.
6. It is not suitable as a default feature today.
7. It is more suitable as an optional advanced feature or plugin after isolated PoC validation.

## Repository impact

- Main OCR flow changed: no.
- AI fixed-context logic changed: no.
- Schema/migration changed: no.
- Formal dependencies added: no.
- Runtime/model/binary files added: no.
- `.tmp/` used for local samples/results only: yes.
