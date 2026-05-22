# ============================================================================
# Hermes ALIone — Start script (Windows PowerShell)
# ============================================================================
# Run: powershell -ExecutionPolicy Bypass -File start.ps1
# ============================================================================

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# -- Check if gateway is already running on port 8642 --------------------------
$gatewayRunning = Get-NetTCPConnection -LocalPort 8642 -ErrorAction SilentlyContinue

if ($gatewayRunning) {
    Write-Host "Hermes Agent gateway is already running on port 8642."
}
else {
    Write-Host "Starting Hermes Agent gateway..."
    Push-Location "$ScriptDir\Agent"

    # Activate venv if present
    if (Test-Path ".venv\Scripts\Activate.ps1") {
        . ".venv\Scripts\Activate.ps1"
    }

    # Start gateway in background via Start-Job
    # API_SERVER_ENABLED must be set inside the ScriptBlock — Start-Job runs in a
    # separate runspace and does not inherit $env: variables from the parent.
    $gatewayJob = Start-Job -Name "HermesGateway" -ScriptBlock {
        $env:API_SERVER_ENABLED = "true"
        Set-Location $using:ScriptDir\Agent
        hermes gateway run --replace 2>&1 | Out-Null
    }

    # Wait for gateway to become ready (up to 30s)
    Write-Host "Waiting for gateway to become ready..."
    $timeout = 30
    for ($i = 0; $i -lt $timeout; $i++) {
        Start-Sleep -Seconds 1
        $test = Get-NetTCPConnection -LocalPort 8642 -ErrorAction SilentlyContinue
        if ($test) { break }
    }

    if (Get-NetTCPConnection -LocalPort 8642 -ErrorAction SilentlyContinue) {
        Write-Host "Gateway is ready."
    }
    else {
        Write-Host "Warning: Gateway may still be starting — check logs in ~\.hermes\logs\"
    }

    Pop-Location
}

# -- Start Hermes dashboard (REST API on port 9119) ----------------------------
$dashRunning = Get-NetTCPConnection -LocalPort 9119 -ErrorAction SilentlyContinue
if ($dashRunning) {
    Write-Host "Hermes dashboard already running on port 9119."
}
else {
    Write-Host "Starting Hermes dashboard (REST API on port 9119)..."
    Push-Location "$ScriptDir\Agent"
    if (Test-Path ".venv\Scripts\Activate.ps1") {
        . ".venv\Scripts\Activate.ps1"
    }
    $hermesLog = "$env:USERPROFILE\.hermes\logs\dashboard.log"
    $dashJob = Start-Job -Name "HermesDashboard" -ScriptBlock {
        Set-Location $using:ScriptDir\Agent
        hermes dashboard --no-open --skip-build 2>&1 | Out-File -Append -Encoding utf8 $using:hermesLog
    }
    Write-Host "Waiting for dashboard to become ready..."
    for ($i = 0; $i -lt 45; $i++) {
        Start-Sleep -Seconds 1
        if (Get-NetTCPConnection -LocalPort 9119 -ErrorAction SilentlyContinue) { break }
    }
    if (Get-NetTCPConnection -LocalPort 9119 -ErrorAction SilentlyContinue) {
        Write-Host "Dashboard is ready."
    }
    else {
        Write-Host ""
        Write-Host "ERROR: Dashboard did not start on port 9119 after 45 seconds."
        Write-Host "Check the log for details: $hermesLog"
        Write-Host ""
        Read-Host "Press Enter to exit"
        exit 1
    }
    Pop-Location
}

# -- Start the desktop app in dev mode -----------------------------------------
Set-Location "$ScriptDir\Desktop"
Write-Host "Starting Hermes Desktop..."
npm run dev
