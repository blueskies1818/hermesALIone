@echo off
REM ============================================================================
REM Hermes ALIone -- Install script (Windows Batch)
REM ============================================================================
REM Run by double-clicking or from Command Prompt:
REM   install.bat
REM ============================================================================

setlocal enabledelayedexpansion

echo ========================================================
echo   Hermes ALIone -- Install (Windows)
echo ========================================================
echo.

REM -- Check prerequisites ------------------------------------------------------
echo Checking prerequisites...

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo Missing: Node.js -- install from https://nodejs.org
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do echo   node %%i

where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo Missing: npm -- install Node.js from https://nodejs.org
    exit /b 1
)
for /f "tokens=*" %%i in ('npm -v') do echo   npm %%i

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo Missing: Python 3.11+ -- install from https://python.org
    exit /b 1
)
for /f "tokens=*" %%i in ('python --version 2^>^&1') do echo   python %%i

where uv >nul 2>&1
if %errorlevel% neq 0 (
    echo Missing: uv -- install with: powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
    exit /b 1
)
for /f "tokens=*" %%i in ('uv --version 2^>^&1') do echo   uv %%i
echo.

REM -- Install Agent ------------------------------------------------------------
echo Installing Agent dependencies...
cd /d "%~dp0Agent"

if not exist ".venv\" (
    uv venv --python 3.11
)
call .venv\Scripts\activate.bat
uv pip install -e ".[all]"

if not exist ".env" (
    copy ".env.example" ".env" >nul
    echo Created .env from .env.example -- edit to add API keys
)

REM -- Create default config.yaml if it doesn't exist --------------------------
python -c "from hermes_cli.config import DEFAULT_CONFIG, save_config, get_config_path; p = get_config_path(); p.exists() or save_config(DEFAULT_CONFIG)" 2>nul
if %errorlevel% equ 0 echo Created %USERPROFILE%\.hermes\config.yaml

cd /d "%~dp0"
echo.

REM -- Build Agent web dashboard -----------------------------------------------
echo Building Agent web dashboard...
cd /d "%~dp0Agent\web"
call npm install
call npm run build
cd /d "%~dp0"
echo.

REM -- Install Desktop ---------------------------------------------------------
echo Installing Desktop dependencies...
cd /d "%~dp0Desktop"
call npm install
cd /d "%~dp0"
echo.

REM -- Add 'hermes' to PATH -----------------------------------------------------
echo Installing 'hermes' command...
set VENV_SCRIPTS=%~dp0Agent\.venv\Scripts

REM Update current session PATH so hermes works immediately
set PATH=%VENV_SCRIPTS%;%PATH%

REM Persist to user PATH via PowerShell (avoids setx 1024-char truncation)
powershell -NoProfile -Command ^
  "$venv = '%VENV_SCRIPTS%'; " ^
  "$cur = [System.Environment]::GetEnvironmentVariable('PATH','User'); " ^
  "if ($cur -notlike ('*' + $venv + '*')) { " ^
  "  [System.Environment]::SetEnvironmentVariable('PATH', $venv + ';' + $cur, 'User'); " ^
  "  Write-Host '  Added to user PATH: ' + $venv -ForegroundColor Green " ^
  "} else { Write-Host '  Already in user PATH' -ForegroundColor Green }"

echo   'hermes' is now available in new terminals
echo.

REM -- Done --------------------------------------------------------------------
echo ========================================================
echo   Install complete!
echo ========================================================
echo.
echo   Next steps:
echo   1. Edit Agent\.env to add your API keys
echo   2. Open a new terminal and run: hermes
echo      (works in this session too)
echo   3. To start the desktop UI: start.bat
echo.
pause
