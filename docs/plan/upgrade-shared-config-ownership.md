# Plan: Pota 0.2.5 공용 설정 upgrade hotfix

## Plan Phase

- Initial: completed before repository triage.
- Finalized: Heavy Path. The lifecycle transaction and ownership boundary are affected, so each implementation task requires focused acceptance and lifecycle integration evidence.

## Goal

공용 `~/.codex/config.toml`에서 Pota이 소유하지 않은 설정 앞의 공백·주석을 Pota section에 잘못 귀속해 `pota upgrade`가 `Managed artifact was modified`로 중단되지 않도록 section ownership 경계를 수정하고 0.2.5 hotfix를 준비합니다.

- Plan ID: `docs/plan/upgrade-shared-config-ownership.md`
- Completion criteria: 격리 재현, Pota-owned section만 검증·교체, 외부 설정 보존, rollback 회귀 통과, 전체 package 검증, 독립 리뷰.
- Required goal evidence: `finalReview`.

## Whole Work

- Outcome: Pota-owned TOML section의 실제 내용만 충돌 검증하고, 뒤따르는 비-Pota section의 경계 trivia는 사용자 설정으로 보존합니다.
- Safety: 실제 사용자 `~/.codex/config.toml`과 현재 Pota 설치는 읽거나 수정하지 않습니다. 모든 lifecycle 검증은 임시 HOME에서 수행합니다.
- Stable roadmap: triage → failing regression → minimal ownership/config fix → lifecycle/full verification → review → 0.2.5 release preparation.

## Triage Decision

- 0.2.4는 config 전체가 아니라 `potaConfigProjection()`만 SHA-256으로 기록합니다.
- `splitSections()`가 다음 header 앞의 빈 줄과 주석을 직전 section의 `text`에 붙이므로, 설치 후 `\n[profiles.user]...` 같은 일반 설정을 append하면 마지막 Pota hook section의 projection digest가 바뀝니다.
- `install()`의 `assertOwnershipDigests()`가 이 오탐을 먼저 차단하고, `assertTargetsReplaceable()`도 같은 digest를 다시 검사합니다.
- 공유 config는 불변 managed artifact가 아니므로 upgrade·uninstall 사전 검사에서 stored digest 일치를 요구하지 않습니다. 명시적 lifecycle 명령은 현재 공유 파일을 입력으로 Pota section만 재조정·제거합니다.
- parser 전체를 바꾸지 않고 owned section의 header·설정 내용과 trailing boundary trivia를 분리해 transaction digest에서는 trivia를 제외하고, 제거 시 trivia를 비-Pota 설정과 함께 보존합니다.
- 일반 managed file/tree 변경, config symlink·special file, transaction 적용 뒤 Pota section의 동시 변경은 계속 fail-closed로 유지합니다.

## Initial Tasks

### Task 0: triage

- Status: completed.
- Contract: 공용 config가 managed artifact 전체 hash로 취급되는지 코드와 기존 격리 테스트로 확인하고, 실패 재현과 수정 경계를 decision-complete로 확정합니다.
- Required evidence: `planArtifact`, `triageDecision`.

### Task 1: shared-config-regression

- Status: completed.
- Contract: 설치 뒤 빈 줄·주석을 경계로 비-Pota config section을 append하거나 공유 config의 Pota 값을 호스트가 바꿔도 upgrade가 사전 충돌로 실패하지 않는 계약을 고정합니다.
- Required evidence: `moduleAcceptance`, `surfaceIntegration`.

### Task 2: shared-config-fix

- Status: completed.
- Contract: owned section의 trailing boundary trivia를 projection에서 제외하고 remove/upgrade/uninstall/rollback에서 외부 설정과 trivia를 보존하는 최소 구현을 적용합니다.
- Required evidence: `moduleAcceptance`, `surfaceIntegration`.

### Task 3: hotfix-verify

- Status: completed.
- Contract: focused lifecycle, 전체 check, package dry-run, 격리 0.2.4→0.2.5 upgrade를 검증하고 독립 리뷰합니다.
- Required evidence: `moduleAcceptance`, `surfaceIntegration`.

## Status

- [x] Initial plan created
- [x] Triage finalized
- [x] Regression reproduced
- [x] Fix implemented
- [x] Full verification and review completed

## Result

- 공유 `config.toml`은 upgrade/uninstall의 immutable-digest precondition에서 제외하고, 실제 rename으로 캡처한 최신 파일에서 public section과 boundary trivia를 다시 병합합니다.
- config의 Pota projection digest는 transaction/doctor 진단에는 유지해 hook trust 변조를 보고하며, 일반 managed file/tree는 기존처럼 변조 시 lifecycle을 거부합니다.
- 모든 shared config 읽기는 regular-file 검사 뒤 `O_NOFOLLOW | O_NONBLOCK` handle을 사용하고, config capture 직후의 backup/no-backup crash 상태를 다음 lifecycle에서 복구합니다.
- published 0.2.4 commit `e2e5cf8ed0c0f4d895603731685c86ddd5ee549c`을 실제 격리 설치한 뒤 mutable config 변경을 포함한 0.2.5 upgrade를 검증했습니다.
- `npm run check`: 128/128 통과. `npm pack --dry-run --ignore-scripts --json`: 64 files, 103,664 bytes, integrity `sha512-O/cvRuqRhPTRBjxriMKcy2sJSvUhFI/gpgCkgSOtsDbcggzALX1fobceUqLkEP34WUNXOGDhItDrxfcptvYQOw==`.
- 독립 최종 리뷰는 actual user HOME/설치본에 접근하지 않은 채 완료됐고 추가 actionable finding이 없습니다.
