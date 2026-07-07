import { ipcMain } from "electron";
import { apiFail, apiOk, ipcChannels } from "@shared/types";
import type { AiExplainMistakeOptions, AttachmentTextScope } from "@shared/types";
import { getNoopAiStatus } from "../extensions/ai/noopAiProvider";
import { getNoopOcrStatus } from "../extensions/ocr/noopOcrProvider";
import { getNoopReviewStatus } from "../extensions/review/noopReviewScheduler";
import type {
  AiService,
  AiSessionService,
  AttachmentTextExtractionService,
  ReviewService
} from "../services";

const reviewUnavailable = () =>
  apiFail("REVIEW_NOT_AVAILABLE", "Review recommendations are unavailable until the database is ready.");

const extractionUnavailable = () =>
  apiFail(
    "EXTRACTION_NOT_AVAILABLE",
    "Attachment text extraction is unavailable until the database is ready."
  );

const attachmentTextScopes = new Set<AttachmentTextScope>([
  "none",
  "question",
  "answerAnalysis",
  "note",
  "all"
]);

const normalizeAiOptions = (options: unknown): AiExplainMistakeOptions => {
  if (!options || typeof options !== "object") {
    return { attachmentTextScope: "none" };
  }

  const scope = (options as { attachmentTextScope?: unknown }).attachmentTextScope;
  return {
    attachmentTextScope:
      typeof scope === "string" && attachmentTextScopes.has(scope as AttachmentTextScope)
        ? (scope as AttachmentTextScope)
        : "none"
  };
};

export const registerExtensionsIpc = (
  aiService: AiService | null = null,
  aiSessionService: AiSessionService | null = null,
  reviewService: ReviewService | null = null,
  attachmentTextExtractionService: AttachmentTextExtractionService | null = null
): void => {
  ipcMain.handle(ipcChannels.extensionAiGetStatus, async () => {
    try {
      return aiService ? aiService.getStatus() : apiOk(getNoopAiStatus());
    } catch (error) {
      return apiFail("AI_STATUS_FAILED", "Failed to read AI extension status.", error);
    }
  });

  ipcMain.handle(ipcChannels.extensionAiGetProviderCapabilities, async () => {
    if (!aiSessionService) {
      return apiFail("AI_NOT_CONFIGURED", "AI is unavailable until the database is ready.");
    }

    try {
      return aiSessionService.getProviderCapabilities();
    } catch (error) {
      return apiFail("AI_CAPABILITIES_FAILED", "Failed to read AI provider capabilities.", error);
    }
  });

  ipcMain.handle(
    ipcChannels.extensionAiExplainMistake,
    async (_event, mistakeId: string, userQuestion?: string, options?: unknown) => {
      if (!aiService) {
        return apiFail("AI_NOT_CONFIGURED", "AI is unavailable until the database is ready.");
      }

      try {
        return await aiService.explainMistake(mistakeId, userQuestion, normalizeAiOptions(options));
      } catch {
        return apiFail("AI_UNKNOWN_ERROR", "AI explanation failed.");
      }
    }
  );

  ipcMain.handle(ipcChannels.extensionAiSessionsList, async (_event, mistakeId: string) => {
    if (!aiSessionService) {
      return apiFail("AI_NOT_CONFIGURED", "AI is unavailable until the database is ready.");
    }

    return aiSessionService.listSessions(mistakeId);
  });

  ipcMain.handle(ipcChannels.extensionAiSessionsCreate, async (_event, mistakeId: string) => {
    if (!aiSessionService) {
      return apiFail("AI_NOT_CONFIGURED", "AI is unavailable until the database is ready.");
    }

    return aiSessionService.createSession(mistakeId);
  });

  ipcMain.handle(ipcChannels.extensionAiSessionsDelete, async (_event, sessionId: string) => {
    if (!aiSessionService) {
      return apiFail("AI_NOT_CONFIGURED", "AI is unavailable until the database is ready.");
    }

    return aiSessionService.deleteSession(sessionId);
  });

  ipcMain.handle(ipcChannels.extensionAiSessionMessagesList, async (_event, sessionId: string) => {
    if (!aiSessionService) {
      return apiFail("AI_NOT_CONFIGURED", "AI is unavailable until the database is ready.");
    }

    return aiSessionService.getSessionMessages(sessionId);
  });

  ipcMain.handle(
    ipcChannels.extensionAiSessionMessageSend,
    async (_event, sessionId: string, content: string) => {
      if (!aiSessionService) {
        return apiFail("AI_NOT_CONFIGURED", "AI is unavailable until the database is ready.");
      }

      try {
        return await aiSessionService.sendMessage(sessionId, content);
      } catch {
        return apiFail("AI_UNKNOWN_ERROR", "AI session message failed.");
      }
    }
  );

  ipcMain.handle(ipcChannels.extensionOcrGetStatus, async () => {
    try {
      return apiOk(getNoopOcrStatus());
    } catch (error) {
      return apiFail("OCR_STATUS_FAILED", "Failed to read OCR extension status.", error);
    }
  });

  ipcMain.handle(ipcChannels.extensionExtractionGetStatus, async (_event, attachmentId: string) => {
    if (!attachmentTextExtractionService) {
      return extractionUnavailable();
    }

    return attachmentTextExtractionService.getStatus(attachmentId);
  });

  ipcMain.handle(
    ipcChannels.extensionExtractionExtractAttachmentText,
    async (_event, attachmentId: string) => {
      if (!attachmentTextExtractionService) {
        return extractionUnavailable();
      }

      return attachmentTextExtractionService.extractAttachmentText(attachmentId);
    }
  );

  ipcMain.handle(
    ipcChannels.extensionExtractionGetExtractedText,
    async (_event, attachmentId: string) => {
      if (!attachmentTextExtractionService) {
        return extractionUnavailable();
      }

      return attachmentTextExtractionService.getExtractedText(attachmentId);
    }
  );

  ipcMain.handle(
    ipcChannels.extensionExtractionUpdateExtractedText,
    async (_event, attachmentId: string, text: string) => {
      if (!attachmentTextExtractionService) {
        return extractionUnavailable();
      }

      return attachmentTextExtractionService.updateExtractedText(attachmentId, text);
    }
  );

  ipcMain.handle(
    ipcChannels.extensionExtractionClearExtractedText,
    async (_event, attachmentId: string) => {
      if (!attachmentTextExtractionService) {
        return extractionUnavailable();
      }

      return attachmentTextExtractionService.clearExtractedText(attachmentId);
    }
  );

  ipcMain.handle(ipcChannels.extensionReviewGetStatus, async () => {
    try {
      if (!reviewService) {
        return apiOk(getNoopReviewStatus());
      }

      return apiOk({
        name: "review",
        enabled: true,
        status: "ready",
        message: "Review recommendations are available locally."
      });
    } catch (error) {
      return apiFail("REVIEW_STATUS_FAILED", "Failed to read review extension status.", error);
    }
  });

  ipcMain.handle(ipcChannels.extensionReviewGetToday, async () => {
    if (!reviewService) {
      return reviewUnavailable();
    }

    return reviewService.getTodayRecommendations();
  });

  ipcMain.handle(ipcChannels.extensionReviewMarkReviewed, async (_event, mistakeId: string) => {
    if (!reviewService) {
      return reviewUnavailable();
    }

    return reviewService.markReviewed(mistakeId);
  });
};
