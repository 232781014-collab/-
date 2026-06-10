@echo off
cd /d "%~dp0"

rem If already running, just open the page
powershell -NoProfile -Command "try { Invoke-RestMethod 'http://localhost:3001/health' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel%==0 goto open

if not exist logs mkdir logs
powershell -NoProfile -Command "Start-Process node -ArgumentList 'server/index.js' -WorkingDirectory '%~dp0.' -WindowStyle Hidden -RedirectStandardOutput 'logs\server.log' -RedirectStandardError 'logs\server.err.log'"

rem Wait for server ready (up to ~12s)
powershell -NoProfile -Command "for($i=0;$i -lt 15;$i++){ try{ Invoke-RestMethod 'http://localhost:3001/health' -TimeoutSec 2 | Out-Null; exit 0 }catch{ Start-Sleep -Milliseconds 800 } }; exit 1" >nul 2>&1
if %errorlevel% neq 0 (
  echo ERROR: server failed to start. See logs\server.err.log
  pause
  exit /b 1
)

:open
start "" http://localhost:3001
exit /b 0
