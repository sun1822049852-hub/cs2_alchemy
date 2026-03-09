@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo [Start] Node desktop UI...
where node >nul 2>nul
if errorlevel 1 (
  echo [Error] node not found. Install Node.js or run run_py_legacy.bat
  pause
  exit /b 1
)

node main_ui_node_desktop.js
if errorlevel 1 (
  echo.
  echo [Hint] Node desktop failed. You can run run_py_legacy.bat
)
pause
