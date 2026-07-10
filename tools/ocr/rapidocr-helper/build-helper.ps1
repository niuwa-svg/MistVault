param(
  [string]$WorkDir = "E:\develop\mistvault-rapidocr-build",
  [string]$OutputDir = "",
  [string]$PythonCommand = "py",
  [string]$PythonVersion = "-3.12"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir "..\..\..")
if (-not $OutputDir) {
  $OutputDir = Join-Path $projectRoot "resources\ocr\rapidocr"
}

$workPath = [System.IO.Path]::GetFullPath($WorkDir)
$outputPath = [System.IO.Path]::GetFullPath($OutputDir)
$venvPath = Join-Path $workPath ".venv"
$pipCachePath = Join-Path $workPath "pip-cache"
$buildPath = Join-Path $workPath "pyinstaller-build"
$distPath = Join-Path $workPath "pyinstaller-dist"
$helperSource = Join-Path $scriptDir "rapidocr_helper.py"
$requirementsPath = Join-Path $scriptDir "requirements.txt"

New-Item -ItemType Directory -Force -Path $workPath, $pipCachePath, $buildPath, $distPath, $outputPath | Out-Null

if (-not (Test-Path -LiteralPath (Join-Path $venvPath "Scripts\python.exe"))) {
  if ($PythonVersion) {
    & $PythonCommand $PythonVersion -m venv $venvPath
  } else {
    & $PythonCommand -m venv $venvPath
  }
}

$pythonExe = Join-Path $venvPath "Scripts\python.exe"
$env:PIP_CACHE_DIR = $pipCachePath
$env:PYTHONUTF8 = "1"
$env:PYINSTALLER_CONFIG_DIR = Join-Path $workPath "pyinstaller-cache"

& $pythonExe -m pip install --upgrade pip
& $pythonExe -m pip install -r $requirementsPath

$rapidOcrPackage = (& $pythonExe -c "import rapidocr, pathlib; print(pathlib.Path(rapidocr.__file__).resolve().parent)").Trim()
$sitePackages = Split-Path -Parent $rapidOcrPackage
$modelsSource = Join-Path $rapidOcrPackage "models"
if (-not (Test-Path -LiteralPath $modelsSource)) {
  & $pythonExe -c "from rapidocr.utils.download_models import download_models; download_models()"
}
if (-not (Test-Path -LiteralPath $modelsSource)) {
  throw "RapidOCR models directory was not found in the build venv."
}

foreach ($generatedPath in @(
  (Join-Path $outputPath "rapidocr-helper.exe"),
  (Join-Path $outputPath "runtime"),
  (Join-Path $outputPath "models"),
  (Join-Path $outputPath "licenses"),
  (Join-Path $outputPath "runtime-manifest.json")
)) {
  if (Test-Path -LiteralPath $generatedPath) {
    Remove-Item -LiteralPath $generatedPath -Recurse -Force
  }
}

& $pythonExe -m PyInstaller `
  --noconfirm `
  --clean `
  --onedir `
  --name rapidocr-helper `
  --contents-directory runtime `
  --distpath $distPath `
  --workpath $buildPath `
  --specpath $buildPath `
  --exclude-module rapidocr `
  --exclude-module onnxruntime `
  --exclude-module cv2 `
  --exclude-module numpy `
  --exclude-module PIL `
  --exclude-module shapely `
  --exclude-module pyclipper `
  --exclude-module yaml `
  --exclude-module omegaconf `
  --exclude-module requests `
  --exclude-module tqdm `
  --exclude-module colorlog `
  --hidden-import platform `
  $helperSource

$builtRoot = Join-Path $distPath "rapidocr-helper"
$builtExe = Join-Path $builtRoot "rapidocr-helper.exe"
if (-not (Test-Path -LiteralPath $builtExe)) {
  throw "PyInstaller did not produce rapidocr-helper.exe."
}

Copy-Item -LiteralPath $builtExe -Destination (Join-Path $outputPath "rapidocr-helper.exe") -Force
Copy-Item -LiteralPath (Join-Path $builtRoot "runtime") -Destination $outputPath -Recurse -Force
Copy-Item -LiteralPath $modelsSource -Destination $outputPath -Recurse -Force

$runtimeHelper = Join-Path $outputPath "runtime\helper"
New-Item -ItemType Directory -Force -Path $runtimeHelper | Out-Null
Copy-Item -LiteralPath $helperSource -Destination (Join-Path $runtimeHelper "rapidocr_helper.py") -Force

$pythonBase = (& $pythonExe -c "import sys; print(sys.base_prefix)").Trim()
$runtimePython = Join-Path $outputPath "runtime\python"
New-Item -ItemType Directory -Force -Path $runtimePython | Out-Null
Copy-Item -LiteralPath (Join-Path $pythonBase "python.exe") -Destination $runtimePython -Force
Get-ChildItem -LiteralPath $pythonBase -File | Where-Object { $_.Name -like "*.dll" -or $_.Name -like "*.zip" } | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $runtimePython -Force
}
Copy-Item -LiteralPath (Join-Path $pythonBase "DLLs") -Destination $runtimePython -Recurse -Force
Copy-Item -LiteralPath (Join-Path $pythonBase "Lib") -Destination $runtimePython -Recurse -Force
Remove-Item -LiteralPath (Join-Path $runtimePython "Lib\site-packages") -Recurse -Force -ErrorAction SilentlyContinue

$runtimeSitePackages = Join-Path $outputPath "runtime\site-packages"
New-Item -ItemType Directory -Force -Path $runtimeSitePackages | Out-Null
$runtimePackageNames = @(
  "antlr4",
  "antlr4_python3_runtime-4.9.3.dist-info",
  "certifi",
  "certifi-2026.6.17.dist-info",
  "charset_normalizer",
  "charset_normalizer-3.4.9.dist-info",
  "colorama",
  "colorama-0.4.6.dist-info",
  "colorlog",
  "colorlog-6.10.1.dist-info",
  "cv2",
  "flatbuffers",
  "flatbuffers-25.12.19.dist-info",
  "google",
  "idna",
  "idna-3.18.dist-info",
  "numpy",
  "numpy-2.5.1.dist-info",
  "numpy.libs",
  "omegaconf",
  "omegaconf-2.3.1.dist-info",
  "onnxruntime",
  "onnxruntime-1.27.0.dist-info",
  "opencv_python-5.0.0.93.dist-info",
  "packaging",
  "packaging-26.2.dist-info",
  "PIL",
  "pillow-11.3.0.dist-info",
  "protobuf-7.35.1.dist-info",
  "pyclipper",
  "pyclipper-1.4.0.dist-info",
  "pyyaml-6.0.3.dist-info",
  "rapidocr",
  "rapidocr-3.9.1.dist-info",
  "requests",
  "requests-2.34.2.dist-info",
  "shapely",
  "shapely-2.1.2.dist-info",
  "shapely.libs",
  "six-1.17.0.dist-info",
  "six.py",
  "tqdm",
  "tqdm-4.68.4.dist-info",
  "urllib3",
  "urllib3-2.7.0.dist-info",
  "yaml"
)
foreach ($name in $runtimePackageNames) {
  $source = Join-Path $sitePackages $name
  if (Test-Path -LiteralPath $source) {
    Copy-Item -LiteralPath $source -Destination $runtimeSitePackages -Recurse -Force
  }
}
$duplicatedModels = Join-Path $runtimeSitePackages "rapidocr\models"
if (Test-Path -LiteralPath $duplicatedModels) {
  Remove-Item -LiteralPath $duplicatedModels -Recurse -Force
}

$licensesPath = Join-Path $outputPath "licenses"
New-Item -ItemType Directory -Force -Path $licensesPath | Out-Null
$licenseCandidates = @(
  "rapidocr-3.9.1.dist-info\METADATA",
  "onnxruntime\LICENSE",
  "onnxruntime\ThirdPartyNotices.txt",
  "opencv_python-5.0.0.93.dist-info\LICENSE.txt",
  "opencv_python-5.0.0.93.dist-info\LICENSE-3RD-PARTY.txt",
  "protobuf-7.35.1.dist-info\LICENSE",
  "six-1.17.0.dist-info\LICENSE"
)
foreach ($relative in $licenseCandidates) {
  $candidate = Join-Path $sitePackages $relative
  if (Test-Path -LiteralPath $candidate) {
    $safeName = ($relative -replace '[\\/]', '_')
    Copy-Item -LiteralPath $candidate -Destination (Join-Path $licensesPath $safeName) -Force
  }
}

$modelFiles = Get-ChildItem -LiteralPath (Join-Path $outputPath "models") -File -Filter "*.onnx" | Sort-Object Name
$runtimeFiles = Get-ChildItem -LiteralPath (Join-Path $outputPath "runtime") -Recurse -File
$helperFile = Get-Item -LiteralPath (Join-Path $outputPath "rapidocr-helper.exe")
$manifest = [ordered]@{
  name = "MistVault RapidOCR local runtime"
  engine = "rapidocr"
  engineVersion = (& $pythonExe -c "import importlib.metadata; print(importlib.metadata.version('rapidocr'))").Trim()
  buildTool = "PyInstaller"
  generatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  layout = @{
    helper = "rapidocr-helper.exe"
    runtime = "runtime/"
    python = "runtime/python/"
    sitePackages = "runtime/site-packages/"
    helperScript = "runtime/helper/rapidocr_helper.py"
    models = "models/"
    licenses = "licenses/"
  }
  models = @($modelFiles | ForEach-Object {
    [ordered]@{
      file = "models/$($_.Name)"
      sizeBytes = $_.Length
    }
  })
  sizeBytes = @{
    helper = $helperFile.Length
    models = ($modelFiles | Measure-Object -Property Length -Sum).Sum
    runtime = ($runtimeFiles | Measure-Object -Property Length -Sum).Sum
    total = ((Get-ChildItem -LiteralPath $outputPath -Recurse -File | Measure-Object -Property Length -Sum).Sum)
  }
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $outputPath "runtime-manifest.json") -Encoding UTF8

Write-Host "RapidOCR helper runtime generated:"
Write-Host "  OutputDir: $outputPath"
Write-Host "  Helper MB: $([Math]::Round($manifest.sizeBytes.helper / 1MB, 2))"
Write-Host "  Models MB: $([Math]::Round($manifest.sizeBytes.models / 1MB, 2))"
Write-Host "  Runtime MB: $([Math]::Round($manifest.sizeBytes.runtime / 1MB, 2))"
Write-Host "  Total MB: $([Math]::Round($manifest.sizeBytes.total / 1MB, 2))"
