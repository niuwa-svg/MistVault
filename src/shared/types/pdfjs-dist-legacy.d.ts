declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export function getDocument(params: {
    data: Uint8Array;
    useWorkerFetch: boolean;
    isEvalSupported: boolean;
    disableFontFace: boolean;
    stopAtErrors: boolean;
  }): {
    promise: Promise<{
      numPages: number;
      getPage(pageNumber: number): Promise<{
        getTextContent(): Promise<{
          items: Array<
            | {
                str: string;
                hasEOL?: boolean;
              }
            | {
                type: string;
              }
          >;
        }>;
        cleanup(): boolean;
      }>;
      destroy(): Promise<void>;
    }>;
  };
}
