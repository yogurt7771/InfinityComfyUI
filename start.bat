@echo off
setlocal

cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo [Infinity ComfyUI] npm was not found. Please install Node.js first.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [Infinity ComfyUI] Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [Infinity ComfyUI] Dependency installation failed.
    pause
    exit /b 1
  )
)

echo [Infinity ComfyUI] Starting Electron desktop client
call npm run dev

pause
