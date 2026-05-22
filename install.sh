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

# ── Add 'hermes' to PATH ───────────────────────────────────────────────────────
echo -e "${YELLOW}Installing 'hermes' command...${NC}"

LOCAL_BIN="$HOME/.local/bin"
mkdir -p "$LOCAL_BIN"

# Write a small wrapper that calls the venv entry point by absolute path.
# Using a wrapper (not a symlink) so it survives if the venv is rebuilt.
VENV_PYTHON="$SCRIPT_DIR/Agent/.venv/bin/python"
cat > "$LOCAL_BIN/hermes" << WRAPPER
#!/usr/bin/env bash
exec "$VENV_PYTHON" -m hermes_cli.main "\$@"
WRAPPER
chmod +x "$LOCAL_BIN/hermes"
echo -e "${GREEN}  Installed: $LOCAL_BIN/hermes${NC}"

# Ensure ~/.local/bin is in PATH for bash, zsh, fish, and generic profile.
# We only append once (skip if the line is already present).
_add_to_path() {
    local file="$1"
    local line='export PATH="$HOME/.local/bin:$PATH"'
    [ -f "$file" ] || return 0
    grep -qF '.local/bin' "$file" && return 0
    printf '\n# Added by Hermes installer\n%s\n' "$line" >> "$file"
    echo -e "  Updated $file"
}

_add_to_path "$HOME/.bashrc"
_add_to_path "$HOME/.bash_profile"
_add_to_path "$HOME/.zshrc"
_add_to_path "$HOME/.profile"

# Fish shell uses a different syntax
FISH_CFG="$HOME/.config/fish/config.fish"
if [ -f "$FISH_CFG" ] && ! grep -qF '.local/bin' "$FISH_CFG"; then
    printf '\n# Added by Hermes installer\nfish_add_path "$HOME/.local/bin"\n' >> "$FISH_CFG"
    echo -e "  Updated $FISH_CFG"
fi

# Make it available in the current shell session too
export PATH="$LOCAL_BIN:$PATH"
echo -e "${GREEN}  'hermes' is now available in new terminals${NC}"
echo ""

# ── Done ───────────────────────────────────────────────────────────────────────
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Install complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  Next steps:"
echo -e "  1. Edit Agent/.env to add your API keys"
echo -e "  2. Open a new terminal and run: ${CYAN}hermes${NC}"
echo -e "     (or in this session: ${CYAN}source ~/.bashrc${NC} first)"
echo -e "  3. To start the desktop UI:    ${CYAN}./start.sh${NC}"
echo ""
