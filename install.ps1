# Theta Agent - install (Windows PowerShell)
# Sets up the backend venv, the Desktop app's node modules and the data home.
# Safe to re-run. Does not touch PATH or any global settings.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ThetaHome = if ($env:HERMES_HOME) { $env:HERMES_HOME } else { Join-Path $env:USERPROFILE ".theta" }
$Extras = "anthropic,edge-tts,voice,mcp,web,pty,cli,homeassistant,dev"

foreach ($cmd in "uv", "node", "npm") {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Host "Missing prerequisite: $cmd" -ForegroundColor Red
        exit 1
    }
}

Write-Host "== Backend (Agent/.venv)"
Push-Location "$Root\Agent"
try {
    if (-not (Test-Path ".venv")) { uv venv --python 3.11 }
    uv pip install --python .venv\Scripts\python.exe -e ".[$Extras]"
    if ($LASTEXITCODE -ne 0) { throw "backend install failed" }
} finally { Pop-Location }

Write-Host "== Desktop app (Desktop/node_modules)"
Push-Location "$Root\Desktop"
try {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
} finally { Pop-Location }

Write-Host "== Data home ($ThetaHome)"
New-Item -ItemType Directory -Force $ThetaHome | Out-Null
$env:HERMES_HOME = $ThetaHome
& "$Root\Agent\.venv\Scripts\python.exe" -c "from hermes_cli.config import DEFAULT_CONFIG, save_config, get_config_path; p = get_config_path(); p.exists() or save_config(DEFAULT_CONFIG)"

# Provider keys live only in $ThetaHome\.env (never in the repo).
$EnvFile = Join-Path $ThetaHome ".env"
if (-not (Test-Path $EnvFile)) { Copy-Item "$Root\Agent\.env.example" $EnvFile }
if (-not (Select-String -Path $EnvFile -Pattern '^\s*API_SERVER_KEY=\S' -Quiet)) {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $key = ([System.BitConverter]::ToString($bytes) -replace '-', '').ToLower()
    Add-Content -Path $EnvFile -Value "`nAPI_SERVER_KEY=$key" -Encoding utf8
    Write-Host "Generated API_SERVER_KEY in $EnvFile"
}

Write-Host ""
Write-Host "Done. Add a provider key (e.g. ANTHROPIC_API_KEY or OPENROUTER_API_KEY) to $EnvFile, then run start.ps1." -ForegroundColor Green
