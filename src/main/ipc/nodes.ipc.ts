import { ipcMain } from "electron";
import { apiFail, ipcChannels } from "@shared/types";
import type { CreateNodeInput } from "@shared/types";
import type { NodeService } from "../services";

const unavailable = () =>
  apiFail("NODES_NOT_AVAILABLE", "Nodes are unavailable until the database is ready.");

export const registerNodesIpc = (nodeService: NodeService | null): void => {
  ipcMain.handle(ipcChannels.nodesListTree, async () => {
    if (!nodeService) {
      return unavailable();
    }

    return nodeService.listTree();
  });

  ipcMain.handle(ipcChannels.nodesCreate, async (_event, input: CreateNodeInput) => {
    if (!nodeService) {
      return unavailable();
    }

    return nodeService.create(input);
  });

  ipcMain.handle(ipcChannels.nodesRename, async (_event, id: string, name: string) => {
    if (!nodeService) {
      return unavailable();
    }

    return nodeService.rename(id, name);
  });

  ipcMain.handle(ipcChannels.nodesMove, async (_event, id: string, targetParentId: string | null) => {
    if (!nodeService) {
      return unavailable();
    }

    return nodeService.move(id, targetParentId);
  });

  ipcMain.handle(ipcChannels.nodesDelete, async (_event, id: string) => {
    if (!nodeService) {
      return unavailable();
    }

    return nodeService.softDelete(id);
  });

  ipcMain.handle(ipcChannels.nodesGetPath, async (_event, id: string) => {
    if (!nodeService) {
      return unavailable();
    }

    return nodeService.getPath(id);
  });
};
