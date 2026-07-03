import { ipcMain } from "electron";
import { apiFail, ipcChannels } from "@shared/types";
import type { CreateMistakeInput, SearchMistakesInput, UpdateMistakeInput } from "@shared/types";
import type { MistakeService } from "../services";

const unavailable = () =>
  apiFail("MISTAKES_NOT_AVAILABLE", "Mistakes are unavailable until the database is ready.");

export const registerMistakesIpc = (mistakeService: MistakeService | null): void => {
  ipcMain.handle(ipcChannels.mistakesListByNode, async (_event, nodeId: string | null) => {
    if (!mistakeService) {
      return unavailable();
    }

    return mistakeService.listByNode(nodeId);
  });

  ipcMain.handle(ipcChannels.mistakesGet, async (_event, id: string) => {
    if (!mistakeService) {
      return unavailable();
    }

    return mistakeService.get(id);
  });

  ipcMain.handle(ipcChannels.mistakesCreate, async (_event, input: CreateMistakeInput) => {
    if (!mistakeService) {
      return unavailable();
    }

    return mistakeService.create(input);
  });

  ipcMain.handle(
    ipcChannels.mistakesUpdate,
    async (_event, id: string, input: UpdateMistakeInput) => {
      if (!mistakeService) {
        return unavailable();
      }

      return mistakeService.update(id, input);
    }
  );

  ipcMain.handle(ipcChannels.mistakesDelete, async (_event, id: string) => {
    if (!mistakeService) {
      return unavailable();
    }

    return mistakeService.softDelete(id);
  });

  ipcMain.handle(ipcChannels.mistakesMove, async (_event, id: string, targetNodeId: string) => {
    if (!mistakeService) {
      return unavailable();
    }

    return mistakeService.move(id, targetNodeId);
  });

  ipcMain.handle(ipcChannels.mistakesLink, async (_event, sourceId: string, targetId: string) => {
    if (!mistakeService) {
      return unavailable();
    }

    return mistakeService.link(sourceId, targetId);
  });

  ipcMain.handle(ipcChannels.mistakesUnlink, async (_event, sourceId: string, targetId: string) => {
    if (!mistakeService) {
      return unavailable();
    }

    return mistakeService.unlink(sourceId, targetId);
  });

  ipcMain.handle(ipcChannels.mistakesListLinks, async (_event, id: string) => {
    if (!mistakeService) {
      return unavailable();
    }

    return mistakeService.listLinks(id);
  });

  ipcMain.handle(ipcChannels.mistakesSearch, async (_event, input: SearchMistakesInput) => {
    if (!mistakeService) {
      return unavailable();
    }

    return mistakeService.search(input);
  });
};
