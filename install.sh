#!/usr/bin/env bash
# ============================================================================
# Hermes ALIone — Install script (Linux / macOS / WSL2)
# ============================================================================
set -e

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  Hermes ALIone — Install${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# ── Check prerequisites ────────────────────────────────────────────────────────
check_cmd() {
    if ! command -v "$1" &>/dev/null; then
        echo -e "${RED}Missing: $1 — please install it first${NC}"
        exit 1
    fi
}

echo -e "${YELLOW}Checking prerequisites...${NC}"
check_cmd node
check_cmd npm
check_cmd python3
check_cmd uv

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 18 ]; then
    echo -e "${RED}Node.js 18+ required (found $(node -v))${NC}"
    exit 1
fi

echo -e "  node $(node -v)"
echo -e "  npm $(npm -v)"
echo -e "  python $(python3 --version | cut -d' ' -f2)"
echo -e "  uv $(uv --version | cut -d' ' -f2)"
echo ""

# ── Install Agent ──────────────────────────────────────────────────────────────
echo -e "${YELLOW}Installing Agent dependencies...${NC}"
cd "$SCRIPT_DIR/Agent"

# Create virtual environment and install
if [ ! -d ".venv" ]; then
    uv venv --python 3.11
fi
source .venv/bin/activate
uv pip install -e ".[all]"

# Copy env template
if [ ! -f ".env" ]; then
    cp .env.example .env
    echo -e "${GREEN}Created .env from .env.example — edit to add API keys${NC}"
fi

# Create default config.yaml if it doesn't exist
if python3 -c "from hermes_cli.config import DEFAULT_CONFIG, save_config, get_config_path; p = get_config_path(); p.exists() or save_config(DEFAULT_CONFIG)" 2>/dev/null; then
    echo -e "${GREEN}Created ~/.hermes/config.yaml${NC}"
fi

cd "$SCRIPT_DIR"
echo ""

# ── Build Agent web dashboard ──────────────────────────────────────────────────
echo -e "${YELLOW}Building Agent web dashboard...${NC}"
cd "$SCRIPT_DIR/Agent/web"
npm install
npm run build
cd "$SCRIPT_DIR"
echo ""

# ── Install Desktop ────────────────────────────────────────────────────────────
echo -e "${YELLOW}Installing Desktop dependencies...${NC}"
cd "$SCRIPT_DIR/Desktop"
npm install
cd "$SCRIPT_DIR"
echo ""

# ── Done ───────────────────────────────────────────────────────────────────────
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Install complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  Next steps:"
echo -e "  1. Edit Agent/.env to add your API keys"
echo -e "  2. Run: ${CYAN}./start.sh${NC}"
echo ""
