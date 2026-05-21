# ============================================================================
# Hermes ALIone — Install script (Windows)
# ============================================================================
# Run in PowerShell:
#   powershell -ExecutionPolicy Bypass -File install.ps1
# ============================================================================

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  Hermes ALIone — Install (Windows)" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

# ── Check prerequisites ────────────────────────────────────────────────────────
Write-Host "Checking prerequisites..." -ForegroundColor Yellow

# Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Missing: Node.js — install from https://nodejs.org" -ForegroundColor Red
    exit 1
}
Write-Host "  node $(node -v)"

# Python (must be 3.11+)
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "Missing: Python 3.11+ — install from https://python.org" -ForegroundColor Red
    exit 1
}
Write-Host "  python $(python --version)"

# uv
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host "Missing: uv — install with: powershell -c 'irm https://astral.sh/uv/install.ps1 | iex'" -ForegroundColor Red
    exit 1
}
Write-Host "  uv $(uv --version)"
Write-Host ""

# ── Install Agent ──────────────────────────────────────────────────────────────
Write-Host "Installing Agent dependencies..." -ForegroundColor Yellow
Set-Location "$ScriptDir\Agent"

if (-not (Test-Path ".venv")) {
    uv venv --python 3.11
}
.\.venv\Scripts\activate
uv pip install -e ".[all]"

# Copy env template
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Created .env from .env.example — edit to add API keys" -ForegroundColor Green
}

# Create default config.yaml if it doesn't exist
python -c "from hermes_cli.config import DEFAULT_CONFIG, save_config, get_config_path; p = get_config_path(); p.exists() or save_config(DEFAULT_CONFIG)" 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "Created ~\.hermes\config.yaml" -ForegroundColor Green
}

Set-Location $ScriptDir
Write-Host ""

# ── Build Agent web dashboard ──────────────────────────────────────────────────
Write-Host "Building Agent web dashboard..." -ForegroundColor Yellow
Set-Location "$ScriptDir\Agent\web"
npm install
npm run build
Set-Location $ScriptDir
Write-Host ""

# ── Install Desktop ────────────────────────────────────────────────────────────
Write-Host "Installing Desktop dependencies..." -ForegroundColor Yellow
Set-Location "$ScriptDir\Desktop"
npm install
Set-Location $ScriptDir
Write-Host ""

# ── Done ───────────────────────────────────────────────────────────────────────
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host "  Install complete!" -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host ""
Write-Host "  Next steps:"
Write-Host "  1. Edit Agent\.env to add your API keys"
Write-Host "  2. Run: .\start.bat or .\start.ps1"
Write-Host ""
