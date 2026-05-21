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
    $gatewayJob = Start-Job -Name "HermesGateway" -ScriptBlock {
        Set-Location $using:ScriptDir\Agent
        hermes gateway run 2>&1 | Out-Null
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

# -- Start the desktop app in dev mode -----------------------------------------
Set-Location "$ScriptDir\Desktop"
Write-Host "Starting Hermes Desktop..."
npm run dev
