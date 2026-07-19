# Real OCR Benchmark

Date: 2026-07-19

## 1. Research Goal

This benchmark checks MistVault's current OCR chain on public, non-private study materials:

```text
image -> RapidOCR preferred / Tesseract fallback -> cleanupOcrText -> optional AI formatting -> manual correction
```

This is research only. It does not change the default OCR flow, add a formula OCR model, add a heavy dependency, or change schema/migrations.

## 2. Current OCR Chain

- Image attachments (`.jpg`, `.jpeg`, `.png`, `.bmp`) are routed to `AttachmentTextExtractionService.extractImageOcr`.
- `OcrEngineRegistry` tries RapidOCR first when `resources/ocr/rapidocr` is available, then falls back to Tesseract on RapidOCR failure.
- Successful image OCR text is immediately passed through `cleanupOcrText` before being cached.
- AI formatting is a separate manual post-processing path through `AiTextCleanupService`; it is conservative formatting, not OCR recognition.
- PDF files use text-layer extraction only. Scanned/image PDF OCR is not part of the app default flow.

## 3. Sources And Privacy

Samples were public materials downloaded to `.tmp/real-ocr-benchmark/` and excluded from Git by `.gitignore`.

- CBSE Class X sample papers page: https://cbseacademic.nic.in/SQP_CLASSX_2025-26.html
- CBSE Class X Mathematics Standard PDF: https://cbseacademic.nic.in/web_material/SQP/ClassX_2025_26/MathsStandard-SQP.pdf
- CBSE Class X English PDF: https://cbseacademic.nic.in/web_material/SQP/ClassX_2025_26/EnglishL-SQP.pdf
- CBSE Class XII sample papers page: https://cbseacademic.nic.in/sqp_classxii_2025-26.html
- CBSE Class XII Applied Mathematics PDF: https://cbseacademic.nic.in/web_material/SQP/ClassXII_2025_26/Applied-Maths-SQP.pdf
- PEP page for a normal-distribution lesson PDF: https://www.pep.com.cn/zzggjc/sx2023/tzmk1/jxsj/202511/t20251111_2004268.shtml
- PEP normal-distribution PDF: https://www.pep.com.cn/zzggjc/sx2023/tzmk1/jxsj/202511/P020251111532433035138.pdf

No user-owned images, names, schools, admission numbers, accounts, or private identifiers were included. Full PDFs, rendered PNGs, preprocessing variants, manifests, and raw OCR outputs remain in `.tmp/real-ocr-benchmark/` and are not committed.

## 4. Samples

Main benchmark: 12 image samples.

| Category | Count | Notes |
| --- | ---: | --- |
| 01-clean-printed-photo | 1 | Clean public PDF render used as a clean printed-layout proxy, not a phone photo. |
| 02-skewed-photo | 1 | Controlled 7 degree skew from the public PDF render. |
| 03-shadow-or-low-light | 2 | Controlled shadow/low-light and blur variants from public PDF renders. |
| 04-pdf-rendered | 5 | Direct 150 DPI PNG renders from public PDFs. |
| 05-chinese-multiple-choice | 0 | No safe public sample was used. |
| 06-chinese-english-mixed | 0 | No representative safe sample was used. |
| 07-light-formula | 1 | Geometry/trigonometry/options page. |
| 08-formula-heavy | 1 | Table, matrix, integral, fractions. |
| 09-table-or-matrix | 1 | Matrix/differential/currency/options page. |
| 10-handwritten-annotation | 0 | No privacy-safe source was used. |

Separate preprocessing experiment: 3 derived variants, not counted as main benchmark samples.

## 5. Method

- Rendered public PDF pages to PNG at 150 DPI using a bundled Poppler tool under the Codex runtime.
- Ran `scripts/real-ocr-benchmark.mjs`, which calls RapidOCR directly, Tesseract directly, and the production registry path separately.
- Applied `cleanupOcrText` after raw OCR and recorded whether it changed lengths, lines, question numbers, and option labels.
- Stored full raw OCR outputs only under `.tmp/real-ocr-benchmark/output/`.
- Used short reference snippets for rough similarity only. The score is not a formal CER because full-page layout and formula reading order differ strongly from PDF text extraction.
- AI formatting was not run because no manual AI cleanup run was requested for this benchmark.

## 6. Results By Category

| Category | Registry result | Main observations |
| --- | --- | --- |
| Clean printed-layout proxy | Passed through Tesseract fallback | RapidOCR failed on special characters. Tesseract extracted enough English/digits/options for manual use, but inserted stray question fragments. |
| Skewed controlled sample | Passed through Tesseract fallback | Tesseract still extracted text, but lost many option labels and misread headings. Manual deskew recovered much of the clean-page structure. |
| Shadow/low-light controlled sample | RapidOCR on Chinese PEP, Tesseract on blur/formula page | RapidOCR was strong on ordinary Chinese even under low contrast. Blur harmed formula/table structure; sharpening restored some Tesseract structure. |
| PDF-rendered English | RapidOCR on 2/2 English pages | RapidOCR preserved normal English paragraph text well on page 1; page 2 had junk from header/top artifacts. Tesseract was faster and more stable but less clean. |
| PDF-rendered Chinese | RapidOCR on simple Chinese page; Tesseract fallback on symbol-heavy Chinese math page | RapidOCR ordinary Chinese was visibly better than Tesseract. Greek/math symbols on the second PEP page triggered RapidOCR helper output failure. |
| Light formula | Tesseract fallback | Plain text and options survived, but superscripts, fractions, roots, and theta were flattened or misread. |
| Formula-heavy | Tesseract fallback | Tables partially survived as lines; matrix/integral structure did not survive as mathematical notation. |
| Table/matrix | Tesseract fallback | Text around the matrix survived; matrix rows were flattened and alpha/currency/superscripts were unreliable. |

## 7. RapidOCR Vs Tesseract

- RapidOCR direct succeeded on 4/12 samples. It failed on 8/12 with `UnicodeEncodeError` from the local helper when output included characters such as superscripts, minus signs, or rupee symbols.
- Tesseract direct succeeded on 12/12 samples and averaged about 1.17s per page.
- Registry succeeded on 12/12 samples because fallback worked. Average registry time was about 2.42s; RapidOCR failures added roughly 5s before Tesseract fallback.
- Where RapidOCR succeeded, ordinary Chinese and clean English were generally cleaner than Tesseract.
- Where Tesseract handled fallback, it was robust but weaker on Chinese, formula layout, and dense tables.

## 8. Cleanup Benefits And Side Effects

Benefits:

- Reduced excess spaces and normalized simple math/operator spacing.
- Preserved many A/B/C/D labels in English multiple-choice pages.
- Made ordinary Tesseract text easier to scan.

Side effects:

- On Chinese PDF-rendered pages, RapidOCR output dropped from 36 lines to 2 after cleanup because adjacent CJK lines were merged too aggressively.
- On one Chinese math page, Tesseract question-number count changed from 1 to 0 after cleanup.
- On dense option/formula pages, option-label counts sometimes dropped after cleanup, e.g. 36 to 33 or 25 to 23.
- Cleanup cannot reconstruct superscripts, fractions, matrices, integrals, or table geometry once OCR flattened them.

## 9. AI Formatting

AI formatting was not run. It remains a manual post-processing step and should not be treated as OCR accuracy. Based on current implementation boundaries, AI formatting may improve paragraph readability and option grouping, but it must not be relied on to correct formulas, infer missing symbols, or replace manual review.

## 10. Formula, Matrix, Table, And Handwriting Conclusions

- Ordinary Chinese: usable when RapidOCR succeeds; weaker with Tesseract fallback.
- English and digits: usable on clean pages with both engines; RapidOCR output is cleaner when it succeeds.
- Question numbers: generally retained by Tesseract on English/math pages, but page headers and marks can be confused as question numbers.
- Options: often retained in clean English pages; degraded by skew/blur and sometimes by cleanup.
- Punctuation: ordinary punctuation is mostly usable; dashes and special symbols vary by engine.
- Math symbols: unreliable. Greek letters, roots, superscripts, fractions, integrals, and currency symbols are common failure points.
- Superscripts/subscripts: usually flattened, lost, or turned into nearby plain digits.
- Fractions: often split into separate lines or merged into ambiguous text.
- Roots: sometimes recognized as a symbol, but expression structure is not preserved.
- Integrals/sums: not reliably preserved as structured formulas.
- Matrices: matrix content may survive as scattered rows, but bracket/row/column structure is not reliable.
- Tables: table text survives partially; table relationships and columns are not reliably preserved.
- Handwritten annotations: not verified in this run.

## 11. Performance And Timeouts

- No 30s OCR timeout occurred.
- RapidOCR successful pages took about 4.5s to 5.7s.
- RapidOCR failed pages took about 5.0s to 8.1s before fallback.
- Tesseract took about 0.95s to 1.47s on these 150 DPI page images.
- Registry remains robust, but RapidOCR helper failures make fallback noticeably slower.

## 12. Lightweight Preprocessing Findings

Three isolated preprocessing variants were run under `.tmp` only:

- Manual deskew of the controlled skew sample improved Tesseract structure: option labels rose from 4 to 10, and text length returned near the clean-page baseline.
- Grayscale/autocontrast/sharpen on the PEP shadow sample produced no meaningful improvement; RapidOCR was already stable.
- Contrast/sharpen on the blurred formula/table sample improved Tesseract from the degraded variant toward the original page: option labels recovered from 25 to 27 and false question-number detections dropped from 7 to 2.

Limited inference: lightweight preprocessing is worth a narrow PoC for deskew and sharpening, but should not be added blindly to the main flow. Shadow correction alone did not show a clear win in this small set.

## 13. Recommended Short-Term Optimization

Ranked decisions:

1. D. Improve RapidOCR/Tesseract registry or fallback.
   - Fix RapidOCR helper stdout/child encoding so Unicode OCR text does not crash.
   - Ensure helper errors are sanitized and do not expose tracebacks.
   - Consider treating this class of RapidOCR failure as a fast fallback case.
2. C. Optimize cleanup, but do not change OCR engine defaults.
   - Reduce aggressive CJK line merging for OCR page/table layouts.
   - Preserve question-number and A/B/C/D option lines more conservatively.
3. B. Prioritize a small lightweight preprocessing PoC.
   - Test deskew and sharpen/contrast as isolated options first.
   - Do not add OpenCV or new heavy app dependencies for this research result.
4. F. Formula OCR remains a long-term independent PoC.
   - Current OCR is not enough for structured formula, matrix, fraction, or integral recognition.

Not selected:

- A is not selected because the RapidOCR helper failure and formula/table limits are material.
- E is not selected as the next priority. Region OCR may help dense pages later, but this run first points to runtime/fallback and cleanup issues.

## 14. Not Recommended

- Do not replace the current chain with formula OCR in the main app.
- Do not add OpenCV/Paddle/formula-model dependencies to MistVault from this benchmark.
- Do not rely on AI formatting to correct OCR.
- Do not commit real user images or full OCR dumps.
- Do not merge `research/formula-ocr-feasibility` as part of this work.

## 15. Evidence Buckets

Verified facts:

- `main` was synced and `feat/ai-cleanup-ocr-text` was already merged before the research branch was created.
- 12 public, non-private image samples were benchmarked.
- RapidOCR direct succeeded on 4/12 and failed on 8/12 in the local helper output path.
- Tesseract direct succeeded on 12/12.
- Registry succeeded on 12/12 via RapidOCR or fallback.
- No AI formatting was run.
- No schema/migration/default OCR flow was changed.

Limited-sample inferences:

- RapidOCR is better than Tesseract on ordinary Chinese when the helper succeeds.
- Tesseract is more stable in this local runtime, but weaker on Chinese and mathematical layout.
- Deskew and sharpening can help degraded inputs, but the value is not yet broad enough to justify a default preprocessing step.
- cleanup is helpful for plain OCR text but risky for Chinese page layout and dense option/formula pages.

Not verified:

- True phone photos from the user's own study materials.
- Privacy-safe handwritten annotations.
- Chinese multiple-choice sheets.
- Chinese-English mixed pages.
- AI cleanup behavior on these samples.
- Strict character error rate across full pages.

## 16. Next Priorities

1. Fix and verify RapidOCR helper Unicode output handling in the local runtime build path.
2. Add focused cleanup regression tests for CJK page layout, option labels, and question numbering.
3. Run a second benchmark with 10 to 20 user-approved, privacy-scrubbed real phone photos kept outside Git.
4. Prototype lightweight deskew/sharpen as an opt-in or research-only pass before considering main-flow changes.
5. Keep formula OCR as a separate long-term PoC with its own dependency, packaging, and privacy review.
