import { writeFile } from "node:fs/promises";
import { BrowserWindow } from "electron";
import type { ExportAttachmentItem, ExportDocumentData, ExportMistakeItem } from "../types";

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const paragraphs = (value: string | null): string => {
  const text = value?.trim() || "暂无内容";
  return escapeHtml(text).replace(/\r?\n/g, "<br>");
};

const renderAttachment = (attachment: ExportAttachmentItem): string => {
  const location = attachment.exportedRelativePath
    ? attachment.exportedRelativePath
    : `附件缺失: ${attachment.missingReason ?? "File unavailable"}`;
  return `<li><strong>${escapeHtml(attachment.originalName)}</strong><br><span>${escapeHtml(
    location
  )}</span></li>`;
};

const renderMistake = (mistake: ExportMistakeItem, index: number): string => `
  <section class="mistake">
    <h2>${index + 1}. ${escapeHtml(mistake.id)}</h2>
    <dl>
      <dt>路径</dt><dd>${escapeHtml(
        mistake.nodePath.length > 0 ? mistake.nodePath.join(" / ") : "未分类"
      )}</dd>
      <dt>关键词</dt><dd>${escapeHtml(
        mistake.keywords.length > 0 ? mistake.keywords.join(", ") : "暂无关键词"
      )}</dd>
    </dl>
    <h3>题目</h3>
    <p>${paragraphs(mistake.question)}</p>
    <h3>答案和解析</h3>
    <p>${paragraphs(mistake.answerAnalysis)}</p>
    <h3>备注</h3>
    <p>${paragraphs(mistake.note)}</p>
    <h3>附件</h3>
    ${
      mistake.attachments.length > 0
        ? `<ul>${mistake.attachments.map(renderAttachment).join("")}</ul>`
        : "<p>暂无附件</p>"
    }
    <h3>关联错题</h3>
    ${
      mistake.linkedMistakes.length > 0
        ? `<ul>${mistake.linkedMistakes
            .map(
              (linked) =>
                `<li>${escapeHtml(linked.id)}: ${escapeHtml(linked.question)}</li>`
            )
            .join("")}</ul>`
        : ""
    }
  </section>
`;

const renderHtml = (documentData: ExportDocumentData): string => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>MistVault 错题集</title>
    <style>
      body {
        color: #17202a;
        font-family: "Microsoft YaHei", "SimSun", Arial, sans-serif;
        font-size: 13px;
        line-height: 1.55;
        margin: 32px;
      }
      h1 { font-size: 24px; margin: 0 0 8px; }
      h2 { border-top: 1px solid #d8dee8; font-size: 18px; margin: 28px 0 10px; padding-top: 18px; }
      h3 { font-size: 14px; margin: 14px 0 6px; }
      p { margin: 0 0 8px; white-space: normal; }
      dl { display: grid; grid-template-columns: 92px 1fr; gap: 5px 10px; margin: 0 0 12px; }
      dt { color: #5b6878; font-weight: 700; }
      dd { margin: 0; overflow-wrap: anywhere; }
      li { margin-bottom: 5px; overflow-wrap: anywhere; }
      .meta { color: #5b6878; }
      .mistake { break-inside: avoid; }
    </style>
  </head>
  <body>
    <h1>MistVault 错题集</h1>
    <p class="meta">导出时间：${escapeHtml(documentData.generatedAt)}</p>
    ${documentData.mistakes.map(renderMistake).join("")}
  </body>
</html>`;

const formatDateTime = (value: string): string => {
  const date = new Date(value);
  const pad = (part: number): string => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
};

const renderParagraphs = (value: string | null, emptyText: string): string => {
  const text = value?.trim() || emptyText;
  return escapeHtml(text).replace(/\r?\n/g, "<br>");
};

const attachmentsByField = (
  mistake: ExportMistakeItem,
  field: ExportAttachmentItem["field"]
): ExportAttachmentItem[] => mistake.attachments.filter((attachment) => attachment.field === field);

const renderReviewAttachment = (attachment: ExportAttachmentItem): string => {
  if (attachment.isImage) {
    if (attachment.imageDataUrl) {
      return `
        <figure class="image-attachment">
          <img src="${attachment.imageDataUrl}" alt="${escapeHtml(attachment.displayName)}">
          <figcaption>${escapeHtml(attachment.displayName)}</figcaption>
        </figure>
      `;
    }

    const message = attachment.imageEmbedError
      ? `${attachment.imageEmbedError}：${attachment.displayName}`
      : `图片附件加载失败：${attachment.displayName}`;
    return `<div class="attachment-card warning">${escapeHtml(message)}</div>`;
  }

  const description = attachment.exportedRelativePath
    ? "已随导出文件夹保存"
    : attachment.missingReason ?? "本次导出未包含附件";

  return `
    <div class="attachment-card">
      <strong>文件名：${escapeHtml(attachment.displayName)}</strong>
      <span>类型：${escapeHtml(attachment.displayType)}</span>
      <span>说明：${escapeHtml(description)}</span>
    </div>
  `;
};

const renderReviewAttachmentSection = (
  title: string,
  attachments: ExportAttachmentItem[]
): string => {
  if (attachments.length === 0) {
    return "";
  }

  return `
    <div class="attachments">
      <h4>${escapeHtml(title)}</h4>
      ${attachments.map(renderReviewAttachment).join("")}
    </div>
  `;
};

const renderKeywordTags = (keywords: string[]): string =>
  keywords.length > 0
    ? keywords.map((keyword) => `<span class="tag">${escapeHtml(keyword)}</span>`).join("")
    : `<span class="muted">暂无关键词</span>`;

const renderReviewLinkedMistakes = (mistake: ExportMistakeItem): string => {
  if (mistake.linkedMistakes.length === 0) {
    return "";
  }

  return `
    <section class="minor-block">
      <h3>关联错题</h3>
      <ul>
        ${mistake.linkedMistakes
          .map((linked, index) => `<li>关联题 ${index + 1}：${escapeHtml(linked.question)}</li>`)
          .join("")}
      </ul>
    </section>
  `;
};

const renderReviewMistake = (mistake: ExportMistakeItem): string => {
  const questionAttachments = attachmentsByField(mistake, "question");
  const answerAttachments = attachmentsByField(mistake, "answerAnalysis");
  const noteAttachments = attachmentsByField(mistake, "note");
  const generalAttachments = attachmentsByField(mistake, "general");
  const hasNote = Boolean(mistake.note?.trim()) || noteAttachments.length > 0;

  return `
    <article class="mistake">
      <header class="mistake-header">
        <h2>${escapeHtml(mistake.itemLabel)}</h2>
        <div class="meta-row"><span>路径</span><strong>${escapeHtml(
          mistake.nodePath.length > 0 ? mistake.nodePath.join(" / ") : "未分类"
        )}</strong></div>
        <div class="keyword-row">${renderKeywordTags(mistake.keywords)}</div>
      </header>

      <section class="main-block question-block">
        <h3>【题目】</h3>
        <p>${renderParagraphs(mistake.question, "暂无题目文本")}</p>
        ${renderReviewAttachmentSection("题目附件", questionAttachments)}
      </section>

      <section class="main-block answer-block">
        <h3>【答案和解析】</h3>
        <p>${renderParagraphs(mistake.answerAnalysis, "暂无答案和解析")}</p>
        ${renderReviewAttachmentSection("答案解析附件", answerAttachments)}
      </section>

      ${
        hasNote
          ? `<section class="minor-block">
              <h3>【备注】</h3>
              ${mistake.note?.trim() ? `<p>${renderParagraphs(mistake.note, "暂无备注")}</p>` : ""}
              ${renderReviewAttachmentSection("备注附件", noteAttachments)}
            </section>`
          : ""
      }

      ${
        generalAttachments.length > 0
          ? `<section class="minor-block">
              <h3>【历史附件】</h3>
              ${renderReviewAttachmentSection("历史附件", generalAttachments)}
            </section>`
          : ""
      }

      ${renderReviewLinkedMistakes(mistake)}
    </article>
  `;
};

const renderReviewHtml = (documentData: ExportDocumentData): string => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>MistVault 错题集</title>
    <style>
      @page { margin: 18mm 16mm; }
      body {
        color: #17202a;
        font-family: "Microsoft YaHei", "SimSun", Arial, sans-serif;
        font-size: 13px;
        line-height: 1.7;
        margin: 0;
      }
      h1 { font-size: 28px; margin: 0 0 6px; }
      h2 { font-size: 22px; margin: 0; }
      h3 { font-size: 16px; margin: 0 0 8px; }
      h4 { color: #526173; font-size: 13px; margin: 12px 0 8px; }
      p { margin: 0; overflow-wrap: anywhere; white-space: normal; }
      ul { margin: 8px 0 0; padding-left: 20px; }
      li { margin-bottom: 5px; overflow-wrap: anywhere; }
      .cover { border-bottom: 2px solid #1f2933; margin-bottom: 22px; padding-bottom: 12px; }
      .meta { color: #526173; }
      .mistake { break-after: page; padding-top: 4px; }
      .mistake:last-child { break-after: auto; }
      .mistake-header {
        background: #f6f8fb;
        border: 1px solid #d7dee8;
        border-radius: 8px;
        margin-bottom: 14px;
        padding: 14px 16px;
      }
      .meta-row {
        color: #526173;
        display: grid;
        gap: 8px;
        grid-template-columns: 46px 1fr;
        margin-top: 10px;
      }
      .keyword-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
      .tag {
        background: #eaf4ff;
        border: 1px solid #b8d9ff;
        border-radius: 999px;
        color: #235789;
        display: inline-block;
        font-size: 12px;
        padding: 2px 8px;
      }
      .main-block,
      .minor-block {
        border: 1px solid #d7dee8;
        border-radius: 8px;
        margin-bottom: 14px;
        padding: 14px 16px;
      }
      .question-block { border-left: 4px solid #2f6fed; }
      .answer-block { border-left: 4px solid #1f8a5f; }
      .minor-block { background: #fbfcfe; }
      .attachments { margin-top: 12px; }
      .image-attachment { break-inside: avoid; margin: 10px 0 14px; }
      .image-attachment img {
        display: block;
        max-height: 680px;
        max-width: 100%;
        object-fit: contain;
      }
      .image-attachment figcaption {
        color: #66768a;
        font-size: 12px;
        margin-top: 5px;
      }
      .attachment-card {
        background: #f8fafc;
        border: 1px solid #dbe3ed;
        border-radius: 6px;
        break-inside: avoid;
        display: grid;
        gap: 4px;
        margin: 8px 0;
        padding: 10px 12px;
      }
      .attachment-card span { color: #526173; }
      .warning { color: #9a3412; }
      .muted { color: #66768a; }
    </style>
  </head>
  <body>
    <header class="cover">
      <h1>MistVault 错题集</h1>
      <p class="meta">导出时间：${escapeHtml(formatDateTime(documentData.generatedAt))}</p>
    </header>
    ${documentData.mistakes.map(renderReviewMistake).join("")}
  </body>
</html>`;

export const writePdfExport = async (
  filePath: string,
  documentData: ExportDocumentData
): Promise<void> => {
  let window: BrowserWindow | null = null;

  try {
    window = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });

    const html = renderReviewHtml(documentData);
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await window.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      margins: {
        marginType: "default"
      }
    });
    await writeFile(filePath, pdf);
  } finally {
    window?.destroy();
  }
};
