import { writeFile } from "node:fs/promises";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun
} from "docx";
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

const paragraph = (text: string): Paragraph =>
  new Paragraph({
    children: [new TextRun(text)]
  });

const heading = (text: string, level: typeof HeadingLevel.HEADING_1): Paragraph =>
  new Paragraph({
    heading: level,
    children: [new TextRun(text)]
  });

const byField = (
  mistake: ExportMistakeItem,
  field: ExportAttachmentItem["field"]
): ExportAttachmentItem[] => mistake.attachments.filter((attachment) => attachment.field === field);

const renderAttachmentParagraphs = (
  title: string,
  attachments: ExportAttachmentItem[]
): Paragraph[] => {
  if (attachments.length === 0) {
    return [];
  }

  return [
    heading(title, HeadingLevel.HEADING_3),
    ...attachments.map((attachment) =>
      paragraph(
        attachment.exportedRelativePath
          ? `${attachment.displayName}（${attachment.displayType}，已随导出文件夹保存：${attachment.exportedRelativePath}）`
          : `${attachment.displayName}（${attachment.displayType}，${
              attachment.missingReason ?? "本次导出未包含附件"
            }）`
      )
    )
  ];
};

const renderMistake = (mistake: ExportMistakeItem): Paragraph[] => {
  const noteAttachments = byField(mistake, "note");
  const hasNote = Boolean(mistake.note?.trim()) || noteAttachments.length > 0;
  const children = [
    heading(mistake.itemLabel, HeadingLevel.HEADING_2),
    paragraph(`路径：${mistake.nodePath.length > 0 ? mistake.nodePath.join(" / ") : "未分类"}`),
    paragraph(`关键词：${mistake.keywords.length > 0 ? mistake.keywords.join("、") : "暂无关键词"}`),
    heading("【题目】", HeadingLevel.HEADING_3),
    paragraph(mistake.question.trim() || "暂无题目文本"),
    ...renderAttachmentParagraphs("题目附件", byField(mistake, "question")),
    heading("【答案和解析】", HeadingLevel.HEADING_3),
    paragraph(mistake.answerAnalysis?.trim() || "暂无答案和解析"),
    ...renderAttachmentParagraphs("答案解析附件", byField(mistake, "answerAnalysis"))
  ];

  if (hasNote) {
    children.push(heading("【备注】", HeadingLevel.HEADING_3));
    children.push(paragraph(mistake.note?.trim() || "暂无备注"));
    children.push(...renderAttachmentParagraphs("备注附件", noteAttachments));
  }

  children.push(...renderAttachmentParagraphs("历史附件", byField(mistake, "general")));

  if (mistake.linkedMistakes.length > 0) {
    children.push(heading("关联错题", HeadingLevel.HEADING_3));
    let index = 1;
    for (const linked of mistake.linkedMistakes) {
      children.push(paragraph(`关联题 ${index}：${linked.question}`));
      index += 1;
    }
  }

  return children;
};

export const writeDocxExport = async (
  filePath: string,
  documentData: ExportDocumentData
): Promise<void> => {
  const children = [
    heading("MistVault 错题集", HeadingLevel.HEADING_1),
    paragraph(`导出时间：${formatDateTime(documentData.generatedAt)}`),
    ...documentData.mistakes.flatMap(renderMistake)
  ];

  const document = new Document({
    sections: [{
      properties: {},
      children
    }]
  });
  const buffer = await Packer.toBuffer(document);
  await writeFile(filePath, buffer);
};
