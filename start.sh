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
# Start Hermes Agent gateway — always kill stale process first so
# fresh code is loaded on every start
# ------------------------------------------------------------------
# Kill any stale hermes processes by name so fresh code is always loaded
echo "Stopping any existing hermes processes..."
pkill -f "hermes" 2>/dev/null || true
sleep 1

if gateway_listening; then
    echo "Stopping existing gateway on port 8642..."
    # Kill whatever process owns port 8642
    if command -v ss &>/dev/null; then
        pid=$(ss -tlnp 2>/dev/null | grep ':8642 ' | grep -oP 'pid=\K[0-9]+' | head -1)
    elif command -v lsof &>/dev/null; then
        pid=$(lsof -ti tcp:8642 2>/dev/null | head -1)
    fi
    if [ -n "$pid" ]; then
        kill -9 "$pid" 2>/dev/null || true
        sleep 1
    fi
fi

echo "Starting Hermes Agent gateway..."
cd "$SCRIPT_DIR/Agent"

# Activate venv if present
if [ -f .venv/bin/activate ]; then
    source .venv/bin/activate
fi

# API server must be enabled for port 8642 to bind
export API_SERVER_ENABLED=true

# Try service-based start first, fall back to foreground in background
if hermes gateway start 2>/dev/null; then
    echo "Gateway service started."
else
    echo "Service start unavailable — running gateway in background..."
    nohup hermes gateway run --replace > /dev/null 2>&1 &
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
# Start Hermes dashboard (REST API on port 9119) if not already running
# ------------------------------------------------------------------
dashboard_listening() {
    if command -v ss &>/dev/null; then
        ss -tlnp 2>/dev/null | grep -q ':9119 '
    elif command -v nc &>/dev/null; then
        nc -z localhost 9119 2>/dev/null
    else
        (echo >/dev/tcp/localhost/9119) 2>/dev/null
    fi
}

if dashboard_listening; then
    echo "Hermes dashboard already running on port 9119."
else
    echo "Starting Hermes dashboard (REST API on port 9119)..."
    cd "$SCRIPT_DIR/Agent"
    if [ -f .venv/bin/activate ]; then
        source .venv/bin/activate
    fi
    nohup hermes dashboard --no-open --skip-build > /dev/null 2>&1 &
    echo "Waiting for dashboard to become ready..."
    for i in $(seq 1 20); do
        if dashboard_listening; then break; fi
        sleep 1
    done
    if dashboard_listening; then
        echo "Dashboard is ready."
    else
        echo "Warning: Dashboard may still be starting — Desktop connection may fail."
    fi
fi

# ------------------------------------------------------------------
# Start the desktop app in dev mode
# ------------------------------------------------------------------
cd "$SCRIPT_DIR/Desktop"
echo "Starting Hermes Desktop..."
npm run dev
