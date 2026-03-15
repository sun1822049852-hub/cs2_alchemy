@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo [Start] Node desktop UI...
where node >nul 2>nul
if errorlevel 1 (
  echo [Error] node not found. Please install Node.js 18+ first.
  pause
  exit /b 1
)

node main_ui_node_desktop.js
if errorlevel 1 (
  echo [Error] Node desktop failed.
)
pause
