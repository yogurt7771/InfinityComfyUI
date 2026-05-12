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

echo [Infinity ComfyUI] Starting browser version at http://127.0.0.1:5173
start "" powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:5173'"

call npm run dev -- --host 127.0.0.1 --port 5173

pause
