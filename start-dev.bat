@echo off
setlocal

cd /d "%~dp0"

if not exist "node_modules\" (
  echo MistVault dependencies are not installed yet.
  echo Run "npm install" once in this folder, then double-click this file again.
  echo.
  pause
  exit /b 1
)

echo Starting MistVault development app...
echo.
npm run dev

if errorlevel 1 (
  echo.
  echo MistVault failed to start. Check the terminal output above.
  pause
)
