@echo off
title CineWall
cd /d "%~dp0"
echo Starting CineWall...
echo.
node server.js
if errorlevel 1 (
  echo.
  echo The cinema server could not start. Read the error above for details.
  echo Make sure Node.js is installed and close any older cinema window.
  pause
)
