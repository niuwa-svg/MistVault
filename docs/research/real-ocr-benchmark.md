# Real OCR Benchmark

Date: 2026-07-19

## 1. Research Goal

This benchmark checks MistVault's current OCR chain on public, non-private study materials. The
same sample set was run before and after `e96ac5b` (`fix: make RapidOCR helper output
Unicode-safe`) so the report can separate output transport reliability from OCR recognition quality.

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
- Recorded both engine-reported `elapsedMs` and script-measured `wallElapsedMs`; the latter is the
  comparable value for registry timing because fallback can include more than one engine attempt.
- Used short reference snippets for rough similarity only. The score is not a formal CER because full-page layout and formula reading order differ strongly from PDF text extraction.
- AI formatting was not run because no manual AI cleanup run was requested for this benchmark.

## 6. Results By Category

| Category | Registry result | Main observations |
| --- | --- | --- |
| Clean printed-layout proxy | RapidOCR | RapidOCR now returns successfully and preserves more option labels/question-like markers than Tesseract, though some page/header artifacts remain. |
| Skewed controlled sample | RapidOCR | RapidOCR now returns successfully and is less damaged by the controlled skew than Tesseract on option-label counts. Manual deskew still improves structure. |
| Shadow/low-light controlled sample | RapidOCR | RapidOCR remains strong on ordinary Chinese even under low contrast. Blur still harms formula/table structure; sharpening helps but does not restore mathematical structure. |
| PDF-rendered English | RapidOCR on 2/2 English pages | RapidOCR preserved normal English paragraph text well on page 1; page 2 had junk from header/top artifacts. Tesseract was faster and more stable but less clean. |
| PDF-rendered Chinese | RapidOCR | Unicode output no longer fails on Greek/math symbols. Ordinary Chinese remains visibly better with RapidOCR, but cleanup still merges page/table lines aggressively. |
| Light formula | RapidOCR | RapidOCR now returns text and option labels, but superscripts, fractions, roots, and theta remain flattened or misread. |
| Formula-heavy | RapidOCR | RapidOCR now returns table/matrix/integral text, but mathematical notation and table relationships are still not structurally reliable. |
| Table/matrix | RapidOCR | Text around matrices and options survives; brackets, row/column structure, currency, and superscripts remain unreliable. |

## 7. RapidOCR Unicode Fix Comparison

| Metric | Before `e96ac5b` | After `e96ac5b` |
| --- | ---: | ---: |
| RapidOCR success | 4/12 | 12/12 |
| RapidOCR failure | 8/12 | 0/12 |
| UnicodeEncodeError | 8/12 | 0/12 |
| Other RapidOCR failure | 0 observed | 0 observed |
| Tesseract success | 12/12 | 12/12 |
| Registry used RapidOCR | 4/12 | 12/12 |
| Registry fallback to Tesseract | 8/12 | 0/12 |
| RapidOCR average wall time | about 5.46s | 5.22s |
| Tesseract average wall time | about 1.17s | 1.14s |
| Registry average wall time | about 5s+ on fallback cases | 5.12s |

Interpretation:

- Unicode transport reliability is fixed for this sample set: the previous helper `UnicodeEncodeError`
  class dropped from 8/12 to 0/12.
- RapidOCR recognition accuracy did not become formula OCR. It now returns text for formula-heavy,
  matrix, and currency pages, but the text is still flattened OCR text rather than structured math.
- Registry fallback behavior improved: all 12 main samples used RapidOCR after the fix, so fallback
  no longer masks RapidOCR's actual recognition output.
- Tesseract remains a useful fallback because it is fast and stable, but this run no longer needs it
  for the main sample set.

## 8. RapidOCR Vs Tesseract

- RapidOCR direct succeeded on 12/12 samples after the Unicode fix and averaged 5.22s wall time.
- Tesseract direct succeeded on 12/12 samples and averaged 1.14s wall time.
- Registry succeeded on 12/12 samples and used RapidOCR on 12/12, averaging 5.12s wall time.
- RapidOCR generally produced cleaner ordinary Chinese and strong option/question-number counts on
  English math pages.
- Tesseract was faster and sometimes less affected by RapidOCR's extra line fragmentation, but it
  remained weaker on Chinese and did not preserve formula/table structure.

## 9. Cleanup Benefits And Side Effects

Benefits:

- Reduced excess spaces and normalized simple math/operator spacing.
- Preserved many A/B/C/D labels in English multiple-choice pages.
- Made ordinary Tesseract text easier to scan.

Side effects:

- On Chinese PDF-rendered pages, RapidOCR output still dropped from 36 lines to 2 after cleanup
  because adjacent CJK lines were merged too aggressively.
- On the Chinese math page, RapidOCR output dropped from 62 lines to 28 after cleanup.
- On dense option/formula pages, option-label counts still sometimes dropped after cleanup, e.g.
  RapidOCR 37 to 36 on the matrix page and 12 to 11 on an English page.
- Cleanup cannot reconstruct superscripts, fractions, matrices, integrals, or table geometry once OCR flattened them.

Cleanup structure fix rerun on 2026-07-19:

- The same local public sample set was rerun after adding conservative CJK line-break protection.
- Registry/RapidOCR succeeded on 12/12 samples. Cleanup still changed whitespace or simple spacing on
  11/12 registry outputs, so the basic readability cleanup remains active.
- The controlled Chinese shadow page stayed at 36 -> 36 lines after cleanup, with question numbers
  1 -> 1 and option labels 0 -> 0.
- The Chinese PDF-rendered page stayed at 36 -> 36 lines after cleanup, with question numbers
  1 -> 1 and option labels 0 -> 0.
- The Chinese math page changed from 62 -> 57 lines after cleanup, with question numbers 3 -> 3 and
  option labels 0 -> 0. This no longer shows the earlier 62 -> 28 structure collapse.
- Dense option pages still have isolated OCR/cleanup ambiguities outside the CJK collapse fix:
  the matrix page option count was 37 -> 36 and English page 2 was 12 -> 11.

Dense option boundary fix rerun on 2026-07-19:

- The same local public sample set was rerun after protecting parenthesized A-F/a-f option-like
  markers from math function-call spacing cleanup.
- Root cause: `normalizeMathSpacing` treated text such as `p.a (B)` and `from (a)` as function-call
  spacing and collapsed it to `p.a(B)` / `from(a)`, removing the whitespace boundary used by option
  counting and manual reading.
- The matrix page option count is now 37 -> 37. Manual spot check confirmed the restored `(B)` is a
  real inline answer option in `p.a (B) 2.5 % p.a.`.
- English page 2 option-like count is now 12 -> 12. Manual spot check confirmed the restored
  `(a)-(c)` is a prose reference to choices rather than an answer line; cleanup still should not
  swallow that boundary.
- The controlled Chinese shadow page stayed 36 -> 36 lines, the Chinese PDF-rendered page stayed
  36 -> 36 lines, and the Chinese math page stayed 62 -> 57 lines.
- Remaining limitation: the benchmark option count is still a marker-count heuristic, not semantic
  classification of actual answer options.

## 10. AI Formatting

AI formatting was not run. It remains a manual post-processing step and should not be treated as OCR accuracy. Based on current implementation boundaries, AI formatting may improve paragraph readability and option grouping, but it must not be relied on to correct formulas, infer missing symbols, or replace manual review.

## 11. Formula, Matrix, Table, And Handwriting Conclusions

- Ordinary Chinese: usable when RapidOCR succeeds; weaker with Tesseract fallback.
- English and digits: usable on clean pages with both engines; RapidOCR output is cleaner when it succeeds.
- Question numbers: generally retained by Tesseract on English/math pages, but page headers and marks can be confused as question numbers.
- Options: often retained in clean English pages; degraded by skew/blur and sometimes by cleanup.
- Punctuation: ordinary punctuation is mostly usable; dashes and special symbols vary by engine.
- Math symbols: more reliably transported after the Unicode fix, but still unreliable as recognized
  mathematical structure. Greek letters, roots, superscripts, fractions, integrals, and currency
  symbols are common OCR quality failure points.
- Superscripts/subscripts: usually flattened, lost, or turned into nearby plain digits.
- Fractions: often split into separate lines or merged into ambiguous text.
- Roots: sometimes recognized as a symbol, but expression structure is not preserved.
- Integrals/sums: not reliably preserved as structured formulas.
- Matrices: matrix content may survive as scattered rows, but bracket/row/column structure is not reliable.
- Tables: table text survives partially; table relationships and columns are not reliably preserved.
- Handwritten annotations: not verified in this run.

## 12. Performance And Timeouts

- No 30s OCR timeout occurred.
- RapidOCR pages took about 4.68s to 6.05s wall time after the Unicode fix.
- Tesseract took about 0.95s to 1.36s wall time on these 150 DPI page images.
- Registry used RapidOCR for all main samples after the fix, so registry time now tracks RapidOCR
  rather than fallback behavior.
- The previous run's fallback path was slower in practice because a failed RapidOCR attempt happened
  before Tesseract. The original script under-reported registry fallback wall time, so this report now
  records `wallElapsedMs`.

## 13. Lightweight Preprocessing Findings

Three isolated preprocessing variants were run under `.tmp` only:

- Manual deskew of the controlled skew sample still helps Tesseract, but RapidOCR after the Unicode
  fix already returned 14 option labels on both the skewed and deskewed variants.
- Grayscale/autocontrast/sharpen on the PEP shadow sample produced no meaningful RapidOCR improvement;
  cleanup still collapsed the Chinese page from 36 lines to 2.
- Contrast/sharpen on the blurred formula/table sample did not change the core conclusion: RapidOCR
  returned text, but formula/table structure remained flattened.

Limited inference: lightweight preprocessing is worth a narrow PoC for deskew and sharpening, but should not be added blindly to the main flow. Shadow correction alone did not show a clear win in this small set.

## 14. Recommended Short-Term Optimization

Updated ranked decisions after the Unicode fix:

1. A. cleanup CJK line-break protection.
   - This is the single highest-priority formal development task. RapidOCR now returns successfully,
     but cleanup still collapses Chinese page layout from 36 lines to 2 and 62 lines to 28.
2. B. cleanup question-number and option protection.
   - Option counts still drop on some RapidOCR outputs after cleanup, and page/table layouts can turn
     non-question markers into question-like fragments.
3. F. Temporarily do not modify the main OCR flow.
   - RapidOCR is now stable on this sample set; default-flow changes should wait until cleanup no
     longer damages usable OCR output.
4. D. Lightweight deskew PoC.
   - Skew remains a real quality issue, but it is less urgent than cleanup because RapidOCR already
     handled the controlled skew better than Tesseract after the Unicode fix.
5. E. Lightweight contrast/sharpen PoC.
   - Sharpening has limited value on this small set and does not solve formula/table structure.
6. C. RapidOCR other runtime/stability investigation.
   - No non-encoding RapidOCR failures were observed in the rerun; keep monitoring but do not make it
     the next formal task.

Formula OCR remains a long-term independent PoC:

   - Current OCR is not enough for structured formula, matrix, fraction, or integral recognition.

Not selected:

- Formula OCR integration is not selected for the default flow.
- Region/selection OCR is not selected as the next priority. It may help dense pages later, but the
  immediate observed damage is cleanup post-processing.

## 15. Not Recommended

- Do not replace the current chain with formula OCR in the main app.
- Do not add OpenCV/Paddle/formula-model dependencies to MistVault from this benchmark.
- Do not rely on AI formatting to correct OCR.
- Do not commit real user images or full OCR dumps.
- Do not merge `research/formula-ocr-feasibility` as part of this work.

## 16. Evidence Buckets

Verified facts:

- `main` was synced and `feat/ai-cleanup-ocr-text` was already merged before the research branch was created.
- The research branch was rebased onto `e96ac5b`.
- The same 12 public, non-private image samples were benchmarked before and after the Unicode fix.
- After the fix, RapidOCR direct succeeded on 12/12 and had 0 UnicodeEncodeError failures.
- Tesseract direct succeeded on 12/12.
- After the fix, registry succeeded on 12/12 and used RapidOCR on 12/12.
- No AI formatting was run.
- No schema/migration/default OCR flow was changed.

Limited-sample inferences:

- RapidOCR is better than Tesseract on ordinary Chinese in this sample set now that Unicode transport
  is reliable.
- Tesseract is still faster in this local runtime, but weaker on Chinese and mathematical layout.
- Deskew and sharpening can help some degraded inputs, but the value is not yet broad enough to justify
  a default preprocessing step.
- cleanup is helpful for plain OCR text but risky for Chinese page layout and dense option/formula pages.

Not verified:

- True phone photos from the user's own study materials.
- Privacy-safe handwritten annotations.
- Chinese multiple-choice sheets.
- Chinese-English mixed pages.
- AI cleanup behavior on these samples.
- Strict character error rate across full pages.

## 17. Next Priorities

1. Implement cleanup CJK line-break protection as the next formal development task.
2. Add focused cleanup regression tests for CJK page layout, option labels, and question numbering.
3. Run a second benchmark with 10 to 20 user-approved, privacy-scrubbed real phone photos kept outside Git.
4. Prototype lightweight deskew/sharpen only after cleanup no longer damages the text that OCR already returned.
5. Keep formula OCR as a separate long-term PoC with its own dependency, packaging, and privacy review.
