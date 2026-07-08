export type OcrEngineName = "rapidocr" | "tesseract";

export type OcrBlock = {
  text: string;
  confidence: number | null;
  box: Array<[number, number]> | null;
};

export type OcrEngineResult = {
  ok: boolean;
  engine: OcrEngineName;
  engineVersion: string | null;
  elapsedMs: number;
  text: string;
  blocks: OcrBlock[];
  warning: string | null;
  errorCode: string | null;
  message?: string;
};

export type OcrRecognizeInput = {
  absolutePath: string;
};

export type OcrRecognizeOptions = {
  timeoutMs: number;
};

export interface OcrEngine {
  readonly name: OcrEngineName;
  isAvailable(): boolean;
  recognize(input: OcrRecognizeInput, options: OcrRecognizeOptions): Promise<OcrEngineResult>;
}
