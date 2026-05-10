/**
 * Claude CLI Bridge
 * Spawns the Claude Code CLI and streams responses back to the extension
 */

import { spawn, execFileSync } from 'child_process';
import { createInterface } from 'readline';
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';

export class ClaudeBridge {
  constructor(sendFn) {
    this.send = sendFn;
    this.currentChild = null;
    this.savedSessionId = null;
    this._claudePath = null;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async checkClaude() {
    const path = this._findClaude();
    if (!path) return { found: false };

    try {
      const version = execFileSync(path, ['--version'], {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      return { found: true, path, version };
    } catch {
      return { found: true, path, version: 'unknown' };
    }
  }

  chat({ prompt, pageContext, requestId }) {
    // Abort any previous in-flight request
    this.abort();

    const claudePath = this._findClaude();
    if (!claudePath) {
      this.send({ type: 'error', code: 'CLAUDE_NOT_FOUND', requestId,
        message: 'Claude Code가 설치되어 있지 않습니다. npm install -g @anthropic-ai/claude-code 로 설치해주세요.' });
      return;
    }

    // Sanitize pageContext to prevent prompt injection
    const safeUrl   = String(pageContext?.url   || '').replace(/[\r\n]/g, ' ').slice(0, 500);
    const safeTitle = String(pageContext?.title || '').replace(/[\r\n]/g, ' ').slice(0, 200);

    const systemPrompt = safeUrl
      ? `현재 사용자가 보고 있는 웹페이지 - URL: ${safeUrl}, Title: ${safeTitle || '(제목 없음)'}`
      : '';

    const args = [
      '--print',
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--bare',
      '--permission-mode', 'bypassPermissions',
    ];

    if (systemPrompt) {
      args.push('--append-system-prompt', systemPrompt);
    }

    if (this.savedSessionId) {
      args.push('--resume', this.savedSessionId);
    }

    const child = spawn(claudePath, args, {
      env: { ...process.env },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],  // stdin: ignore → prevents "no stdin data" warning
    });
    this.currentChild = child;

    // ── stdout: readline-based line-by-line JSON parsing ────────────────────
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });

    rl.on('line', (line) => {
      if (!line.trim()) return;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return; // skip non-JSON lines
      }

      // Extract session_id from system/init event (before filtering)
      if (event.type === 'system' && event.session_id && !this.savedSessionId) {
        this.savedSessionId = event.session_id;
        this.send({ type: 'session-id', sessionId: event.session_id, requestId });
      }

      // Only forward assistant and result events to the extension
      if (event.type === 'assistant' || event.type === 'result') {
        this.send({ type: 'stream', event, requestId });
      }
      // system, rate_limit_event, etc. → silently ignored
    });

    // ── stderr ──────────────────────────────────────────────────────────────
    child.stderr.on('data', (data) => {
      let msg = data.toString().trim();
      if (!msg) return;
      // Strip internal file paths to avoid leaking system info to the UI
      msg = msg.replace(/([A-Za-z]:)?\/[^\s:]+\.(js|ts|mjs|cjs)/g, '<path>');
      this.send({ type: 'error', message: msg, requestId });
    });

    // ── exit ────────────────────────────────────────────────────────────────
    // Guard against both close + error firing for the same spawn failure
    let finished = false;
    const finish = (msgFn) => {
      if (finished) return;
      finished = true;
      this.currentChild = null;
      msgFn();
    };

    child.on('close', (code) => {
      finish(() => this.send({ type: 'done', exitCode: code ?? 0, requestId }));
    });

    child.on('error', (err) => {
      finish(() => this.send({ type: 'error', message: err.message, code: 'SPAWN_ERROR', requestId }));
    });
  }

  abort() {
    if (this.currentChild) {
      try { this.currentChild.kill('SIGTERM'); } catch {}
      this.currentChild = null;
    }
  }

  clearSession() {
    this.savedSessionId = null;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  _findClaude() {
    if (this._claudePath) return this._claudePath;

    const home = process.env.HOME || process.env.USERPROFILE || '';

    // 1. Scan NVM versions without shell — use fs directly
    try {
      const nvmBase = join(home, '.nvm', 'versions', 'node');
      const versions = readdirSync(nvmBase).reverse(); // prefer newest
      for (const ver of versions) {
        const candidate = join(nvmBase, ver, 'bin', 'claude');
        if (existsSync(candidate)) {
          this._claudePath = candidate;
          return candidate;
        }
      }
    } catch {}

    // 2. PATH lookup via execFileSync — no shell
    for (const which of ['/usr/bin/which', '/bin/which']) {
      try {
        if (!existsSync(which)) continue;
        const p = execFileSync(which, ['claude'], {
          encoding: 'utf8', timeout: 3000,
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        if (p) {
          this._claudePath = p;
          return p;
        }
      } catch {}
    }

    return null;
  }
}
