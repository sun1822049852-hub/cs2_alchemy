@echo off
setlocal

set "JSON_PATH=%~1"
set "DB_PATH=%~2"

if "%DB_PATH%"=="" set "DB_PATH=%~dp0csgo_skins.db"

if "%JSON_PATH%"=="" (
  node "%~dp0tools\fetchAndRebuildSkinDb.js" --db "%DB_PATH%"
) else (
  node "%~dp0tools\fetchAndRebuildSkinDb.js" --json "%JSON_PATH%" --db "%DB_PATH%"
)

endlocal
