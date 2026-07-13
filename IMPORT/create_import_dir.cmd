@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "BASE=C:\Users\tetsu\Documents\Codex"
set "TARGET="
for /d %%D in ("%BASE%\*") do (
  if /I not "%%~nxD"=="2026-05-26" if /I not "%%~nxD"=="2026-05-27" set "TARGET=%%~fD"
)
if not defined TARGET exit /b 1
if not exist "!TARGET!\IMPORT" mkdir "!TARGET!\IMPORT"
if exist "!TARGET!\IMPORT" (
  echo !TARGET!\IMPORT
  exit /b 0
)
exit /b 1
