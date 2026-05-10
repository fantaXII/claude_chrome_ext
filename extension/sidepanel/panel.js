/**
 * Claude Code Extension — Side Panel UI
 * Connects to the service worker via a long-lived port,
 * renders chat messages, and handles user input.
 */

'use strict';

// ── State ──────────────────────────────────────────────────────────────────
let port = null;
let currentPageContext = { url: '', title: '' };
let pendingMessageEl = null;   // The assistant message div being streamed
let pendingTextParts = [];     // Accumulated text for the current stream
let isWaiting = false;
let requestCounter = 0;

// ── DOM refs ───────────────────────────────────────────────────────────────
const messagesEl   = document.getElementById('messages');
const inputEl      = document.getElementById('input');
const sendBtn      = document.getElementById('sendBtn');
const clearBtn     = document.getElementById('clearBtn');
const pageTitleEl  = document.getElementById('pageTitle');
const pageUrlEl    = document.getElementById('pageUrl');
const statusBar    = document.getElementById('statusBar');
const statusMsg    = document.getElementById('statusMsg');

// ── Connection ─────────────────────────────────────────────────────────────
function connect() {
  port = chrome.runtime.connect({ name: 'sidepanel' });

  port.onMessage.addListener(handleMessage);

  port.onDisconnect.addListener(() => {
    port = null;
    // Reconnect after a short delay
    setTimeout(connect, 1000);
  });
}

connect();

// ── Incoming message handler ───────────────────────────────────────────────
function handleMessage(msg) {
  switch (msg.type) {
    case 'page-context':
      updatePageContext(msg);
      break;

    case 'stream':
      handleStream(msg.event);
      break;

    case 'done':
      finalizeStream();
      setWaiting(false);
      break;

    case 'session-id':
      // Session ID stored in native host; nothing to do in UI
      break;

    case 'session-cleared':
      addSystemMessage('대화가 초기화되었습니다.');
      break;

    case 'aborted':
      finalizeStream();
      setWaiting(false);
      addSystemMessage('요청이 중단되었습니다.');
      break;

    case 'native-error':
      finalizeStream();
      setWaiting(false);
      showNativeError(msg.message);
      break;

    case 'error':
      finalizeStream();
      setWaiting(false);
      if (msg.code === 'CLAUDE_NOT_FOUND') {
        showInstallGuidance();
      } else {
        addErrorMessage(msg.message || '알 수 없는 오류가 발생했습니다.');
      }
      break;
  }
}

// ── Stream rendering ───────────────────────────────────────────────────────
function handleStream(event) {
  if (!event) return;

  if (event.type === 'assistant') {
    // Extract text blocks from content
    const content = event.message?.content || [];
    let hasText = false;

    for (const block of content) {
      if (block.type === 'text' && block.text) {
        if (!pendingMessageEl) {
          pendingMessageEl = createAssistantMessage();
        }
        pendingTextParts.push(block.text);
        hasText = true;
      }
      if (block.type === 'tool_use') {
        renderToolUse(block);
      }
    }

    if (hasText && pendingMessageEl) {
      // Show streaming text (raw, will be rendered on done)
      const body = pendingMessageEl.querySelector('.message-body');
      const loading = body.querySelector('.loading');
      if (loading) loading.remove();
      body.textContent = pendingTextParts.join('');
    }
  }

  if (event.type === 'result') {
    // Final result — prefer this as the authoritative text
    if (event.result) {
      if (!pendingMessageEl) {
        pendingMessageEl = createAssistantMessage();
      }
      pendingTextParts = [event.result];
    }
  }
}

function createAssistantMessage() {
  // Remove welcome message if still showing
  const welcome = messagesEl.querySelector('.welcome');
  if (welcome) welcome.remove();

  const el = document.createElement('div');
  el.className = 'message assistant';
  el.innerHTML = `
    <div class="message-role">Claude</div>
    <div class="message-body">
      <div class="loading"><span></span><span></span><span></span></div>
    </div>`;
  messagesEl.appendChild(el);
  scrollToBottom();
  return el;
}

function finalizeStream() {
  if (!pendingMessageEl) return;

  const body = pendingMessageEl.querySelector('.message-body');
  const text = pendingTextParts.join('');

  if (text.trim()) {
    body.innerHTML = renderMarkdown(text);
  } else {
    // Nothing to show — remove the element
    pendingMessageEl.remove();
  }

  pendingMessageEl = null;
  pendingTextParts = [];
  scrollToBottom();
}

function renderToolUse(block) {
  // Remove welcome if present
  const welcome = messagesEl.querySelector('.welcome');
  if (welcome) welcome.remove();

  const card = document.createElement('div');
  card.className = 'tool-card';

  const inputStr = block.input ? JSON.stringify(block.input, null, 2) : '';
  card.innerHTML = `
    <div class="tool-header">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>
      </svg>
      <span class="tool-name">${escHtml(block.name || 'tool')}</span>
      <span>▾</span>
    </div>
    <div class="tool-body">${escHtml(inputStr)}</div>`;

  const header = card.querySelector('.tool-header');
  const toolBody = card.querySelector('.tool-body');
  header.addEventListener('click', () => toolBody.classList.toggle('hidden'));

  messagesEl.appendChild(card);
  scrollToBottom();
}

// ── Page context ───────────────────────────────────────────────────────────
function updatePageContext(ctx) {
  currentPageContext = { url: ctx.url || '', title: ctx.title || '' };
  pageTitleEl.textContent = ctx.title || 'Claude Code';
  pageUrlEl.textContent   = ctx.url   || '페이지 없음';
  pageUrlEl.title         = ctx.url   || '';
}

// ── Input handling ─────────────────────────────────────────────────────────
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

inputEl.addEventListener('input', () => {
  // Auto-resize textarea
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px';
});

sendBtn.addEventListener('click', sendMessage);

clearBtn.addEventListener('click', () => {
  clearChat();
});

const MAX_PROMPT_BYTES = 50 * 1024; // 50 KB

function sendMessage() {
  const text = inputEl.value.trim();
  if (!text || isWaiting) return;

  if (new Blob([text]).size > MAX_PROMPT_BYTES) {
    addErrorMessage('메시지가 너무 깁니다 (최대 50KB). 더 짧게 입력해주세요.');
    return;
  }

  inputEl.value = '';
  inputEl.style.height = 'auto';

  // Handle slash commands locally
  if (text === '/clear') {
    clearChat();
    return;
  }

  if (text === '/help') {
    showHelp();
    return;
  }

  // Display user message
  appendUserMessage(text);
  setWaiting(true);

  const reqId = ++requestCounter;

  if (text.startsWith('/')) {
    // Forward other slash commands to native host
    port?.postMessage({
      type: 'slash',
      command: text,
      pageContext: currentPageContext,
      requestId: reqId,
    });
  } else {
    port?.postMessage({
      type: 'chat',
      prompt: text,
      pageContext: currentPageContext,
      requestId: reqId,
    });
  }
}

function clearChat() {
  // Remove all messages, show welcome
  messagesEl.innerHTML = `
    <div class="welcome">
      <p>대화가 초기화되었습니다.</p>
      <p class="hint">팁: <code>/help</code> — 명령어 목록</p>
    </div>`;
  pendingMessageEl = null;
  pendingTextParts = [];
  hideStatus();
  port?.postMessage({ type: 'clear-session', requestId: ++requestCounter });
}

function showHelp() {
  const welcome = messagesEl.querySelector('.welcome');
  if (welcome) welcome.remove();

  const el = document.createElement('div');
  el.className = 'message system-msg';
  el.innerHTML = `<div class="message-body">
    <strong>사용 가능한 명령어:</strong><br>
    <code>/clear</code> — 대화 초기화<br>
    <code>/help</code> — 이 도움말<br>
    기타 Claude Code slash 명령어는 그대로 Claude에게 전달됩니다.
  </div>`;
  messagesEl.appendChild(el);
  scrollToBottom();
}

// ── Message builders ───────────────────────────────────────────────────────
function appendUserMessage(text) {
  const welcome = messagesEl.querySelector('.welcome');
  if (welcome) welcome.remove();

  const el = document.createElement('div');
  el.className = 'message user';
  el.innerHTML = `<div class="message-role">나</div>
    <div class="message-body">${escHtml(text).replace(/\n/g, '<br>')}</div>`;
  messagesEl.appendChild(el);
  scrollToBottom();
}

function addSystemMessage(text) {
  const el = document.createElement('div');
  el.className = 'message system-msg';
  el.innerHTML = `<div class="message-body">${escHtml(text)}</div>`;
  messagesEl.appendChild(el);
  scrollToBottom();
}

function addErrorMessage(text) {
  const el = document.createElement('div');
  el.className = 'message error';
  el.innerHTML = `<div class="message-role">오류</div>
    <div class="message-body">${escHtml(text)}</div>`;
  messagesEl.appendChild(el);
  scrollToBottom();
}

function showNativeError(msg) {
  showStatus('⚠ Native Host 연결 실패: ' + (msg || '') +
    ' — install.ps1을 실행했는지 확인하세요.', 'error');
}

function showInstallGuidance() {
  const welcome = messagesEl.querySelector('.welcome');
  if (welcome) welcome.remove();

  const el = document.createElement('div');
  el.className = 'message';
  el.innerHTML = `<div class="message-body">
    <div class="install-card">
      <h3>⚠ Claude Code가 설치되어 있지 않습니다</h3>
      <p>터미널에서 다음 명령어를 실행하세요:</p>
      <code>npm install -g @anthropic-ai/claude-code</code>
      <p>설치 후 확장을 새로고침하세요.</p>
    </div>
  </div>`;
  messagesEl.appendChild(el);
  scrollToBottom();
}

// ── Status bar ─────────────────────────────────────────────────────────────
function showStatus(msg, _type) {
  statusMsg.textContent = msg;
  statusBar.classList.remove('hidden');
}

function hideStatus() {
  statusBar.classList.add('hidden');
}

// ── UI state ───────────────────────────────────────────────────────────────
function setWaiting(val) {
  isWaiting = val;
  sendBtn.disabled = val;
  inputEl.disabled = val;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ── Simple Markdown renderer ───────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMarkdown(text) {
  const parts = [];
  const codeBlockRe = /```(\w*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m;

  while ((m = codeBlockRe.exec(text)) !== null) {
    if (m.index > last) parts.push(renderInline(text.slice(last, m.index)));
    const lang = m[1] || '';
    const code = escHtml(m[2].replace(/^\n/, ''));
    parts.push(`<pre><code class="language-${escHtml(lang)}">${code}</code></pre>`);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(renderInline(text.slice(last)));

  return parts.join('');
}

function renderInline(text) {
  let s = escHtml(text);
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, linkText, url) => {
    // Whitelist only safe protocols to prevent javascript: XSS
    const safeUrl = /^https?:\/\//i.test(url) ? url : '#';
    return `<a href="${escHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${linkText}</a>`;
  });
  s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // Paragraphs
  const paras = s.split(/\n\n+/);
  return paras.map(p => {
    if (p.startsWith('<h') || p.startsWith('<pre')) return p;
    return '<p>' + p.replace(/\n/g, '<br>') + '</p>';
  }).join('');
}
