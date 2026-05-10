#!/usr/bin/env node
/**
 * Native Messaging Host for Claude Chrome Extension
 * Communicates with Chrome via stdin/stdout using 4-byte length-prefixed JSON protocol
 */

import { ClaudeBridge } from './claude-bridge.js';

const bridge = new ClaudeBridge(sendMessage);

// ── Protocol helpers ──────────────────────────────────────────────────────────

const MAX_MSG_BYTES = 1024 * 1024; // Chrome Native Messaging limit: 1 MB

function sendMessage(msg) {
  const json = JSON.stringify(msg);
  const buf = Buffer.from(json, 'utf8');
  if (buf.length > MAX_MSG_BYTES) {
    // Truncate oversized messages rather than silently dropping the connection
    const truncated = JSON.stringify({
      type: 'error',
      code: 'MSG_TOO_LARGE',
      message: `응답이 너무 큽니다 (${(buf.length / 1024).toFixed(0)} KB). 더 짧은 질문을 시도해주세요.`,
      requestId: msg.requestId,
    });
    const tbuf = Buffer.from(truncated, 'utf8');
    const hdr = Buffer.alloc(4);
    hdr.writeUInt32LE(tbuf.length, 0);
    process.stdout.write(Buffer.concat([hdr, tbuf]));
    return;
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buf.length, 0);
  process.stdout.write(Buffer.concat([header, buf]));
}

// ── Stdin reading (binary, length-prefixed) ───────────────────────────────────

let inputBuf = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  inputBuf = Buffer.concat([inputBuf, chunk]);
  processInput();
});

process.stdin.on('end', () => {
  process.exit(0);
});

function processInput() {
  while (inputBuf.length >= 4) {
    const msgLen = inputBuf.readUInt32LE(0);
    if (msgLen > MAX_MSG_BYTES) {
      sendMessage({ type: 'error', code: 'MSG_TOO_LARGE', message: '수신 메시지가 너무 큽니다.' });
      inputBuf = Buffer.alloc(0);
      return;
    }
    if (inputBuf.length < 4 + msgLen) break;

    const msgBuf = inputBuf.subarray(4, 4 + msgLen);
    inputBuf = inputBuf.subarray(4 + msgLen);

    try {
      const msg = JSON.parse(msgBuf.toString('utf8'));
      handleMessage(msg).catch(e => {
        sendMessage({ type: 'error', message: e.message, requestId: msg.requestId });
      });
    } catch (e) {
      sendMessage({ type: 'error', message: 'JSON parse error: ' + e.message });
    }
  }
}

// ── Message handler ───────────────────────────────────────────────────────────

async function handleMessage(msg) {
  switch (msg.type) {
    case 'ping':
      sendMessage({ type: 'pong', requestId: msg.requestId });
      break;

    case 'check-claude': {
      const info = await bridge.checkClaude();
      sendMessage({ type: 'claude-info', ...info, requestId: msg.requestId });
      break;
    }

    case 'chat':
      bridge.chat({
        prompt: msg.prompt,
        pageContext: msg.pageContext,
        requestId: msg.requestId,
      });
      break;

    case 'abort':
      bridge.abort();
      sendMessage({ type: 'aborted', requestId: msg.requestId });
      break;

    case 'clear-session':
      bridge.clearSession();
      sendMessage({ type: 'session-cleared', requestId: msg.requestId });
      break;

    case 'slash':
      // Forward slash commands as chat messages
      bridge.chat({
        prompt: msg.command,
        pageContext: msg.pageContext,
        requestId: msg.requestId,
      });
      break;

    default:
      sendMessage({ type: 'error', message: `Unknown message type: ${msg.type}`, requestId: msg.requestId });
  }
}
