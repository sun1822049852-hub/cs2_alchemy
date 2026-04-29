@echo off
setlocal
cd /d "%~dp0"
call ".\admin_console\tools\connectAdminConsole.cmd" %*
