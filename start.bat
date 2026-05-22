@echo off
REM ============================================================================
REM Hermes ALIone — Start script (Windows Batch)
REM ============================================================================

setlocal enabledelayedexpansion

cd /d "%~dp0"

cd /d "%~dp0Agent"

REM -- Activate venv if present ------------------------------------------------
if exist ".venv\Scripts\activate.bat" (
    call .venv\Scripts\activate.bat
)

REM -- Check if gateway is already running on port 8642 ------------------------
netstat -ano 2>nul | findstr ":8642" >nul
if %errorlevel% equ 0 (
    echo Hermes Agent gateway is already running on port 8642.
    goto check_dashboard
)

echo Starting Hermes Agent gateway...

REM -- Enable API server so port 8642 opens ------------------------------------
set API_SERVER_ENABLED=true

REM -- Start gateway in background (--replace clears stale PID files) ----------
start "" /B hermes gateway run --replace >nul 2>&1

REM -- Wait for gateway to become ready (up to 30s) ----------------------------
echo Waiting for gateway to become ready...
for /l %%i in (1,1,30) do (
    timeout /t 1 /nobreak >nul
    netstat -ano 2>nul | findstr ":8642" >nul
    if !errorlevel! equ 0 goto gateway_ready
)
echo Warning: Gateway may still be starting -- check logs in %%USERPROFILE%%\.hermes\logs\

:gateway_ready
echo Gateway is ready.

:check_dashboard
REM -- Check if dashboard REST API is already running on port 9119 -------------
netstat -ano 2>nul | findstr ":9119" >nul
if %errorlevel% equ 0 (
    echo Hermes dashboard already running on port 9119.
    goto launch_desktop
)

echo Starting Hermes dashboard (REST API on port 9119)...
set HERMES_LOG=%USERPROFILE%\.hermes\logs\dashboard.log
start "" /B hermes dashboard --no-open --skip-build >>"%HERMES_LOG%" 2>&1

REM -- Wait for dashboard to become ready (up to 45s) --------------------------
echo Waiting for dashboard to become ready...
for /l %%i in (1,1,45) do (
    timeout /t 1 /nobreak >nul
    netstat -ano 2>nul | findstr ":9119" >nul
    if !errorlevel! equ 0 goto dashboard_ready
)
echo.
echo ERROR: Dashboard did not start on port 9119 after 45 seconds.
echo Check the log for details: %USERPROFILE%\.hermes\logs\dashboard.log
echo.
pause
exit /b 1

:dashboard_ready
echo Dashboard is ready.
cd /d "%~dp0"

:launch_desktop
REM -- Start the desktop app in dev mode ---------------------------------------
cd /d "%~dp0Desktop"
echo Starting Hermes Desktop...
call npm run dev
pause
