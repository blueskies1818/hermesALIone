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

# Agents run terminal/file tools in a dedicated workspace, never in the repo
# the backend happens to be started from (terminal.cwd "." would be Agent/).
$Workspace = Join-Path $ThetaHome "workspace"
New-Item -ItemType Directory -Force $Workspace | Out-Null
& "$Root\Agent\.venv\Scripts\python.exe" -c "import sys; from hermes_cli.config import load_config, save_config; c = load_config(); t = c.setdefault('terminal', {}); (t.get('cwd') in (None, '', '.')) and (t.__setitem__('cwd', sys.argv[1]), save_config(c))" ($Workspace -replace '\\', '/')

# Safety policy: agents' file writes (write_file/patch) stay inside the workspace.
& "$Root\Agent\.venv\Scripts\python.exe" -c "import sys; from hermes_cli.config import load_config, save_config; c = load_config(); s = c.setdefault('theta', {}).setdefault('safety', {}); s.get('write_root') or (s.__setitem__('write_root', sys.argv[1]), save_config(c))" ($Workspace -replace '\\', '/')

# Kanban tasks get persistent folders under workspace\tasks instead of
# scratch dirs that are deleted when the task completes.
& "$Root\Agent\.venv\Scripts\python.exe" -c "import sys; from hermes_cli.config import load_config, save_config; c = load_config(); k = c.setdefault('kanban', {}); k.get('default_workspace_root') or (k.__setitem__('default_workspace_root', sys.argv[1]), save_config(c))" ((Join-Path $Workspace "tasks") -replace '\\', '/')

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
Write-Host "Done. Add a provider key (e.g. ANTHROPIC_API_KEY, OPENROUTER_API_KEY or DEEPSEEK_API_KEY) to $EnvFile, then run start.ps1." -ForegroundColor Green
