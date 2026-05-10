# Deep Interview Spec: Claude Chrome Extension

## Metadata
- Interview ID: chrome-ext-2026-05-10
- Rounds: 6
- Final Ambiguity Score: 11.6%
- Type: greenfield
- Generated: 2026-05-10
- Threshold: 20%
- Status: PASSED

## Clarity Breakdown
| 차원 | 점수 | 가중치 | 가중 점수 |
|------|------|--------|----------|
| Goal Clarity | 0.92 | 40% | 0.368 |
| Constraint Clarity | 0.82 | 30% | 0.246 |
| Success Criteria | 0.90 | 30% | 0.270 |
| **Total Clarity** | | | **0.884** |
| **Ambiguity** | | | **11.6%** |

---

## Goal

현재 브라우저 페이지의 URL과 title을 자동으로 읽어 컨텍스트로 삼고, Chrome Extension Side Panel에서 Claude Code와 채팅할 수 있는 확장 프로그램. MCP 도구 연동, 로컬 파일 I/O, Slash 명령어를 지원하며 Native Messaging Host를 통해 로컬 Claude Code와 통신한다.

---

## Architecture

```
Chrome Extension (Side Panel UI)
    ↕  chrome.runtime.connectNative() — stdin/stdout, 포트 없음
Native Messaging Host (Node.js 스크립트, OS에 등록)
    ↕  Child Process spawn
Claude Code CLI / @anthropic-ai/claude-code SDK
    ↕
MCP Servers (로컬 실행) / Local File System
```

---

## Constraints

- **통신 방식:** Native Messaging Host (포트 없음, Chrome 공식 API)
- **Claude 연동:** Claude Code CLI 또는 `@anthropic-ai/claude-code` SDK를 Native Host가 래핑
- **추가 API 비용 없음:** 기존 Claude Code 구독 사용
- **Claude Code 미설치 시:** Native Host가 감지 후 Extension UI에 설치 안내 표시
- **Claude Code 이미 실행 중 시:** 별도 비대화형 자식 프로세스로 독립 실행 (충돌 없음)
- **포트 충돌 없음:** Native Messaging은 stdin/stdout 사용, 포트 불필요
- **OS 지원 범위:** MVP는 개발자 본인 환경 (Windows WSL2 기준) 우선
- **MCP:** Claude Code가 관리하는 로컬 MCP 서버 활용
- **로컬 파일:** Native Host를 통해 파일시스템 접근

## Non-Goals

- 클라우드 백엔드 서버 운영
- Anthropic API 직접 호출 (비용 문제)
- 시스템 트레이 컴패니언 앱 (v2 로드맵)
- 자동 실행 자동화 (Native Messaging이 on-demand 처리)
- 다중 브라우저 지원 (Chrome 전용 MVP)
- 모바일 지원

---

## Acceptance Criteria

- [ ] 확장 아이콘 클릭 시 Side Panel이 열리고, 현재 페이지 URL과 title이 채팅 헤더/컨텍스트에 자동 표시됨
- [ ] 사용자가 페이지 내용에 관한 질문을 입력하면 Claude가 페이지 컨텍스트를 활용해 답변함
- [ ] MCP tool 호출 시 결과가 채팅 메시지(카드 또는 텍스트)로 렌더링됨
- [ ] "저장해줘" 등 파일 저장 요청 시 로컬 파일로 저장되고, 저장 경로가 채팅에 표시됨
- [ ] Claude Code 미설치 감지 시 Extension UI에 설치 안내 메시지 표시
- [ ] Slash 명령어 (`/help`, `/clear` 등 Claude Code 명령어)가 채팅 입력에서 인식되고 실행됨
- [ ] Native Messaging Host가 Chrome에 정상 등록되어 Extension과 통신 가능

---

## Assumptions Exposed & Resolved

| 가정 | 도전 질문 | 결정 |
|------|----------|------|
| Claude API 직접 호출 | 비용 추가 발생 → 거부 | Claude Code 래핑으로 해결 |
| Extension이 프로세스 직접 실행 | Chrome 샌드박스 제약 | Native Messaging Host 사용 |
| 자동 실행 필수 | Native Messaging이 on-demand 처리 가능 | 별도 자동 실행 불필요 |
| 포트 충돌 위험 | Native Messaging은 포트 미사용 | 충돌 없음 확인 |
| 모든 기능 MVP 포함 | 범위 과대 위험 | 4가지 핵심 기능만 MVP 확정 |

---

## Technical Context

- **플랫폼:** Linux (WSL2) + Chrome Browser
- **Native Messaging 등록:** `~/.config/google-chrome/NativeMessagingHosts/{name}.json`
- **Extension:** Manifest V3 (Side Panel API 사용)
- **Native Host 언어:** Node.js (Claude Code SDK 사용 용이)
- **통신 프로토콜:** Chrome Native Messaging (4바이트 길이 접두사 + JSON)

---

## Ontology (Key Entities)

| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| ChromeExtension | core domain | manifest, permissions, side_panel | uses SidePanel, sends to NativeHost |
| SidePanel | supporting UI | title, chat_messages, input | displays Page context, renders Messages |
| Page | external context | url, title, content | read by ChromeExtension via chrome.tabs API |
| ClaudeCode | external system | version, tools, slash_commands | invoked by NativeHost |
| NativeHost | core domain | script_path, manifest, protocol | bridges Extension ↔ ClaudeCode |
| MCP | external system | server_url, tools | managed by ClaudeCode |
| Tool | supporting | name, parameters, result | called by ClaudeCode, result in SidePanel |
| SlashCommand | supporting | command, args | parsed from chat input, forwarded to ClaudeCode |
| LocalFile | supporting | path, content | read/written by NativeHost via ClaudeCode |
| AutoLauncher | supporting | detection_logic, error_message | checks ClaudeCode install, handles errors |

---

## Ontology Convergence

| Round | Entity Count | New | Changed | Stable | Stability Ratio |
|-------|-------------|-----|---------|--------|----------------|
| 1 | 2 | 2 | - | - | N/A |
| 2 | 9 | 7 | 0 | 2 | 22% |
| 3 | 9 | 1 | 1 | 7 | 89% |
| 4 | 10 | 1 | 0 | 9 | 90% |
| 5 | 10 | 0 | 0 | 10 | 100% |
| 6 | 10 | 0 | 0 | 10 | 100% |

---

## Interview Transcript

<details>
<summary>Full Q&A (6 rounds)</summary>

### Round 1
**Q:** Chrome 확장을 사용자가 활성화하면, 구체적으로 어떤 일이 일어나야 하나요?
**A:** Claude AI로 페이지 분석
**Ambiguity:** 82% (Goal: 0.30, Constraints: 0.10, Criteria: 0.10)

### Round 2
**Q:** Claude AI가 페이지를 분석한 후, 사용자에게 어떤 형태로 결과가 나타나야 하나요?
**A:** 확장 시작 시 현재 페이지 URL/title을 Chrome API로 읽고 Side Panel로 채팅창 오픈. MCP/tool/skill/cowork 활용 답변, 로컬 파일 저장/읽기, Claude Code slash 명령어 지원.
**Ambiguity:** 55% (Goal: 0.75, Constraints: 0.20, Criteria: 0.30)

### Round 3
**Q:** Claude와의 통신 방식 (직접 API vs 로컬 서버 래퍼)
**A:** 로컬 REST 래퍼 방식 (Claude Code를 서버로). 직접 API는 비용 문제로 제외.
**Ambiguity:** 41% (Goal: 0.80, Constraints: 0.55, Criteria: 0.35)

### Round 4
**Q:** MVP 필수 기능 (Contrarian Mode)
**A:** 4가지 전부: Side panel 채팅, MCP 연동, 로컬 파일 I/O, Slash 명령어. + Claude Code 자동 실행.
**Ambiguity:** 31.5% (Goal: 0.85, Constraints: 0.55, Criteria: 0.60)

### Round 5
**Q:** 자동 실행 메커니즘 — Native Messaging vs 시스템 트레이 vs 수동
**A:** Native Messaging으로 바로 시작. 포트 충돌/미설치 처리 방법 확인.
→ Native Messaging은 포트 없음 확인, 미설치 감지 로직 설계 완료.
**Ambiguity:** 23.4% (Goal: 0.88, Constraints: 0.78, Criteria: 0.60)

### Round 6
**Q:** 완성 기준 3가지 (Simplifier Mode)
**A:** Side panel 자동 title 입력 + Claude 페이지 답변 + MCP 결과 표시 + 로컬 파일 저장. + doc/design.md 생성 및 .gitignore 요청.
**Ambiguity:** 11.6% (Goal: 0.92, Constraints: 0.82, Criteria: 0.90)

</details>
