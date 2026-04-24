@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo [Start] Node desktop UI (dev)...
powershell -ExecutionPolicy Bypass -File ".\scripts\start-client-dev.ps1" %*
if errorlevel 1 (
  echo [Error] Node desktop dev launcher failed.
)
pause
