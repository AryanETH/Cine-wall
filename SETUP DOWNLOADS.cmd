@echo off
title CineWall Download Tools
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-download-tools.ps1" -Update
if errorlevel 1 (
  echo Download tool setup failed. Read the message above and try again.
) else (
  echo Download tools are ready. Start or restart CineWall.
)
pause
