@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  py -3.12 -m venv .venv
  if errorlevel 1 py -3.11 -m venv .venv
  if errorlevel 1 goto failed
)
if not exist ".venv\voice-setup-v1" (
  ".venv\Scripts\python.exe" -m pip install -r voice\requirements.txt
  if errorlevel 1 goto failed
  echo ready > ".venv\voice-setup-v1"
)
echo Open http://127.0.0.1:8765 when the server starts.
".venv\Scripts\python.exe" -m voice.server
if errorlevel 1 goto failed
exit /b 0
:failed
echo Startup failed. Confirm Python 3.11 or 3.12 is installed.
pause
exit /b 1
