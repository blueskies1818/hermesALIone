#!/usr/bin/env bash
# ============================================================================
# Hermes ALIone — Start script (Linux / macOS / WSL2)
# ============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Start the desktop app in dev mode
cd Desktop
npm run dev
