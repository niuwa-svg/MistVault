import { existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

export type OcrRuntimeStatus = {
  runtimePath: string;
  tessdataPath: string;
  tesseractExists: boolean;
  chiSimExists: boolean;
  engExists: boolean;
};

export class OcrRuntimeService {
  constructor(private readonly appPath: string) {}

  getStatus(): OcrRuntimeStatus {
    const runtimePath = this.resolveRuntimePath();
    const tessdataPath = join(runtimePath, "tessdata");

    return {
      runtimePath,
      tessdataPath,
      tesseractExists: existsSync(join(runtimePath, "tesseract.exe")),
      chiSimExists: existsSync(join(tessdataPath, "chi_sim.traineddata")),
      engExists: existsSync(join(tessdataPath, "eng.traineddata"))
    };
  }

  private resolveRuntimePath(): string {
    if (app.isPackaged) {
      return join(process.resourcesPath, "ocr", "tesseract");
    }

    return join(this.appPath, "resources", "ocr", "tesseract");
  }
}
