import { writeFile } from "node:fs/promises";
import type {
  ExportAttachmentItem,
  ExportDocumentData,
  ExportMistakeItem
} from "../types";

const escapeMarkdownText = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/([\[\]])/g, "\\$1");

const escapeMarkdownInline = (value: string): string =>
  escapeMarkdownText(value).replace(/([`*_{}()#+.!|-])/g, "\\$1");

const linkTarget = (relativePath: string): string =>
  encodeURI(relativePath.replace(/\\/g, "/")).replace(/\(/g, "%28").replace(/\)/g, "%29");

const formatDateTime = (value: string): string => {
  const date = new Date(value);
  const pad = (part: number): string => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
};

const byField = (
  mistake: ExportMistakeItem,
  field: ExportAttachmentItem["field"]
): ExportAttachmentItem[] => mistake.attachments.filter((attachment) => attachment.field === field);

const renderAttachment = (attachment: ExportAttachmentItem): string => {
  const label = escapeMarkdownText(attachment.displayName);
  if (!attachment.exportedRelativePath) {
    return `- ${label}（${escapeMarkdownInline(
      attachment.missingReason ?? "本次导出未包含附件"
    )}）`;
  }

  const href = linkTarget(attachment.exportedRelativePath);
  if (attachment.isImage) {
    return `- ![${label}](${href})`;
  }

  return `- [${label}](${href})（${escapeMarkdownInline(attachment.displayType)}，已随导出文件夹保存）`;
};

const renderAttachmentBlock = (title: string, attachments: ExportAttachmentItem[]): string[] => {
  if (attachments.length === 0) {
    return [];
  }

  return [`### ${title}`, "", ...attachments.map(renderAttachment), ""];
};

const renderMistake = (mistake: ExportMistakeItem): string => {
  const noteAttachments = byField(mistake, "note");
  const hasNote = Boolean(mistake.note?.trim()) || noteAttachments.length > 0;
  const lines = [
    `## ${escapeMarkdownInline(mistake.itemLabel)}`,
    "",
    `- 路径：${escapeMarkdownInline(
      mistake.nodePath.length > 0 ? mistake.nodePath.join(" / ") : "未分类"
    )}`,
    `- 关键词：${
      mistake.keywords.length > 0
        ? mistake.keywords.map((keyword) => `\`${escapeMarkdownText(keyword)}\``).join(" ")
        : "暂无关键词"
    }`,
    "",
    "### 【题目】",
    "",
    mistake.question.trim() || "暂无题目文本",
    "",
    ...renderAttachmentBlock("题目附件", byField(mistake, "question")),
    "### 【答案和解析】",
    "",
    mistake.answerAnalysis?.trim() || "暂无答案和解析",
    "",
    ...renderAttachmentBlock("答案解析附件", byField(mistake, "answerAnalysis"))
  ];

  if (hasNote) {
    lines.push("### 【备注】", "", mistake.note?.trim() || "暂无备注", "");
    lines.push(...renderAttachmentBlock("备注附件", noteAttachments));
  }

  lines.push(...renderAttachmentBlock("历史附件", byField(mistake, "general")));

  if (mistake.linkedMistakes.length > 0) {
    lines.push("### 关联错题", "");
    lines.push(
      ...mistake.linkedMistakes.map(
        (linked, index) => `- 关联题 ${index + 1}：${escapeMarkdownText(linked.question)}`
      ),
      ""
    );
  }

  return lines.join("\n").trimEnd();
};

export const writeMarkdownExport = async (
  filePath: string,
  documentData: ExportDocumentData
): Promise<void> => {
  const content = [
    "# MistVault 错题集",
    "",
    `导出时间：${escapeMarkdownInline(formatDateTime(documentData.generatedAt))}`,
    "",
    ...documentData.mistakes.map(renderMistake),
    ""
  ].join("\n");

  await writeFile(filePath, content, "utf8");
};
