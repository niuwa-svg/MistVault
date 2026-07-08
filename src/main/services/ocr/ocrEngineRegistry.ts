import type { OcrEngine, OcrEngineResult, OcrRecognizeInput, OcrRecognizeOptions } from "./types";

export class OcrEngineRegistry {
  constructor(
    private readonly rapidOcrEngine: OcrEngine,
    private readonly tesseractOcrEngine: OcrEngine
  ) {}

  async recognize(input: OcrRecognizeInput, options: OcrRecognizeOptions): Promise<OcrEngineResult> {
    if (this.rapidOcrEngine.isAvailable()) {
      const rapidResult = await this.rapidOcrEngine.recognize(input, options);
      if (rapidResult.ok) {
        return rapidResult;
      }
    }

    return this.tesseractOcrEngine.recognize(input, options);
  }
}
