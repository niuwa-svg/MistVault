import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const devRuntimeDir = join(projectRoot, "resources", "ocr", "tesseract");
const packagedRuntimeDir =
  typeof process.resourcesPath === "string"
    ? join(process.resourcesPath, "ocr", "tesseract")
    : null;

const runtimeDir =
  packagedRuntimeDir && existsSync(join(packagedRuntimeDir, "tesseract.exe"))
    ? packagedRuntimeDir
    : devRuntimeDir;

const tesseractPath = join(runtimeDir, "tesseract.exe");
const tessdataPath = join(runtimeDir, "tessdata");
const defaultImagePath = join(projectRoot, "resources", "ocr", "fixtures", "phase0-zh-en.png");
const imagePath = resolve(process.argv[2] ?? defaultImagePath);

const redact = (value) =>
  String(value)
    .replaceAll(projectRoot, "<project>")
    .replaceAll(runtimeDir, "<ocr-runtime>")
    .replaceAll(imagePath, "<input-image>");

const fail = (code, message, details) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        code,
        message,
        details: details ? redact(details) : undefined
      },
      null,
      2
    )
  );
  process.exitCode = 1;
};

if (!existsSync(tesseractPath)) {
  fail("OCR_RUNTIME_MISSING", "Built-in tesseract.exe was not found.");
} else if (!existsSync(join(tessdataPath, "chi_sim.traineddata"))) {
  fail("OCR_LANGUAGE_MISSING", "chi_sim.traineddata was not found.");
} else if (!existsSync(join(tessdataPath, "eng.traineddata"))) {
  fail("OCR_LANGUAGE_MISSING", "eng.traineddata was not found.");
} else if (!existsSync(imagePath)) {
  fail("OCR_FIXTURE_MISSING", "OCR fixture image was not found.");
} else {
  let child;
  try {
    child = spawn(
      tesseractPath,
      [imagePath, "stdout", "-l", "chi_sim+eng", "--tessdata-dir", tessdataPath],
      {
        cwd: runtimeDir,
        env: {
          SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
          WINDIR: process.env.WINDIR ?? "C:\\Windows",
          TEMP: process.env.TEMP ?? "",
          TMP: process.env.TMP ?? ""
        },
        windowsHide: true,
        timeout: 30_000
      }
    );
  } catch (error) {
    fail("OCR_PROCESS_FAILED", "Failed to start built-in OCR runtime.", error.message);
    process.exit();
  }

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.on("error", (error) => {
    fail("OCR_PROCESS_FAILED", "Failed to start built-in OCR runtime.", error.message);
  });
  child.on("close", (code, signal) => {
    if (signal) {
      fail("OCR_TIMEOUT", "Built-in OCR runtime timed out.", signal);
      return;
    }

    if (code !== 0) {
      fail("OCR_FAILED", "Built-in OCR runtime exited with an error.", stderr);
      return;
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          runtime: "<ocr-runtime>",
          language: "chi_sim+eng",
          text: stdout.trim(),
          warning: stderr.trim() ? redact(stderr.trim()) : null
        },
        null,
        2
      )
    );
  });
}
