import { writeFile } from "node:fs/promises";
import type {
  ExportAttachmentItem,
  ExportDocumentData,
  ExportMistakeItem
} from "../types";

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

const attachmentDescription = (attachment: ExportAttachmentItem): string => {
  if (attachment.exportedRelativePath) {
    return `${attachment.displayName}（${attachment.displayType}，已随导出文件夹保存：${attachment.exportedRelativePath}）`;
  }

  return `${attachment.displayName}（${attachment.displayType}，${
    attachment.missingReason ?? "本次导出未包含附件"
  }）`;
};

const renderAttachmentBlock = (title: string, attachments: ExportAttachmentItem[]): string[] => {
  if (attachments.length === 0) {
    return [];
  }

  return [
    `${title}：`,
    ...attachments.map((attachment) => `  - ${attachmentDescription(attachment)}`),
    ""
  ];
};

const renderMistake = (mistake: ExportMistakeItem): string => {
  const noteAttachments = byField(mistake, "note");
  const hasNote = Boolean(mistake.note?.trim()) || noteAttachments.length > 0;
  const lines = [
    mistake.itemLabel,
    `路径：${mistake.nodePath.length > 0 ? mistake.nodePath.join(" / ") : "未分类"}`,
    `关键词：${mistake.keywords.length > 0 ? mistake.keywords.join("、") : "暂无关键词"}`,
    "",
    "【题目】",
    mistake.question.trim() || "暂无题目文本",
    "",
    ...renderAttachmentBlock("题目附件", byField(mistake, "question")),
    "【答案和解析】",
    mistake.answerAnalysis?.trim() || "暂无答案和解析",
    "",
    ...renderAttachmentBlock("答案解析附件", byField(mistake, "answerAnalysis"))
  ];

  if (hasNote) {
    lines.push("【备注】", mistake.note?.trim() || "暂无备注", "");
    lines.push(...renderAttachmentBlock("备注附件", noteAttachments));
  }

  lines.push(...renderAttachmentBlock("历史附件", byField(mistake, "general")));

  if (mistake.linkedMistakes.length > 0) {
    lines.push("关联错题：");
    for (const [index, linked] of mistake.linkedMistakes.entries()) {
      lines.push(`  - 关联题 ${index + 1}：${linked.question}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
};

export const writeTxtExport = async (
  filePath: string,
  documentData: ExportDocumentData
): Promise<void> => {
  const content = [
    "MistVault 错题集",
    `导出时间：${formatDateTime(documentData.generatedAt)}`,
    "",
    ...documentData.mistakes.map(renderMistake),
    ""
  ].join("\n\n------------------------------------------------------------\n\n");

  await writeFile(filePath, content, "utf8");
};
