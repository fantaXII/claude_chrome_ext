# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# First-time setup (WSL2) — checks Node, generates icons, prints Windows instructions
bash scripts/setup.sh

# Generate extension icons (pure Node.js, no dependencies)
node scripts/generate-icons.js      # or: yarn icons

# Release (interactive — run in a real terminal, not piped)
yarn release          # patch/minor/major 선택 프롬프트
yarn release:dry      # 변경 없이 동작 미리 보기
```

**Windows-side steps** (not WSL2):
```powershell
# Register Native Messaging Host after loading the extension in Chrome
cd native-host
.\install.ps1 -ExtensionId "<32-char ID from chrome://extensions>"
```

## Architecture

This is a **Windows Chrome Extension + WSL2 Native Host** project. The core challenge is that Windows Chrome can only execute Windows binaries, but Claude Code CLI runs in WSL2.

### Message flow

```
Chrome Side Panel (panel.js)
  └─ chrome.runtime.connect → Service Worker (service-worker.js)
       └─ chrome.runtime.connectNative('com.claude.ext.host')
            └─ host-wrapper.bat  [Windows process]
                 └─ wsl.exe -e node host.js  [WSL2 process]
                      └─ ClaudeBridge.chat()  [spawns Claude CLI]
                           └─ claude --print -p <prompt> --output-format stream-json ...
```

### Key contracts between layers

- **Native Messaging protocol**: 4-byte little-endian length prefix + UTF-8 JSON body. Both directions enforce 1 MB max (`MAX_MSG_BYTES` in `host.js`).
- **Claude CLI flags**: `--print -p <prompt> --output-format stream-json --verbose --bare --permission-mode bypassPermissions`. `--verbose` is required for `stream-json` to work.
- **Event filtering** (`claude-bridge.js`): Only `assistant` and `result` event types are forwarded. `system`, `rate_limit_event`, etc. are silently dropped. The `session_id` is extracted from the first `system` event for `--resume` on follow-up messages.
- **stdin must be ignored**: `stdio: ['ignore', 'pipe', 'pipe']` — without this, Claude CLI prints a "no stdin data" warning to stderr.

### WSL2/Windows boundary

`host-wrapper.bat` contains **hardcoded absolute WSL2 paths** (Node.js binary + `host.js`). When the project moves or Node version changes, this file must be updated manually. The paths follow the pattern:
```
wsl.exe -e /home/<user>/.nvm/versions/node/<version>/bin/node \
           /home/<user>/.../native-host/host.js
```

### Version management

`release-it` + `@release-it/bumper` keep three files in sync on every release:
- `package.json` (root)
- `extension/manifest.json`
- `native-host/package.json`

Requires `GITHUB_TOKEN` env var for automated GitHub Releases.

### Security constraints

- `_findClaude()` uses `readdirSync`/`existsSync` for NVM path scanning and `execFileSync('/usr/bin/which', ['claude'])` for PATH lookup — **no `shell: true` anywhere**.
- `pageContext.url/title` are sanitized (newlines stripped, length-capped) before being passed to `--append-system-prompt`.
- Service Worker enforces a message type allowlist (`ALLOWED_MSG_TYPES`) before forwarding to native host.
- The Side Panel enforces a 50 KB prompt limit before sending.
