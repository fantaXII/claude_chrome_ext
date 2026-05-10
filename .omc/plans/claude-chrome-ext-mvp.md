# Claude Chrome Extension MVP - Implementation Plan

> Generated: 2026-05-10
> Updated: 2026-05-10 (Architect/Critic feedback reflected)
> Mode: direct (no interview)
> Source: doc/design.md, .omc/specs/deep-interview-chrome-ext.md

---

## RALPLAN-DR Summary

### Principles (5)
1. **Local-first:** 모든 처리는 로컬에서 발생, 클라우드 백엔드 없음
2. **Zero-cost:** Claude Code 구독 활용, 추가 API 비용 없음
3. **Port-free:** Native Messaging(stdin/stdout)으로 포트 노출 없음
4. **Minimal scope:** MVP 4+1 기능만 구현, 과잉 설계 금지
5. **CLI delegation:** Claude Code CLI가 MCP/tool/slash 모두 처리, Host는 중계만

### Decision Drivers (Top 3)
1. **Claude Code CLI `--print` 모드:** SDK는 프로그래밍 API를 노출하지 않음. CLI의 `--print --output-format stream-json` 옵션으로 비대화형 스트리밍 호출이 가능
2. **Native Messaging 프로토콜:** 4바이트 little-endian 길이 접두사 + JSON. Chrome이 Host 프로세스 생명주기를 관리
3. **WSL2/Windows 경계:** Node.js와 Claude CLI는 WSL2에서 실행, Chrome은 Windows에서 실행. Windows 측 `.bat` wrapper가 `wsl.exe`를 통해 WSL2의 Node.js를 호출하고, Native Host manifest는 Windows 레지스트리에 등록

### Options

#### Option A: CLI spawn per message (채택)
- Native Host가 각 메시지마다 `claude --print -p "prompt" --output-format stream-json`을 child process로 spawn
- **장점:** 단순, 상태 관리 불필요, Claude Code가 모든 복잡성 처리
- **단점:** 메시지 간 컨텍스트 유지 안됨 (세션 미지속)
- **완화:** `--resume` 플래그로 세션 이어가기 가능

#### Option B: Long-running CLI session with stream-json I/O
- `--input-format stream-json --output-format stream-json`으로 양방향 스트리밍
- **장점:** 세션 유지, 대화 컨텍스트 자연스러움
- **단점:** 프로세스 관리 복잡, Native Messaging Host 생명주기와 충돌 가능
- **비고:** v2에서 고려

**결정:** Option A 채택. MVP에서는 단순성 우선. `--resume`으로 세션 연속성 확보.

### ADR
- **Decision:** CLI spawn per message + `--resume` 세션 유지 + Windows `.bat` wrapper를 통한 WSL2 브릿지
- **Drivers:** 단순성, MVP 속도, CLI 안정성, WSL2/Windows 경계 현실 반영
- **Alternatives:**
  - Long-running session (복잡도 높음)
  - SDK API (미제공)
  - WSL2 Linux Chrome Native Host 직접 등록 (Windows Chrome은 Linux 경로 인식 불가 - 무효)
  - Windows Node.js에서 Native Host 실행 (WSL2의 claude CLI 접근에 별도 `wsl` 호출 필요, 이중 계층 문제)
- **Why chosen:** Windows Chrome은 Windows 레지스트리에서 Native Host manifest를 찾고, Windows 실행 파일만 직접 호출 가능. `.bat` wrapper가 `wsl.exe`로 WSL2 Node.js를 호출하는 것이 가장 단순한 브릿지 패턴
- **Consequences:** 설치 과정에 PowerShell 스크립트(레지스트리 등록) 필요, `.bat` wrapper 유지 필요
- **Follow-ups:** v2에서 stream-json 양방향 I/O 검토, Windows native Node.js 대안 평가

---

## Context

- **환경:** WSL2 Linux, Node.js v24.13.1 (NVM), Claude Code CLI v2.1.138
- **Claude Code:** 글로벌 설치됨 (`/home/fanta/.nvm/versions/node/v24.13.1/bin/claude`)
- **SDK 상태:** 프로그래밍 API 미제공, CLI 바이너리만 존재 -> CLI child process 방식 사용
- **Windows Chrome:** Native Host manifest는 Windows 레지스트리 `HKCU\Software\Google\Chrome\NativeMessagingHosts\`에서 조회

---

## Work Objectives

MVP Chrome Extension을 구현하여 다음을 달성:
1. Side Panel에서 현재 페이지 URL/title 표시 + Claude Code 채팅
2. Native Messaging Host를 통한 로컬 Claude Code CLI 호출
3. MCP tool 결과 렌더링, 로컬 파일 I/O, slash 명령어 지원
4. Claude Code 미설치 감지 및 안내

---

## Guardrails

### Must Have
- Manifest V3 + Side Panel API
- Native Messaging (포트 없음)
- 현재 페이지 URL/title 자동 컨텍스트
- Claude Code CLI `--print` 모드 + `--verbose --bare --permission-mode bypassPermissions` 플래그
- stream-json 이벤트 필터링 (assistant/result만 처리, system/rate_limit 무시)
- readline 기반 스트림 파싱 (chunk split 금지)
- stderr 처리 및 동시 요청 관리
- 에러 처리 (미설치, 타임아웃, 연결 실패)
- Windows 레지스트리 기반 Native Host 등록 (install.ps1)

### Must NOT Have
- Anthropic API 직접 호출
- localhost 포트 오픈
- 클라우드 백엔드
- 빌드 도구 (Webpack/Vite 등) - 순수 HTML/CSS/JS로 MVP
- React/Vue 등 프레임워크
- Linux 경로 기반 Native Host 등록 (Windows Chrome에서 동작 불가)

---

## File Structure

```
claude_chrome_ext/
├── extension/                          # Chrome Extension
│   ├── manifest.json                   # Manifest V3, Side Panel, Native Messaging
│   ├── background/
│   │   └── service-worker.js           # Native Messaging 연결, 메시지 라우팅
│   ├── sidepanel/
│   │   ├── panel.html                  # 채팅 UI (marked.js CDN 포함)
│   │   ├── panel.js                    # UI 로직, 메시지 송수신
│   │   └── panel.css                   # 스타일
│   └── icons/
│       ├── icon16.png                  # Canvas API 또는 SVG로 생성
│       ├── icon48.png
│       └── icon128.png
├── native-host/                        # Native Messaging Host
│   ├── package.json                    # dependencies: 없음 (순수 Node.js)
│   ├── host.js                         # 메인 엔트리 (stdin/stdout 프로토콜)
│   ├── claude-bridge.js                # Claude CLI spawn + 출력 파싱
│   ├── host-wrapper.bat                # NEW: Windows Chrome이 호출하는 진입점
│   └── install.ps1                     # NEW: Windows 레지스트리에 Native Host 등록
├── scripts/
│   ├── setup.sh                        # WSL2 측 설치 (npm install + install.ps1 호출 안내)
│   └── generate-icons.js               # Canvas API로 아이콘 PNG 생성 (또는 SVG 직접 사용)
├── doc/
│   └── design.md                       # 설계 문서 (기존)
└── .gitignore
```

---

## Task Flow (6 Steps)

### Step 1: 프로젝트 초기화 + Native Host 기반 구축

**작업:**
- `native-host/package.json` 생성 (type: module, no dependencies)
- `native-host/host.js` 구현:
  - stdin에서 4바이트 little-endian 길이 접두사 읽기
  - JSON 메시지 파싱
  - 응답을 동일 프로토콜로 stdout에 쓰기
  - 기본 메시지 타입: `ping`, `chat`, `slash`, `check-claude`
- `native-host/claude-bridge.js` 구현:
  - `which claude` 또는 직접 경로로 Claude CLI 존재 확인
  - CLI 호출 (올바른 플래그):
    ```javascript
    spawn('claude', [
      '--print',
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--bare',
      '--permission-mode', 'bypassPermissions',
    ])
    ```
  - **readline 기반 스트림 파싱** (chunk split 금지):
    ```javascript
    import { createInterface } from 'readline';
    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      const event = JSON.parse(line);
      if (event.type === 'assistant' || event.type === 'result') {
        sendToExtension(event);
      }
      // system, rate_limit_event 등은 무시
    });
    ```
  - **stderr 처리:**
    ```javascript
    child.stderr.on('data', (data) => {
      const errMsg = data.toString();
      // 에러 메시지 파싱, 필요시 Extension에 전달
      sendToExtension({ type: 'error', message: errMsg });
    });
    ```
  - **동시 요청 처리:** 이전 child process가 실행 중이면 `child.kill()` 후 새 요청 처리
  - 세션 관리 (세부 사항은 Step 4):
    - 첫 메시지: `--session-id` 없이 호출
    - `system/init` 이벤트에서 `session_id` 필드 추출하여 저장
    - 후속 메시지: `--resume <저장된 session_id>` 플래그 사용
  - 에러 핸들링 (미설치, 타임아웃, 비정상 종료)

**수락 기준:**
- [ ] `echo '{"type":"ping"}' | node host.js` 실행 시 `{"type":"pong"}` 응답 (수동 테스트용 래퍼 필요)
- [ ] `check-claude` 메시지에 대해 Claude CLI 경로와 버전 반환
- [ ] `chat` 메시지에 대해 Claude CLI 호출 후 응답 스트리밍 반환
- [ ] Claude 미설치 시 `{"type":"error","code":"CLAUDE_NOT_FOUND"}` 반환
- [ ] readline 기반 파싱으로 `assistant`/`result` 이벤트만 Extension에 전달
- [ ] 이전 요청 실행 중 새 요청 시 이전 프로세스 abort 후 새 요청 처리

### Step 2: Chrome Extension 기본 구조 + Side Panel UI

**작업:**
- `extension/manifest.json` 작성:
  ```json
  {
    "manifest_version": 3,
    "name": "Claude Code Extension",
    "version": "0.1.0",
    "permissions": ["sidePanel", "activeTab", "tabs", "nativeMessaging"],
    "side_panel": { "default_path": "sidepanel/panel.html" },
    "background": { "service_worker": "background/service-worker.js" },
    "action": { "default_title": "Claude Code" },
    "icons": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
  }
  ```
- `extension/sidepanel/panel.html`:
  - 채팅 UI (헤더에 페이지 컨텍스트 영역, 메시지 목록, 입력창)
  - **마크다운 렌더링을 위해 CDN에서 `marked.js` 로드:**
    ```html
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    ```
- `extension/sidepanel/panel.css`: 깔끔한 채팅 스타일 (다크/라이트 기본 지원)
- `extension/sidepanel/panel.js`:
  - Service Worker와 `chrome.runtime.sendMessage`로 통신
  - 메시지 렌더링 (user/assistant/tool/error 타입 구분)
  - `marked.js`를 사용한 마크다운 렌더링 (코드블록, 볼드 등)
  - Slash 명령어 감지 (`/`로 시작하는 입력)
  - 페이지 컨텍스트 헤더 표시
- **아이콘 생성:** `scripts/generate-icons.js`로 Canvas API를 사용해 PNG 생성, 또는 SVG 파일을 직접 `icons/` 디렉토리에 배치

**수락 기준:**
- [ ] `chrome://extensions`에서 로드 시 에러 없음
- [ ] 확장 아이콘 클릭 시 Side Panel 열림
- [ ] 채팅 입력창에 텍스트 입력 + 전송 가능
- [ ] UI에 페이지 컨텍스트 영역 존재
- [ ] 아이콘이 16/48/128px로 정상 표시

### Step 3: Windows Native Host 등록 + Service Worker 연결

**작업:**
- `native-host/host-wrapper.bat` 생성:
  ```bat
  @echo off
  wsl.exe -e /home/fanta/.nvm/versions/node/v24.13.1/bin/node "/home/fanta/study/FrontEnd/claude_chrome_ext/native-host/host.js"
  ```
- `native-host/install.ps1` 구현 (PowerShell):
  1. Native Host manifest JSON을 Windows 경로에 생성 (예: `$env:APPDATA\claude-ext\com.claude.ext.host.json`):
     ```json
     {
       "name": "com.claude.ext.host",
       "description": "Claude Code Chrome Extension Native Host",
       "path": "C:\\...\\host-wrapper.bat",
       "type": "stdio",
       "allowed_origins": ["chrome-extension://<EXTENSION_ID>/"]
     }
     ```
     - `path`: `host-wrapper.bat`의 Windows 절대 경로 (스크립트가 자동 감지)
     - `allowed_origins`: Extension ID를 파라미터로 받거나, 개발 모드 로드 후 `chrome://extensions`에서 확인한 ID를 입력
  2. Windows 레지스트리 등록:
     ```powershell
     New-Item -Path "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.claude.ext.host" -Force
     Set-ItemProperty -Path "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.claude.ext.host" -Name "(Default)" -Value "$manifestPath"
     ```
  3. Extension ID 처리: 스크립트 실행 시 파라미터로 받음 (`.\install.ps1 -ExtensionId "abcdef..."`)
     - 먼저 Step 2에서 Extension을 개발 모드로 로드하여 ID 확인
     - 해당 ID를 `install.ps1` 실행 시 전달
- `extension/background/service-worker.js` 구현:
  - `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`
  - `chrome.tabs.onActivated` / `chrome.tabs.onUpdated`로 현재 탭 URL/title 추적
  - `chrome.runtime.connectNative('com.claude.ext.host')`로 Native Host 연결
  - Side Panel <-> Service Worker <-> Native Host 메시지 브릿지
  - 연결 실패 시 에러 메시지를 Side Panel에 전달

**수락 기준:**
- [ ] `install.ps1` 실행 후 Windows 레지스트리에 `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.claude.ext.host` 키 생성됨
- [ ] 레지스트리 키의 기본값이 manifest JSON 파일의 Windows 절대 경로를 가리킴
- [ ] manifest JSON의 `path`가 `host-wrapper.bat`의 Windows 절대 경로
- [ ] manifest JSON의 `allowed_origins`에 올바른 Extension ID 포함
- [ ] `host-wrapper.bat` 실행 시 WSL2의 Node.js로 `host.js` 정상 실행
- [ ] Extension에서 Native Host 연결 성공 (chrome://extensions 에러 없음)
- [ ] Side Panel에서 메시지 입력 시 Native Host까지 전달되고 응답 수신
- [ ] 현재 탭 전환 시 Side Panel의 페이지 컨텍스트가 업데이트됨

### Step 4: Claude Code 채팅 통합

**작업:**
- Service Worker에서 `chat` 메시지 처리 완성:
  - 현재 페이지 URL/title을 프롬프트에 시스템 컨텍스트로 주입
  - 프롬프트 포맷: `"[Context: 현재 페이지 URL={url}, Title={title}]\n\n{user_message}"`
  - Native Host를 통해 Claude CLI 호출
  - 스트리밍 응답을 Side Panel에 실시간 전달
- Side Panel에서 응답 렌더링:
  - assistant 메시지: `marked.js`로 마크다운 렌더링 (코드블록, 볼드 등)
  - tool_use 메시지: 도구 이름 + 결과를 접이식 카드로 표시
  - 로딩 인디케이터 (스트리밍 중)
- **세션 관리 (CLI 기반 session_id 추출):**
  - 첫 메시지: `--session-id` 없이 호출
  - `system/init` 이벤트에서 `session_id` 필드를 추출하여 메모리에 저장
  - 후속 메시지: `--resume <저장된 session_id>` 플래그 사용
  - `/clear` 시: 저장된 session_id 삭제 (다음 메시지에서 새 세션 시작)

**수락 기준:**
- [ ] 채팅 입력 -> Claude 응답이 Side Panel에 표시
- [ ] 응답에 페이지 컨텍스트가 반영됨 ("이 페이지는..." 류 질문에 정확한 답변)
- [ ] 연속 대화 시 이전 맥락 유지 (세션 이어가기)
- [ ] 스트리밍 중 로딩 표시, 완료 시 해제
- [ ] 첫 메시지 응답에서 session_id가 추출되어 저장됨
- [ ] 두 번째 메시지부터 `--resume`으로 호출됨을 로그로 확인 가능

### Step 5: MCP/Tool 결과 렌더링 + Slash 명령어 + 파일 I/O

**작업:**
- Claude CLI `stream-json` 출력에서 tool_use/tool_result 이벤트 파싱
- Side Panel에서 MCP tool 결과 렌더링:
  - 도구명, 입력 파라미터, 결과를 구조화된 카드로 표시
  - 파일 경로가 포함된 결과는 경로를 강조 표시
- Slash 명령어 처리:
  - `/clear`: 채팅 히스토리 초기화 + 저장된 session_id 삭제 (세션 리셋)
  - `/help`: 사용 가능한 명령어 목록 표시
  - 기타 Claude Code slash 명령어: CLI에 그대로 전달
- 파일 I/O 결과:
  - 파일 저장/읽기 결과에서 경로 추출
  - 채팅에 "파일 저장됨: /path/to/file" 형태로 표시

**수락 기준:**
- [ ] MCP tool 호출 시 도구명과 결과가 채팅에 카드 형태로 표시
- [ ] `/clear` 입력 시 채팅 히스토리 초기화 + session_id 삭제
- [ ] `/help` 입력 시 명령어 안내 표시
- [ ] 파일 저장 요청 시 저장 경로가 채팅에 표시

### Step 6: 에러 처리 + 설치 스크립트 + 통합 테스트

**작업:**
- Claude Code 미설치 감지 강화:
  - Native Host 시작 시 `which claude` 체크
  - 미설치 시 Extension UI에 설치 안내 카드 표시 (npm install 명령어 포함)
- 에러 처리 정리:
  - Native Host 연결 실패: "Native Host를 설치해주세요" 안내 (install.ps1 실행 안내)
  - CLI 타임아웃 (60초): 자동 재시도 또는 사용자 안내
  - JSON 파싱 에러: 무시하고 다음 메시지 대기
  - stderr 에러: 파싱 후 사용자에게 의미 있는 에러 메시지 전달
- `scripts/setup.sh` 통합 설치:
  - Node.js 버전 확인
  - `cd native-host && npm install` (의존성 있을 경우)
  - PowerShell 스크립트 실행 안내 출력:
    ```
    echo "Windows PowerShell에서 다음을 실행하세요:"
    echo "  cd $(wslpath -w $(pwd)/native-host)"
    echo "  powershell -ExecutionPolicy Bypass -File install.ps1 -ExtensionId <YOUR_EXTENSION_ID>"
    ```
  - Extension 로드 안내 메시지 출력
- 수동 통합 테스트 체크리스트 실행

**수락 기준:**
- [ ] Claude Code 미설치 환경에서 Extension이 설치 안내를 표시
- [ ] Native Host 미등록 시 명확한 에러 메시지
- [ ] `setup.sh` 실행 후 install.ps1 실행 안내가 출력됨
- [ ] install.ps1 한 번 실행으로 Windows 레지스트리 등록 완료
- [ ] 전체 수락 기준 7개 항목 통과

---

## Key Implementation Details

### Native Messaging Protocol

```
[4 bytes: message length (uint32 LE)] [JSON message bytes]
```

**Host -> Extension 메시지 타입:**
```javascript
// 읽기
const rawLength = Buffer.alloc(4);
process.stdin.read(4) -> rawLength
const messageLength = rawLength.readUInt32LE(0);
const messageBuffer = process.stdin.read(messageLength);
const message = JSON.parse(messageBuffer.toString('utf-8'));

// 쓰기
function sendMessage(msg) {
  const json = JSON.stringify(msg);
  const buffer = Buffer.from(json, 'utf-8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buffer.length, 0);
  process.stdout.write(header);
  process.stdout.write(buffer);
}
```

### Claude CLI 호출 패턴

```javascript
import { spawn } from 'child_process';
import { createInterface } from 'readline';

let currentChild = null; // 동시 요청 관리용

function callClaude(prompt, sessionId, pageContext) {
  // 이전 요청이 실행 중이면 abort
  if (currentChild) {
    currentChild.kill('SIGTERM');
    currentChild = null;
  }

  const systemPrompt = `현재 사용자가 보고 있는 웹페이지 - URL: ${pageContext.url}, Title: ${pageContext.title}`;
  
  const args = [
    '--print',
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--bare',
    '--permission-mode', 'bypassPermissions',
    '--append-system-prompt', systemPrompt
  ];
  
  if (sessionId) {
    args.push('--resume', sessionId);
  }
  
  const child = spawn('claude', args, {
    env: { ...process.env, PATH: process.env.PATH }
  });
  currentChild = child;
  
  // readline 기반 스트림 파싱 (chunk split 금지)
  const rl = createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    try {
      const event = JSON.parse(line);
      if (event.type === 'assistant' || event.type === 'result') {
        sendMessage({ type: 'stream', event });
      }
      // system, rate_limit_event 등은 무시
    } catch (e) { /* skip non-JSON lines */ }
  });
  
  // stderr 처리
  child.stderr.on('data', (data) => {
    const errMsg = data.toString().trim();
    if (errMsg) {
      sendMessage({ type: 'error', message: errMsg });
    }
  });
  
  child.on('close', (code) => {
    currentChild = null;
    if (code !== 0) {
      sendMessage({ type: 'error', code: 'CLI_EXIT', exitCode: code });
    }
  });
}
```

### 세션 관리 상세

```javascript
let savedSessionId = null;

// 첫 메시지: --session-id 없이 호출
// system/init 이벤트에서 session_id 추출 (readline 파싱 중)
rl.on('line', (line) => {
  const event = JSON.parse(line);
  
  // session_id 추출 (system/init 이벤트)
  if (event.type === 'system' && event.session_id && !savedSessionId) {
    savedSessionId = event.session_id;
  }
  
  // assistant/result만 Extension에 전달
  if (event.type === 'assistant' || event.type === 'result') {
    sendMessage({ type: 'stream', event });
  }
});

// 후속 메시지: --resume <savedSessionId>
// /clear 시: savedSessionId = null
```

### WSL2/Windows 경계 아키텍처

```
Windows Chrome
    |
    | Native Messaging (stdin/stdout)
    v
host-wrapper.bat  (Windows)
    |
    | wsl.exe -e node host.js
    v
host.js  (WSL2 Linux)
    |
    | child_process.spawn
    v
claude CLI  (WSL2 Linux)
```

- **host-wrapper.bat**: Windows Chrome이 직접 호출하는 진입점. `wsl.exe`를 통해 WSL2의 Node.js로 `host.js` 실행
- **install.ps1**: Windows 레지스트리에 Native Host manifest 경로 등록
- **install.sh 제거**: Linux 경로 기반 등록은 Windows Chrome에서 동작하지 않음

### Extension ID 처리 절차

1. Step 2에서 Extension을 `chrome://extensions` > "개발자 모드" > "압축 해제된 확장 로드"로 로드
2. 로드 후 표시되는 Extension ID를 복사 (예: `abcdefghijklmnopqrstuvwxyz123456`)
3. Step 3에서 `install.ps1 -ExtensionId "abcdefghijklmnopqrstuvwxyz123456"` 실행
4. manifest JSON의 `allowed_origins`에 해당 ID가 자동으로 반영됨

---

## Test Strategy

### 수동 테스트 (MVP)
1. **Native Host 단독 테스트:** stdin에 프로토콜 형식으로 메시지 전송, 응답 확인
2. **host-wrapper.bat 테스트:** Windows CMD에서 직접 실행하여 WSL2 Node.js 호출 확인
3. **Extension 로드 테스트:** chrome://extensions에서 오류 없이 로드
4. **레지스트리 테스트:** `install.ps1` 실행 후 `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.claude.ext.host` 확인
5. **Side Panel 테스트:** 아이콘 클릭 -> 패널 열림 -> 페이지 정보 표시
6. **채팅 테스트:** 메시지 입력 -> Claude 응답 수신 -> 렌더링
7. **세션 테스트:** 연속 대화 -> 이전 맥락 유지 확인
8. **MCP 테스트:** MCP tool 호출이 포함된 질문 -> 결과 카드 표시
9. **Slash 테스트:** `/clear`, `/help` 입력 -> 올바른 동작
10. **에러 테스트:** Native Host 미등록 / Claude 미설치 상황 시뮬레이션

### 자동 테스트 (Optional, v1.1)
- Native Host 메시지 파싱 유닛 테스트 (Node.js assert)
- Claude Bridge mock 테스트

---

## Success Criteria

- [ ] 확장 아이콘 클릭 -> Side Panel 열림 -> 현재 페이지 URL/title 자동 표시
- [ ] 페이지 내용 관련 질문 -> Claude가 페이지 컨텍스트 활용 답변
- [ ] MCP tool 호출 -> 결과가 채팅 메시지로 렌더링
- [ ] 파일 저장 요청 -> 로컬 파일 저장 + 채팅에 경로 표시
- [ ] Claude Code 미설치 -> Extension UI에 설치 안내
- [ ] Slash 명령어 입력 -> Claude Code가 처리 후 결과 반환
- [ ] Native Messaging Host가 Windows 레지스트리에 정상 등록 + host-wrapper.bat를 통해 WSL2 연결
