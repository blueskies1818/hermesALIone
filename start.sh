#!/usr/bin/env bash
# ============================================================================
# Hermes ALIone — Start script (Linux / macOS / WSL2)
# ============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ------------------------------------------------------------------
# Helper: check if gateway port is listening
# ------------------------------------------------------------------
gateway_listening() {
    # Try ss first (modern Linux), then nc, then bash /dev/tcp builtin
    if command -v ss &>/dev/null; then
        ss -tlnp 2>/dev/null | grep -q ':8642 '
    elif command -v nc &>/dev/null; then
        nc -z localhost 8642 2>/dev/null
    else
        (echo >/dev/tcp/localhost/8642) 2>/dev/null
    fi
}

# ------------------------------------------------------------------
# Start Hermes Agent gateway if not already running
# ------------------------------------------------------------------
if gateway_listening; then
    echo "Hermes Agent gateway is already running on port 8642."
else
    echo "Starting Hermes Agent gateway..."
    cd "$SCRIPT_DIR/Agent"

    # Activate venv if present
    if [ -f .venv/bin/activate ]; then
        source .venv/bin/activate
    fi

    # Try service-based start first, fall back to foreground in background
    if hermes gateway start 2>/dev/null; then
        echo "Gateway service started."
    else
        echo "Service start unavailable — running gateway in background..."
        nohup hermes gateway run > /dev/null 2>&1 &
    fi

    # Wait for gateway to become available (up to 30s)
    echo "Waiting for gateway to become ready..."
    for i in $(seq 1 30); do
        if gateway_listening; then
            break
        fi
        sleep 1
    done

    if gateway_listening; then
        echo "Gateway is ready."
    else
        echo "Warning: Gateway may still be starting — check logs in ~/.hermes/logs/"
    fi
fi

# ------------------------------------------------------------------
# Start the desktop app in dev mode
# ------------------------------------------------------------------
cd "$SCRIPT_DIR/Desktop"
echo "Starting Hermes Desktop..."
npm run dev
