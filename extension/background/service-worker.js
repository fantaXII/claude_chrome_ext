/**
 * Service Worker for Claude Chrome Extension (Manifest V3)
 * Bridges the Side Panel ↔ Native Messaging Host
 */

// ── State ──────────────────────────────────────────────────────────────────
let nativePort = null;
let currentTabInfo = { url: '', title: '' };

// Map from port name/id → runtime.Port (side panel connections)
const panelPorts = new Set();

// ── Side Panel behaviour ───────────────────────────────────────────────────
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});

// ── Tab tracking ───────────────────────────────────────────────────────────
function broadcastPageContext() {
  for (const p of panelPorts) {
    try { p.postMessage({ type: 'page-context', ...currentTabInfo }); }
    catch { panelPorts.delete(p); }
  }
}

function refreshActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    currentTabInfo = { url: tabs[0].url || '', title: tabs[0].title || '' };
    broadcastPageContext();
  });
}

chrome.tabs.onActivated.addListener(() => refreshActiveTab());

chrome.tabs.onUpdated.addListener((_id, change) => {
  if (change.status === 'complete') refreshActiveTab();
});

// ── Native host connection ─────────────────────────────────────────────────
function connectNative() {
  if (nativePort) return true;

  try {
    nativePort = chrome.runtime.connectNative('com.claude.ext.host');

    nativePort.onMessage.addListener((msg) => {
      for (const p of panelPorts) {
        try { p.postMessage(msg); }
        catch { panelPorts.delete(p); }
      }
    });

    nativePort.onDisconnect.addListener(() => {
      nativePort = null;
      const err = chrome.runtime.lastError?.message || 'Native host 연결이 끊어졌습니다.';
      const errorMsg = {
        type: 'native-error',
        message: err + (err.includes('not found') || err.includes('Specified native messaging host not found')
          ? ' — install.ps1을 실행하여 Native Host를 등록해주세요.'
          : ''),
      };
      for (const p of panelPorts) {
        try { p.postMessage(errorMsg); }
        catch { panelPorts.delete(p); }
      }
    });

    return true;
  } catch (e) {
    return false;
  }
}

// ── Side panel port handler ────────────────────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sidepanel') return;

  panelPorts.add(port);

  // Send current page context immediately
  port.postMessage({ type: 'page-context', ...currentTabInfo });

  // Ensure native connection
  if (!nativePort) connectNative();

  const ALLOWED_MSG_TYPES = new Set(['ping', 'check-claude', 'chat', 'abort', 'clear-session', 'slash']);

  port.onMessage.addListener((msg) => {
    if (!msg || !ALLOWED_MSG_TYPES.has(msg.type)) {
      port.postMessage({ type: 'error', message: '허용되지 않은 메시지 타입입니다.', requestId: msg?.requestId });
      return;
    }
    if (!nativePort && !connectNative()) {
      port.postMessage({
        type: 'native-error',
        message: 'Native Host에 연결할 수 없습니다. install.ps1을 PowerShell에서 실행한 후 Chrome을 재시작해주세요.',
      });
      return;
    }
    try {
      nativePort.postMessage(msg);
    } catch (e) {
      nativePort = null;
      port.postMessage({
        type: 'native-error',
        message: 'Native Host 연결 오류: ' + e.message,
      });
    }
  });

  port.onDisconnect.addListener(() => {
    panelPorts.delete(port);
    // If no panels remain, disconnect native to free resources
    if (panelPorts.size === 0 && nativePort) {
      nativePort.disconnect();
      nativePort = null;
    }
  });
});

// ── Startup ────────────────────────────────────────────────────────────────
refreshActiveTab();
