@echo off
title CineWall
cd /d "%~dp0"
node server.js
if errorlevel 1 (
  echo.
  echo The cinema server could not start. Read the error above for details.
  echo If another cinema window is open, close it and try again.
  pause
)
