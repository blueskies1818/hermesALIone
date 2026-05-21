@echo off
REM ============================================================================
REM Hermes ALIone — Start script (Windows Batch)
REM ============================================================================

setlocal enabledelayedexpansion

cd /d "%~dp0"

REM -- Check if gateway is already running on port 8642 ------------------------
netstat -ano 2>nul | findstr ":8642" >nul
if %errorlevel% equ 0 (
    echo Hermes Agent gateway is already running on port 8642.
    goto launch_desktop
)

echo Starting Hermes Agent gateway...
cd /d "%~dp0Agent"

REM -- Activate venv if present ------------------------------------------------
if exist ".venv\Scripts\activate.bat" (
    call .venv\Scripts\activate.bat
)

REM -- Start gateway in background ---------------------------------------------
start "" /B hermes gateway run >nul 2>&1

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
cd /d "%~dp0"

:launch_desktop
REM -- Start the desktop app in dev mode ---------------------------------------
cd /d "%~dp0Desktop"
echo Starting Hermes Desktop...
call npm run dev
pause
