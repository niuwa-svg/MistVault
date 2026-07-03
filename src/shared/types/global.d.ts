import type { MistVaultApi } from "./ipc";

declare global {
  interface Window {
    mistVault: MistVaultApi;
  }
}

export {};
