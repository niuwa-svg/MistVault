import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electronPath = require("electron");
const bundleDirectory = await mkdtemp(join(tmpdir(), "mistvault-verify-bundle-"));
const outfile = join(bundleDirectory, "verify-db.cjs");

await build({
  entryPoints: [join(root, "scripts", "verify-db.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["better-sqlite3", "electron"],
  plugins: [
    {
      name: "shared-alias",
      setup(builder) {
        builder.onResolve({ filter: /^@shared\/types$/ }, () => ({
          path: join(root, "src", "shared", "types", "index.ts")
        }));
      }
    }
  ]
});

const result = spawnSync(electronPath, [outfile], {
  cwd: root,
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_PATH: join(root, "node_modules")
  },
  stdio: "inherit"
});

process.exit(result.status ?? 1);
