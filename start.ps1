# ============================================================================
# Hermes ALIone — Start script (Windows PowerShell)
# ============================================================================
# Run: powershell -ExecutionPolicy Bypass -File start.ps1
# ============================================================================

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location "$ScriptDir\Desktop"
npm run dev
