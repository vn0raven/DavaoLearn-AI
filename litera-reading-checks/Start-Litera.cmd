@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  py -3.12 -m venv .venv
  if errorlevel 1 py -3.11 -m venv .venv
  if errorlevel 1 goto failed
)
if not exist ".venv\litera-checks-setup-v1" (
  ".venv\Scripts\python.exe" -m pip install -r backend\requirements.txt
  if errorlevel 1 goto failed
  echo ready > ".venv\litera-checks-setup-v1"
)
if not exist "frontend\dist\.basabridge-enhanced-build-v1" (
  call npm --prefix frontend ci
  if errorlevel 1 goto failed
  call npm --prefix frontend run build
  if errorlevel 1 goto failed
  echo Built from enhanced TypeScript sources > "frontend\dist\.basabridge-enhanced-build-v1"
)
echo Open http://127.0.0.1:8765 in Chrome or Edge. Keep this window open.
".venv\Scripts\python.exe" -m backend.server
if errorlevel 1 goto failed
exit /b 0
:failed
echo Setup failed. Check the messages above. Python 3.11 or 3.12 is required.
pause
exit /b 1
