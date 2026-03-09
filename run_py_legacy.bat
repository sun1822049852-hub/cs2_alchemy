@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo [Start] Python legacy UI...
.venv\Scripts\python.exe main_ui.py
pause
