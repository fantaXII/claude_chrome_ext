# Claude Code Chrome Extension

현재 보고 있는 웹페이지 컨텍스트(URL · 제목)를 자동으로 포함하여 **Claude Code CLI와 직접 대화**할 수 있는 Chrome Side Panel 확장입니다.

---

## 목차

- [주요 기능](#주요-기능)
- [폴더 구조](#폴더-구조)
- [아키텍처 및 동작 흐름](#아키텍처-및-동작-흐름)
- [설계 과정](#설계-과정)
- [설치 방법](#설치-방법)
- [슬래시 명령어](#슬래시-명령어)
- [보안](#보안)
- [개발 환경](#개발-환경)

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| **Side Panel 채팅** | Chrome 우측 사이드 패널에서 Claude Code와 실시간 스트리밍 채팅 |
| **페이지 컨텍스트** | 현재 탭의 URL과 제목을 자동으로 시스템 프롬프트에 포함 |
| **세션 유지** | 대화 흐름 유지 (`--resume` 플래그로 동일 세션 재사용) |
| **슬래시 명령어** | `/clear`, `/help` 등 로컬 명령어 및 Claude Code 슬래시 명령어 전달 |
| **스트리밍 렌더링** | `stream-json` 포맷으로 응답을 토큰 단위로 실시간 표시 |
| **Markdown 렌더링** | 코드 블록, 볼드, 이탤릭, 링크, 헤딩 지원 |

---

## 폴더 구조

```
claude_chrome_ext/
├── extension/                  # Chrome Extension 소스
│   ├── manifest.json           # Manifest V3 설정
│   ├── background/
│   │   └── service-worker.js   # Side Panel ↔ Native Host 브릿지
│   ├── sidepanel/
│   │   ├── panel.html          # 채팅 UI
│   │   ├── panel.css           # 다크/라이트 테마 스타일
│   │   └── panel.js            # 메시지 처리 및 Markdown 렌더러
│   └── icons/
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
│
├── native-host/                # Node.js Native Messaging Host
│   ├── host.js                 # 바이너리 프로토콜 처리 (4바이트 길이 접두)
│   ├── claude-bridge.js        # Claude CLI 스폰 및 스트림 파싱
│   ├── package.json            # { "type": "module" }
│   ├── host-wrapper.bat        # Windows → WSL2 브릿지 (wsl.exe -e node)
│   └── install.ps1             # Windows 레지스트리 등록 스크립트
│
├── scripts/
│   ├── generate-icons.js       # 순수 Node.js PNG 아이콘 생성기
│   └── setup.sh                # WSL2 개발 환경 셋업 헬퍼
│
├── .omc/
│   ├── plans/                  # Ralplan 합의 계획 문서
│   └── specs/                  # Deep Interview 요구사항 스펙
│
└── .gitignore
```

---

## 아키텍처 및 동작 흐름

```
[Chrome Side Panel]
      │  port.postMessage({ type: 'chat', prompt, pageContext })
      ▼
[Service Worker]          (Manifest V3 — Background)
      │  ALLOWED_MSG_TYPES 화이트리스트 검증
      │  chrome.runtime.connectNative('com.claude.ext.host')
      ▼
[host-wrapper.bat]        (Windows 레지스트리 등록)
      │  wsl.exe -e node host.js
      ▼
[host.js]                 (Native Messaging Host — Node.js ESM)
      │  4바이트 LE 길이 접두 바이너리 프로토콜
      │  수신 메시지 크기 검증 (≤ 1MB)
      ▼
[claude-bridge.js]        (Claude CLI 브릿지)
      │  spawn('claude', ['--print', '-p', prompt,
      │                   '--output-format', 'stream-json',
      │                   '--verbose', '--bare',
      │                   '--permission-mode', 'bypassPermissions'])
      │  readline 기반 라인별 JSON 파싱
      ▼
[Claude Code CLI]         (로컬 설치된 Claude Code)
      │
      ├─ system 이벤트 → session_id 추출 → 이후 --resume 재사용
      ├─ assistant 이벤트 → 스트리밍 텍스트 전달
      └─ result 이벤트 → 최종 응답 전달
```

### 주요 설계 결정

| 결정 사항 | 이유 |
|-----------|------|
| **Native Messaging** | Chrome Extension에서 로컬 프로세스(Claude CLI)를 직접 실행하는 유일한 방법 |
| **WSL2 래퍼** (`host-wrapper.bat`) | Windows Chrome은 Windows 바이너리만 실행 가능 → `.bat`이 WSL2 Node.js를 호출 |
| **readline 파싱** | `stdout.on('data')` chunk 단위는 부분 JSON이 올 수 있어 라인 단위 파싱이 필수 |
| **`stdio: ['ignore', 'pipe', 'pipe']`** | stdin을 무시하지 않으면 Claude CLI가 "no stdin data" 경고를 출력 |
| **`finished` 플래그** | `close`와 `error` 이벤트가 동시에 발화하는 race condition 방지 |
| **`stream-json` + `--verbose`** | `--verbose` 없이는 `--output-format stream-json`이 동작하지 않음 |

---

## 설계 과정

이 프로젝트는 **3단계 AI 파이프라인**으로 설계·구현되었습니다.

```
1. Deep Interview          2. Ralplan (합의 계획)      3. Autopilot (실행)
┌─────────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
│ Socratic Q&A 6라운드 │   │ Planner 초안 작성     │   │ 구현 → QA → 검증     │
│ 모호성 점수 11.6%    │──▶│ Architect 검토        │──▶│ 보안 리뷰 (OWASP)    │
│ .omc/specs/ 저장     │   │ Critic 검증 (2회)     │   │ 코드 품질 리뷰       │
└─────────────────────┘   └──────────────────────┘   └──────────────────────┘
```

스펙과 계획 문서는 `.omc/specs/`와 `.omc/plans/`에 보존되어 있습니다.

---

## 설치 방법

### 사전 요구사항

- **Windows** + **WSL2** (Ubuntu 권장)
- **Node.js** (WSL2 내 설치, nvm 권장)
- **Claude Code CLI** 설치

```bash
# WSL2 터미널에서
npm install -g @anthropic-ai/claude-code
```

---

### 1단계 — 아이콘 생성

```bash
# WSL2 터미널 (프로젝트 루트)
node scripts/generate-icons.js
```

`extension/icons/` 에 `icon16.png`, `icon48.png`, `icon128.png` 생성됩니다.

---

### 2단계 — Chrome에 확장 로드

1. Chrome 주소창에 `chrome://extensions` 입력
2. 우측 상단 **개발자 모드** 활성화
3. **압축 해제된 확장 프로그램을 로드합니다** 클릭
4. 이 저장소의 **`extension/`** 폴더 선택
5. 표시된 **Extension ID** (32자 소문자) 복사

---

### 3단계 — Native Host 등록 (PowerShell)

**PowerShell을 관리자 권한으로 실행**한 후:

```powershell
cd <이 저장소 경로>\native-host

# 직접 ID 지정
.\install.ps1 -ExtensionId "abcdefghijklmnopabcdefghijklmnop"

# 또는 ID 없이 실행하면 안내 후 입력 프롬프트 표시
.\install.ps1
```

> Extension ID는 `chrome://extensions`에서 확장 카드 아래 표시되는 32자 문자열입니다.

---

### 4단계 — host-wrapper.bat 경로 확인

`native-host/host-wrapper.bat`을 열어 Node.js 경로가 WSL2 환경과 일치하는지 확인합니다.

```bat
@echo off
wsl.exe -e /home/<사용자>/.nvm/versions/node/<버전>/bin/node ^
    /home/<사용자>/path/to/claude_chrome_ext/native-host/host.js
```

WSL2 터미널에서 다음으로 확인:

```bash
which node     # Node.js 경로
pwd            # 현재 디렉토리 (프로젝트 경로)
```

---

### 5단계 — Chrome 재시작 및 사용

1. Chrome을 **완전히 종료** 후 재시작 (모든 창 닫기)
2. 임의의 웹페이지로 이동
3. 주소창 오른쪽 **Claude Code 아이콘** 클릭
4. 우측 Side Panel에서 채팅 시작

---

### 문제 해결

| 증상 | 원인 | 해결 |
|------|------|------|
| "Native Host 연결 실패" | 레지스트리 미등록 | `install.ps1` 재실행 후 Chrome 재시작 |
| "Claude Code가 설치되지 않음" | WSL2에 claude 미설치 | `npm install -g @anthropic-ai/claude-code` |
| Side Panel이 열리지 않음 | Chrome 버전 부족 | Chrome 114 이상 필요 |
| BAT 파일 경로 오류 | Node 경로 불일치 | `host-wrapper.bat` 경로 수정 |

---

## 슬래시 명령어

| 명령어 | 동작 |
|--------|------|
| `/clear` | 대화 초기화 (세션 리셋) |
| `/help` | 사용 가능한 명령어 목록 표시 |
| 기타 `/명령어` | Claude Code로 그대로 전달 |

---

## 보안

Phase 4 검증(OWASP Top 10 기준)을 통과한 보안 구현:

- **Shell Injection 방지** — `execFileSync` + `shell: false`, `readdirSync`/`existsSync`로 NVM 탐색 (shell 없음)
- **Prompt Injection 방지** — `pageContext` URL/제목에서 줄바꿈 제거 및 길이 제한 (500/200자)
- **XSS 방지** — 모든 사용자 입력 `escHtml()` 처리, `href` 프로토콜 화이트리스트 (`https?://`만 허용)
- **메시지 타입 화이트리스트** — Service Worker에서 허용된 6개 타입만 Native Host로 전달
- **크기 제한** — 송신 메시지 1MB, 수신 메시지 1MB, 프롬프트 50KB
- **ExtensionId 검증** — `install.ps1`에서 `^[a-p]{32}$` 정규식 검증

---

## 개발 환경

| 항목 | 버전/정보 |
|------|-----------|
| Chrome | 114+ (Side Panel API 지원) |
| Manifest | V3 |
| Node.js | 18+ (ESM `import` 사용) |
| Claude Code CLI | 최신 버전 권장 |
| OS | Windows + WSL2 |

---

## 라이선스

MIT
