import type { AttachmentField, EntityId, ExportFormat } from "@shared/types";

export type ExportAttachmentItem = {
  id: EntityId;
  field: AttachmentField;
  originalName: string;
  displayName: string;
  displayType: string;
  fieldLabel: string;
  mimeType: string;
  ext: string;
  size: number;
  exportedRelativePath: string | null;
  missingReason: string | null;
  isImage: boolean;
  imageDataUrl: string | null;
  imageEmbedError: string | null;
};

export type ExportMistakeItem = {
  id: EntityId;
  itemLabel: string;
  itemDirectoryName: string;
  question: string;
  answerAnalysis: string | null;
  note: string | null;
  keywords: string[];
  nodePath: string[];
  attachments: ExportAttachmentItem[];
  linkedMistakes: {
    id: EntityId;
    question: string;
  }[];
};

export type ExportDocumentData = {
  format: ExportFormat;
  generatedAt: string;
  mistakes: ExportMistakeItem[];
};
