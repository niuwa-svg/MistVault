import { contextBridge } from "electron";
import { mistVaultApi } from "./api";

contextBridge.exposeInMainWorld("mistVault", mistVaultApi);
