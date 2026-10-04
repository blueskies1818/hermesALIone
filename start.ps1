# Theta Agent - start (Windows PowerShell)
# Starts the backend (chat API :8642, REST API :9119), then the Desktop app.
# Closing the app stops the backend. Use -BackendOnly to run just the servers.

param([switch]$BackendOnly)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = "$Root\Agent\.venv\Scripts\python.exe"
$env:HERMES_HOME = if ($env:HERMES_HOME) { $env:HERMES_HOME } else { Join-Path $env:USERPROFILE ".theta" }
$Logs = Join-Path $env:HERMES_HOME "logs"

if (-not (Test-Path $Python)) {
    Write-Host "Backend not installed. Run install.ps1 first." -ForegroundColor Red
    exit 1
}
New-Item -ItemType Directory -Force $Logs | Out-Null

# Provider keys must come only from $HERMES_HOME\.env, so drop any inherited ones.
Get-ChildItem Env: | Where-Object { $_.Name -like "*_API_KEY" } | ForEach-Object {
    Remove-Item "Env:$($_.Name)"
}
# Launched from VS Code, Electron would otherwise start in plain Node mode.
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

# A venv python.exe is a launcher that spawns the real interpreter as a child,
# so always stop the whole process tree.
function Stop-Tree($procId) { taskkill /T /F /PID $procId 2>&1 | Out-Null }

# Stop a previous Theta backend still holding our ports (only our own venv's python).
foreach ($port in 8642, 9119) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $($_.OwningProcess)"
        if ($proc.CommandLine -like "*hermes_cli.main*") {
            Stop-Tree $proc.ProcessId
        } else {
            Write-Host "Port $port is used by another program ($($proc.Name)). Free it and retry." -ForegroundColor Red
            exit 1
        }
    }
}

function Start-Backend($name, $cliArgs) {
    Start-Process -FilePath $Python -ArgumentList (@("-m", "hermes_cli.main") + $cliArgs) `
        -WorkingDirectory "$Root\Agent" -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput "$Logs\$name.log" -RedirectStandardError "$Logs\$name.err.log"
}

$env:API_SERVER_ENABLED = "true"
$gateway = Start-Backend "gateway" @("gateway", "run", "--replace")
$dashboard = Start-Backend "dashboard" @("dashboard", "--no-open")

Write-Host "Waiting for backend..."
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    $rest = Get-NetTCPConnection -LocalPort 9119 -State Listen -ErrorAction SilentlyContinue
    $chat = Get-NetTCPConnection -LocalPort 8642 -State Listen -ErrorAction SilentlyContinue
    if ($rest -and $chat) { $ready = $true; break }
}
if (-not $ready) {
    Write-Host "Backend did not start within 60s. See logs in $Logs" -ForegroundColor Red
    Stop-Tree $gateway.Id; Stop-Tree $dashboard.Id
    exit 1
}
Write-Host "Backend ready: chat http://127.0.0.1:8642, REST http://127.0.0.1:9119 (logs: $Logs)" -ForegroundColor Green

if ($BackendOnly) {
    Write-Host "Backend running (gateway PID $($gateway.Id), dashboard PID $($dashboard.Id))."
    exit 0
}

try {
    Push-Location "$Root\Desktop"
    npm run dev
} finally {
    Pop-Location
    Write-Host "Stopping backend..."
    Stop-Tree $gateway.Id; Stop-Tree $dashboard.Id
}
