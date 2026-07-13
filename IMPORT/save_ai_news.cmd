@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "BASE=C:\Users\tetsu\Documents\Codex"
set "TARGET="
for /d %%D in ("%BASE%\*") do (
  if /I not "%%~nxD"=="2026-05-26" if /I not "%%~nxD"=="2026-05-27" set "TARGET=%%~fD"
)
if not defined TARGET exit /b 1
if not exist "!TARGET!\IMPORT" mkdir "!TARGET!\IMPORT"
pushd "!TARGET!\IMPORT" || exit /b 1
copy /y "%~dp0ai-news-2026-05-29.json" "ai-news-2026-05-29.json" >nul
copy /y "%~dp0ai-news-2026-05-29.json" "ai-news-latest.json" >nul
if exist "ai-news-2026-05-29.json" if exist "ai-news-latest.json" (
  popd
  echo SAVED
  exit /b 0
)
popd
exit /b 1
