@echo off
setlocal
cd /d "%~dp0"
title Litera - Reading Assessment Platform
if not exist ".env" (
  echo [SETUP NEEDED] Create .env before starting.
  echo In PowerShell: Copy-Item .env.example .env
  echo Then edit .env with your Gmail App Password and LITERA_TEACHER_KEY.
  goto failed
)
where npm >nul 2>&1
if errorlevel 1 (
  echo Node.js/npm is missing. Install Node.js 22.12+ then retry.
  goto failed
)
if not exist ".venv\Scripts\python.exe" (
  py -3.12 -m venv .venv
  if errorlevel 1 py -3.11 -m venv .venv
  if errorlevel 1 goto failed
)
echo Installing Python dependencies (first run may download speech model packages)...
".venv\Scripts\python.exe" -m pip install -r backend\requirements.txt
if errorlevel 1 goto failed
echo Installing frontend dependencies...
call npm --prefix frontend ci
if errorlevel 1 goto failed
echo Compiling frontend...
call npm --prefix frontend run build
if errorlevel 1 goto failed
echo.
echo ===================================================
echo Litera student: http://127.0.0.1:8765
echo Litera teacher: http://127.0.0.1:8765/teacher
echo Keep this terminal open. Press Ctrl+C to stop.
echo ===================================================
echo.
".venv\Scripts\python.exe" -m backend.server
if errorlevel 1 goto failed
exit /b 0
:failed
echo.
echo Setup or launch failed. Read README.md or copy the error shown above.
pause
exit /b 1
