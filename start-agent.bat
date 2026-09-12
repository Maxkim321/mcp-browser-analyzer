@echo off
title Agent Server (port 9999)

cd /d "%~dp0agent-server"

if not exist ".env" (
  echo [ERROR] agent-server\.env not found.
  echo         Please set ARK_API_KEY / ARK_BASE_URL / ARK_MODEL first.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [INFO] Installing dependencies ...
  call pnpm install
)

echo [INFO] Starting Agent Server ... close this window to stop.
echo.
node src/index.js

echo.
echo [INFO] Server stopped. Press any key to exit.
pause >nul
