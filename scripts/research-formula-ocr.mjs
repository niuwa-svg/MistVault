import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import Module from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const ts = require("typescript");
const originalResolveFilename = Module._resolveFilename;
const originalLoad = Module._load;

Module._resolveFilename = function resolveMistVaultTs(request, parent, isMain, options) {
  if (request === "@shared/types") {
    return join(root, "src", "shared", "types", "index.ts");
  }

  return originalResolveFilename.call(this, request, parent, isMain, options);
};

Module._load = function loadMistVaultStub(request, parent, isMain) {
  if (request === "electron") {
    return {
      app: {
        isPackaged: false
      }
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};

Module._extensions[".ts"] = (module, filename) => {
  const source = readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
  module._compile(output, filename);
};

const researchModule = require("./research-formula-ocr-node.ts");
await researchModule.default();
