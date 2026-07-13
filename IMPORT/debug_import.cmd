@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "BASE=C:\Users\tetsu\Documents\Codex"
for /d %%D in ("%BASE%\*") do (
  if /I not "%%~nxD"=="2026-05-26" if /I not "%%~nxD"=="2026-05-27" (
    echo DIR=%%~fD
    if not exist "%%~fD\IMPORT" mkdir "%%~fD\IMPORT"
    pushd "%%~fD\IMPORT"
    echo CD=%CD%
    echo probe>probe.txt
    if exist probe.txt echo PROBE_OK
    popd
  )
)
