import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

export type OcrRuntimeStatus = {
  runtimePath: string;
  tessdataPath: string;
  tesseractExists: boolean;
  chiSimExists: boolean;
  engExists: boolean;
  engineVersion: string | null;
};

export type RapidOcrRuntimeStatus = {
  rootPath: string;
  helperPath: string;
  runtimePath: string;
  modelsPath: string;
  manifestPath: string;
  licensesPath: string;
  helperExists: boolean;
  runtimeExists: boolean;
  modelsExists: boolean;
  manifestExists: boolean;
  available: boolean;
  engineVersion: string | null;
};

export class OcrRuntimeService {
  constructor(private readonly appPath: string) {}

  getStatus(): OcrRuntimeStatus {
    const runtimePath = this.resolveTesseractRuntimePath();
    const tessdataPath = join(runtimePath, "tessdata");

    return {
      runtimePath,
      tessdataPath,
      tesseractExists: existsSync(join(runtimePath, "tesseract.exe")),
      chiSimExists: existsSync(join(tessdataPath, "chi_sim.traineddata")),
      engExists: existsSync(join(tessdataPath, "eng.traineddata")),
      engineVersion: this.readManifestVersion(join(runtimePath, "runtime-manifest.json"))
    };
  }

  getRapidOcrStatus(): RapidOcrRuntimeStatus {
    const rootPath = this.resolveRapidOcrRuntimePath();
    const helperPath = join(rootPath, "rapidocr-helper.exe");
    const runtimePath = join(rootPath, "runtime");
    const modelsPath = join(rootPath, "models");
    const manifestPath = join(rootPath, "runtime-manifest.json");
    const licensesPath = join(rootPath, "licenses");
    const helperExists = this.isFile(helperPath);
    const runtimeExists = this.isDirectory(runtimePath);
    const modelsExists = this.isDirectory(modelsPath);
    const manifestExists = this.isFile(manifestPath);

    return {
      rootPath,
      helperPath,
      runtimePath,
      modelsPath,
      manifestPath,
      licensesPath,
      helperExists,
      runtimeExists,
      modelsExists,
      manifestExists,
      available: helperExists && runtimeExists && modelsExists,
      engineVersion: this.readManifestVersion(manifestPath)
    };
  }

  private resolveTesseractRuntimePath(): string {
    if (app.isPackaged) {
      return join(process.resourcesPath, "ocr", "tesseract");
    }

    return join(this.appPath, "resources", "ocr", "tesseract");
  }

  private resolveRapidOcrRuntimePath(): string {
    if (app.isPackaged) {
      return join(process.resourcesPath, "ocr", "rapidocr");
    }

    return join(this.appPath, "resources", "ocr", "rapidocr");
  }

  private isFile(path: string): boolean {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  }

  private isDirectory(path: string): boolean {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  }

  private readManifestVersion(manifestPath: string): string | null {
    if (!existsSync(manifestPath)) {
      return null;
    }

    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        version?: unknown;
        engineVersion?: unknown;
        tesseractVersion?: unknown;
        rapidocrVersion?: unknown;
      };
      for (const value of [
        manifest.engineVersion,
        manifest.rapidocrVersion,
        manifest.tesseractVersion,
        manifest.version
      ]) {
        if (typeof value === "string" && value.trim()) {
          return value.trim();
        }
      }
    } catch {
      // Manifest parsing is diagnostic only and must not affect OCR availability.
    }

    return null;
  }
}
