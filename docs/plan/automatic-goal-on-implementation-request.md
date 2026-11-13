# 계획: 구현 요청의 자동 goal 설정 지침

## 목표

사용자가 `goal`을 직접 언급하지 않아도 구현 또는 계속 실행 요청이면 `UserPromptSubmit` 단계에서 모델이 반드시 decision-complete plan 뒤 활성 Pota goal을 생성·연결하도록 지침을 받고, 명시적인 완료·일시정지·차단·취소 전에는 작업을 끝내지 않게 합니다.

## 전체 작업

- 결과:
  - 활성 goal이 없는 `UserPromptSubmit`도 모델 가시적인 `additionalContext`를 반환합니다.
  - 컨텍스트는 사용자의 goal 언급 여부와 무관하게 구현/계속 실행 요청을 goal 생성 권한으로 취급합니다.
  - 상담·설명·계획 전용 요청은 불필요한 goal을 만들지 않습니다.
  - 기존 활성 goal은 현재 task를 계속 안내합니다.
- 영향 표면: `scripts/pota-state.mjs`, 플러그인 기본 prompt, 계획/model guidance, goal hook 회귀 테스트, 영문·한글 사용 설명.
- 작업 분류: 하나의 hook/policy 동작 수정 task.
- 하위 작업: 모델 가시 컨텍스트 수정, 정책 표면 정렬, 테스트와 패키지 검증.

## 메모리 입력

- `MEMORY.md`
- 관련 상세 memory 문서는 없음.

## 모델 가이드

- 적용 모델 계열: Codex.
- 참조 문서:
  - `pota://docs/model-guidance/README.md`
  - `pota://docs/model-guidance/codex.md`
- 근거: hook 출력과 명시적 상태 전이, 결정론적 회귀 테스트에 적합합니다.
- 역할별 조정: 상위 세션 정책이 명시적 사용자 요청 없는 subagent 생성을 금지하므로 주 세션이 bounded 구현을 직접 인계합니다.
- 사용자 응답과 산출물 언어: 한국어.

## 복잡도 트리아지

- 선택 경로: Light Path.
- 선택 근거: 기존 goal/hook 아키텍처 안에서 누락된 컨텍스트와 정책 문구를 보강하며 새 상태 모델이나 계층을 추가하지 않습니다.
- 확인한 Heavy Path 신호:
  - 새 디렉터리/모듈/계층: 아니오.
  - 새 도메인 모델/서비스/추상화: 아니오.
  - 보안/인증/세션: 아니오. 기존 session ownership 계약은 유지합니다.
  - 외부 API/메시지 큐/결제: 아니오.
  - DB 스키마/마이그레이션: 아니오.
  - 동시성/트랜잭션/캐시 무효화: 아니오.
  - 도메인 간 리팩터링: 아니오.
  - 명시적 extra-care 신호: 아니오.
- Heavy Path 트리거: 없음.
- 생략한 위임: 상위 multi-agent 정책상 사용자가 subagent를 요청하지 않았으므로 로컬 주 세션이 구현·검증합니다.
- 구현 전 결정:
  - hook이 자연어 prompt를 휴리스틱으로 분류하거나 임의의 placeholder goal을 만들지 않습니다.
  - 대신 구현/계속 실행 요청 자체를 goal 생성 권한으로 명시하는 모델 가시 지침을 항상 주입합니다.
  - consultation/plan-only 제외는 유지하고, 저장소 초기화는 계속 명시적 명령에서만 수행합니다.

## 에이전트 배정

- 주 세션: 계획, 구현, 테스트, 증거 기록, 최종 검토.
- `explorer`/`worker`: 상위 정책 때문에 생략.

## 도구 준비 상태

- 감지 스택: JavaScript, Node.js.
- toolcheck 명령: `node /Users/wknam/.codex/plugins/cache/pota/plugins/pota/scripts/pota.mjs toolcheck --root /Users/wknam/workspace/pota-harness` 통과.
- 필요한 LSP/심볼 도구: 작은 ESM hook/policy 변경에는 필수 아님. `rg`와 Node import/test를 사용합니다.
- 필요한 typecheck/lint/검증 도구: Node syntax check, `node --test`, `npm run check`, `npm pack --dry-run`.
- 누락 도구: 없음.
- 설치/부트스트랩 시도: 없음.
- 도구 blocker: 없음.

## 실행 가드레일

- dry-run/check: 구현 전 기존 `node --test test/goal-state.test.mjs`를 기준선으로 사용하고, 패키지는 `npm pack --dry-run`으로 검증합니다.
- 외부 상태 변경: 없음. 저장소 파일만 수정합니다.
- 검증 루프 예산: 두 번.
- 실패 처리: 한 번 진단하고 범위를 줄여 두 게이트를 재실행하며, 두 번 실패하면 blocker를 기록합니다.

## 모듈 작업

### Task goal-prompt-context: goal 미언급 구현 요청의 필수 컨텍스트

- 계약: 활성 goal 유무와 관계없이 `UserPromptSubmit`이 모델 가시 컨텍스트를 반환하고, 구현/계속 실행 요청에는 사용자의 goal 언급 없이도 plan 뒤 goal 생성·완주를 요구합니다.
- 파일: `scripts/pota-state.mjs`, `.codex-plugin/plugin.json`, `skills/pota-plan/SKILL.md`, `docs/model-guidance/README.md`, `README.md`, `README.ko.md`, `test/goal-state.test.mjs`, `test/lifecycle.test.mjs`, `test/packed-install.test.mjs`.
- 의존성: 기존 goal 상태 머신과 Codex `UserPromptSubmit` hook 계약.
- 도구 준비 요구: Node.js.
- dry-run/check 명령: `node --test test/goal-state.test.mjs`.
- 모듈 수용 검증: `node --test test/goal-state.test.mjs test/lifecycle.test.mjs`.
- 표면 통합 검증: `npm run check && npm pack --dry-run`.

## 증거

- Dry-run/check: 구현 전 `node --test test/goal-state.test.mjs` 11/11 통과.
- 도구 준비: JavaScript/Node 감지, Node runtime 정상.
- Tests: `npm --cache /private/tmp/pota-npm-cache run check`에서 syntax/JSON 검사와 전체 테스트 34/34 통과.
- 모듈 수용: `node --test test/goal-state.test.mjs test/lifecycle.test.mjs` 19/19 통과. goal이 없는 `UserPromptSubmit`도 영문·한국어 모델 가시 컨텍스트를 내고 저장소 파일은 생성하지 않음을 검증했습니다.
- 표면 통합: `npm --cache /private/tmp/pota-npm-cache pack --dry-run` 통과. 실제 tarball 설치본의 `UserPromptSubmit`이 goal 미언급 구현 요청을 권한으로 취급하는 `additionalContext`를 반환하는 assertion을 포함해 전체 34/34 테스트가 통과했습니다.
- 검증 pass 수: 모듈 1회 통과. 전체 검사 1차는 사용자 `~/.npm` cache의 root-owned 파일 때문에 packed-install이 실패했고, 저장소 밖 임시 cache를 명시한 2차에서 34/34 통과했습니다. 최종 test 변경 뒤 package dry-run 1회 통과했습니다.
- 두 번 실패 뒤 blocker: 없음.
- 최종 검토: `git diff --check` 통과. plan 범위 밖 리팩터링은 없고, 활성 goal 없음/활성 goal 있음/설치 tarball/영문·한국어 locale 경로를 모두 검증했습니다. 발견된 한국어 locale assertion 공백은 최종 게이트 전에 보완했으며 남은 기능상 finding은 없습니다.
- 잔여 위험: hook은 모델에 강제 developer context를 주입하지만 자연어 요청을 hook 자체에서 분류하거나 placeholder goal을 기계적으로 생성하지 않습니다. 이는 상담·설명 요청의 오탐 goal 생성을 피하고 decision-complete plan 뒤 goal을 생성한다는 기존 계약을 보존하기 위한 의도된 경계입니다.

## 상태

- [x] 계획 완료
- [x] dry-run/check 통과 또는 해당 없음 기록
- [x] 구현 완료
- [x] 모듈 수용 통과
- [x] 표면 통합 통과
- [x] 검토 완료
