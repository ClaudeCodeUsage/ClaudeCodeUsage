# Claude Code 사용량 모니터

🌐 **언어**: [🏠 Main](README.md) | [English](README-en.md) | [繁體中文](README-zh-TW.md) | [简体中文](README-zh-CN.md) | [日本語](README-ja.md) | **한국어**

---

**Claude Code를 더 스마트하게 쓰는 방법을 알려주는 상태 표시줄 코치.** 청구 도구도, 멀티 프로바이더 모니터도 아닙니다. AI를 활용해 토큰 소비를 분석하고 사용 습관을 개선하는 가벼운 VS Code 확장입니다.

> **무엇인가**: 로컬 Claude Code 대화 로그를 읽어 **토큰 기반**의 사용량과 비용 추정치를 보여주는 VS Code 상태 표시줄 모니터. 프롬프트 개선과 낭비 절감을 제안하는 선택적 AI 어드바이저 포함.
>
> **무엇이 아닌가**: 청구 도구가 아닙니다. 표시되는 모든 금액은 공개된 100만 토큰당 단가 기준 추정치입니다. 실제 청구는 Anthropic 계정을 확인하세요.

> 스크린샷은 영어 UI 기준입니다. 전체 기능 설명은 [메인 README](README.md)를 참고하세요.

## 스크린샷

### 상태 표시줄

![상태 표시줄](images/v2-status-bar-en.png)

쿼터 표시기에 마우스를 올리면 상세 내역이 나옵니다:

![쿼터 툴팁](images/v2-quota-en.png)

### 대시보드

![대시보드](images/v2-dashboard-en.png)

## 기능

- **상태 표시줄** — 오늘 비용, 현재 세션 비용, 그리고 Claude Code 자체 OAuth 세션에서 읽는 실제 5시간 / 주간 쿼터(`5h:N% wk:N%`). 설정 불필요.
- **대시보드 탭** — 오늘 / 이번 달 / 전체 기간, 그리고 **Sessions / Projects / Content / Branches**. 모두 정렬 가능.
- **누적 비용 구성 차트**(Y축과 기준선 포함) — 각 일 / 월의 비용 중 입력·출력·캐시 쓰기·캐시 읽기가 차지하는 비율을 한눈에.
- **Content 탭** — 어떤 콘텐츠가 토큰을 소비하는지 추정(내 프롬프트 vs 도구 결과 vs 어시스턴트 출력 / 사고).
- **AI 조언**(선택) — 사용량 요약과 최근 프롬프트 샘플을 OpenAI 호환 API(기본 DeepSeek V4 Pro)로 보내 구체적인 재작성을 제안. 키는 직접 준비하거나, 정적 데모를 먼저 미리보기.
- **멀티 벤더 가격** — Opus 4.x / Sonnet 4.x / Haiku 4.5는 Anthropic 공식 가격으로 검증. OpenAI / Gemini / DeepSeek / Kimi / GLM / Qwen 참고 가격(패밀리 인식 폴백 포함). `Refresh Token Pricing`으로 LiteLLM 최신 가격 가져오기.
- **개인화** — 언어, 시간대, 소수 자릿수, 간략 숫자, 프로젝트 그룹화, 대시보드 자동 새로고침 토글.

## 설치

확장 보기(`Ctrl+Shift+X`)에서 **`Claude Code Usage`**를 검색하거나:

```
ext install GrowthJack.claude-code-usage
```

Cursor / Windsurf용으로 [Open VSX Registry](https://open-vsx.org/extension/GrowthJack/claude-code-usage)에도 게시되어 있습니다.

## 설정

설정(`Ctrl+,`)을 열고 **`Claude Code Usage`**를 검색하세요. 모두 선택 사항입니다. 가장 유용한 것:

- `language` — UI 언어(`auto` / `en` / `zh-TW` / `zh-CN` / `ja` / `ko`).
- `timezone` — 날짜 표시용 IANA 시간대(예: `Asia/Seoul`).
- `usageLimitTracking` — 실제 5시간 / 주간 쿼터 표시.
- `showCost` / `showContext` — 상태 표시줄의 비용 항목과 컨텍스트 윈도우 사용률(`/context` 유사) 표시 전환.
- 위 상태 표시줄 항목들은 개별적으로 끌 수 있습니다. `usageLimitTracking` / `showCost` / `showContext` 를 `false`로 설정하면 해당 항목만 숨겨집니다.
- `advice.apiKey` — AI 조언 기능용 API 키(OpenAI 호환).
- `pauseDashboardRefresh` — 대시보드 자동 새로고침 일시정지(대시보드 헤더에서도 토글 가능).

전체 설정 표는 [메인 README](README.md#configuration)를 참고하세요.

## 문제 해결

**"No Claude Code Data"** — Claude Code가 설치되어 최소 한 번 사용되었는지 확인하고, `dataDirectory` 설정을 확인하세요(자동 감지는 `~/.claude/projects`를 봅니다).

**쿼터가 `5h:--% wk:--%`로 표시** — Claude Code에 한 번 로그인하세요. 확장은 `~/.claude/.credentials.json`을 읽기 전용으로 참조합니다.

**이전 달 기록 누락** — Claude Code는 `cleanupPeriodDays`(기본 30일)보다 오래된 로그를 삭제합니다. 더 오래 보관하려면 `~/.claude/settings.json`에 `{ "cleanupPeriodDays": 365 }`를 설정하세요. 이미 삭제된 로그는 복구할 수 없습니다.

**토큰 수가 프로바이더 대시보드보다 적음** — 일부 프록시 / 동적 워크플로는 에이전트별 기록을 하위 디렉터리에 쓰며 불완전할 수 있습니다. 실제 지출은 프로바이더 청구 페이지를 확인하세요. 네이티브 워크플로 귀속 기능은 계획 중입니다.

## 크레딧

[`ClaudeCodeUsage/ClaudeCodeUsage`](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage)에서 포크. MIT 라이선스. 커뮤니티 기여는 [CHANGELOG.md](CHANGELOG.md)에 명시. 많은 코드 변경은 [Claude Code](https://claude.com/claude-code)의 도움으로 작성되었습니다.

**이슈, PR, 아이디어를 환영합니다** —— 그것이 프로젝트가 성장하는 방식입니다.

## 라이선스

[MIT](LICENSE)
