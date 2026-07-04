import { ipcMain } from "electron";
import { apiFail, apiOk, ipcChannels } from "@shared/types";
import { getNoopAiStatus } from "../extensions/ai/noopAiProvider";
import { getNoopOcrStatus } from "../extensions/ocr/noopOcrProvider";
import { getNoopReviewStatus } from "../extensions/review/noopReviewScheduler";
import type { AiService, ReviewService } from "../services";

const reviewUnavailable = () =>
  apiFail("REVIEW_NOT_AVAILABLE", "Review recommendations are unavailable until the database is ready.");

export const registerExtensionsIpc = (
  aiService: AiService | null = null,
  reviewService: ReviewService | null = null
): void => {
  ipcMain.handle(ipcChannels.extensionAiGetStatus, async () => {
    try {
      return aiService ? aiService.getStatus() : apiOk(getNoopAiStatus());
    } catch (error) {
      return apiFail("AI_STATUS_FAILED", "Failed to read AI extension status.", error);
    }
  });

  ipcMain.handle(
    ipcChannels.extensionAiExplainMistake,
    async (_event, mistakeId: string, userQuestion?: string) => {
      if (!aiService) {
        return apiFail("AI_NOT_CONFIGURED", "AI is unavailable until the database is ready.");
      }

      try {
        return await aiService.explainMistake(mistakeId, userQuestion);
      } catch {
        return apiFail("AI_UNKNOWN_ERROR", "AI explanation failed.");
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
