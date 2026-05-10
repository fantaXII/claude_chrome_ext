# Open Questions

## claude-chrome-ext-mvp - 2026-05-10

- [ ] **Claude CLI `--resume` 동작 범위:** `--print` 모드에서 `--resume`이 이전 대화 컨텍스트를 완전히 복원하는지, 아니면 일부 제약이 있는지 확인 필요 -- 세션 연속성 품질에 직접 영향
- [ ] **Native Messaging 메시지 크기 제한:** Chrome Native Messaging은 단일 메시지 최대 1MB 제한. Claude 응답이 이를 초과할 경우 청크 분할 전략 필요 -- 긴 응답 시 truncation 위험
- [ ] **host.js shebang과 NVM:** host-wrapper.bat에서 NVM 절대 경로로 node를 호출하므로 shebang 문제는 해결됨. 단, NVM 버전 업그레이드 시 bat 파일 경로도 수동 업데이트 필요 -- 유지보수 부담
