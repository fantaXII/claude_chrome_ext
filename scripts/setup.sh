#!/usr/bin/env bash
# Claude Chrome Extension — WSL2 setup helper
# Run this once from the project root in WSL2

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Claude Chrome Extension — Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo

# 1. Check Node.js
echo "[ 1/4 ] Checking Node.js..."
if ! command -v node &>/dev/null; then
  echo "  ✗ Node.js not found. Please install via nvm:"
  echo "    nvm install --lts"
  exit 1
fi
echo "  ✓ $(node --version)"

# 2. Check Claude Code
echo
echo "[ 2/4 ] Checking Claude Code..."
if command -v claude &>/dev/null; then
  echo "  ✓ $(claude --version 2>/dev/null || echo 'found')"
else
  echo "  ✗ Claude Code not found."
  echo "    Install: npm install -g @anthropic-ai/claude-code"
  echo "    (Extension will show install guidance when this is missing)"
fi

# 3. Generate icons
echo
echo "[ 3/4 ] Generating extension icons..."
node scripts/generate-icons.js
echo "  ✓ Icons generated in extension/icons/"

# 4. Print Windows PowerShell instructions
echo
echo "[ 4/4 ] Windows Native Host registration"
echo
echo "  ┌──────────────────────────────────────────────────────┐"
echo "  │  Run these steps on Windows (not WSL2):              │"
echo "  │                                                      │"
echo "  │  1. Load the extension in Chrome:                    │"
echo "  │     chrome://extensions → Developer mode ON          │"
echo "  │     → Load unpacked → select:                        │"
echo "  │     $(wslpath -w "$ROOT/extension" 2>/dev/null || echo "$ROOT/extension")"
echo "  │                                                      │"
echo "  │  2. Copy the Extension ID shown in Chrome            │"
echo "  │                                                      │"
echo "  │  3. Open PowerShell and run:                         │"
WIN_HOST="$(wslpath -w "$ROOT/native-host" 2>/dev/null || echo "$ROOT/native-host")"
echo "  │     cd $WIN_HOST"
echo "  │     .\\install.ps1 -ExtensionId \"<YOUR_ID>\"         │"
echo "  │                                                      │"
echo "  │  4. Restart Chrome completely                        │"
echo "  └──────────────────────────────────────────────────────┘"
echo
echo "Setup complete!"
