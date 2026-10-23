@echo off
title SidePanel Preview (port 5199)
cd /d "%~dp0chrome-extension"
echo [INFO] Starting UI preview at http://localhost:5199/?scene=chat ...
echo [INFO] Close this window to stop. (This is ONLY the UI preview harness, not the agent server)
echo.
npx vite .preview --port 5199 --strictPort
pause
