import { ipcMain } from "electron";
import { apiFail, ipcChannels } from "@shared/types";
import type { WritableAttachmentField } from "@shared/types";
import type { AttachmentService } from "../services";

const unavailable = () =>
  apiFail("ATTACHMENTS_NOT_AVAILABLE", "Attachments are unavailable until the database is ready.");

export const registerAttachmentsIpc = (attachmentService: AttachmentService | null): void => {
  ipcMain.handle(ipcChannels.attachmentsChooseFiles, async () => {
    if (!attachmentService) {
      return unavailable();
    }

    return attachmentService.chooseFiles();
  });

  ipcMain.handle(
    ipcChannels.attachmentsAddToMistake,
    async (_event, mistakeId: string, field: WritableAttachmentField, tokens: string[]) => {
      if (!attachmentService) {
        return unavailable();
      }

      return attachmentService.addToMistake(mistakeId, field, tokens);
    }
  );

  ipcMain.handle(ipcChannels.attachmentsListByMistake, async (_event, mistakeId: string) => {
    if (!attachmentService) {
      return unavailable();
    }

    return attachmentService.listForMistake(mistakeId);
  });

  ipcMain.handle(ipcChannels.attachmentsOpen, async (_event, attachmentId: string) => {
    if (!attachmentService) {
      return unavailable();
    }

    return attachmentService.openAttachment(attachmentId);
  });

  ipcMain.handle(ipcChannels.attachmentsRemove, async (_event, attachmentId: string) => {
    if (!attachmentService) {
      return unavailable();
    }

    return attachmentService.removeAttachment(attachmentId);
  });

  ipcMain.handle(ipcChannels.attachmentsGetPreview, async (_event, attachmentId: string) => {
    if (!attachmentService) {
      return unavailable();
    }

    return attachmentService.getPreview(attachmentId);
  });
};
