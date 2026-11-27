# PLAN

작업 계획의 색인입니다. 각 줄은 `docs/plan/`의 계획 하나를 가리키며, 상세 내용과 증거는 계획에 있습니다. 계획 규칙은 `pota-plan` 스킬에 있습니다. `pota plan index`와 `pota plan check`로 관리합니다.

## Active Plans

- [end-state-delivery](docs/plan/end-state-delivery.md): 요청한 끝 지점까지 가기와 닫기 규칙, Pota 2.6.4 릴리스


## Superseded Plans

- [Pota 0.2.0 설치본 런타임 릴리스](docs/plan/release-0.2.0-installed-runtime.md): 후속 0.2.1·0.2.2 릴리스로 대체된 미완료 릴리스 계획입니다. 활성 작업으로 취급하지 않습니다.

## Completed Plans

최신 항목이 위에 오며 계획당 한 줄입니다. `pota plan index --archive`는 오래된 항목을 `docs/plan/ARCHIVE.md`로 옮깁니다.

- [결함 판정을 프롬프트 캡슐에 싣기와 도구 만들기, Pota 2.6.3 릴리스](docs/plan/triage-in-capsule.md): 판정 한 줄을 idle 캡슐에, 다시 쓸 조회·없는 지정 도구는 만들기.
- [같은 규칙 함께 고치기와 스크립트 활용, Pota 2.6.2 릴리스](docs/plan/same-rule-fix-and-scripts.md): 같은 규칙 위반은 함께 수정, 데이터 판단은 스크립트로.
- [지시의 사실 전제 확인, Pota 2.6.1 릴리스](docs/plan/verify-premise.md): 리포트·지시의 사실 주장을 규칙·테스트·로그·데이터로 확인.
- [결함 판정과 가벼운 경로 정리, Pota 2.6.0 릴리스](docs/plan/defect-triage-exits.md): main 모델 게이트 Heavy 한정, 결함 판정 문구, `goal cancel --reason` 출구, foreign 캡슐 완화.
- [DAG 패널에서 막힌 task 재시도, Pota 2.5.0 릴리스](docs/plan/dag-retry-blocked-task.md): `goal retry`, `pota_dag_action` `retry_task`, 패널 재시도 버튼.
- [OmO 비교에서 고른 게이트·기록 추가, Pota 2.4.0 릴리스](docs/plan/omo-inspired-gates.md): 완료 주장 대조, 메모리 `Paths:` 알림, Heavy `planReview`, `ESCALATE:`·Learnings, Antigravity·Codex 역할 정의.
- [ChatGPT Desktop·Codex Pota DAG MCP App, Pota 2.3.0 릴리스](docs/plan/chatgpt-codex-dag-panel.md): 3호스트 DAG 4탭·인스펙터·승인 게이트·`dag` 스킬, `2.3.0` 배포.
- [Pota 2.2.2 릴리스](docs/plan/release-2.2.2.md): Claude `icon`·`author`, Antigravity `open_pota_dag` 자동 호출·MCP 자동 복구, `2.2.2` 배포.
- [Antigravity 모델 분류·라우팅 확장 및 `goal finish` effort 우회](docs/plan/antigravity-model-routing.md): Antigravity 실모델 4-tier 분류·설계 게이트, 선택적 `swarm` 지침, `goal finish --allow-inherited-effort`를 추가했습니다.

- [Antigravity Pota DAG 사이드바/보조 패널 (MCP App)](docs/plan/antigravity-dag-panel.md): `mcp_config.json`, zero-dep MCP App 서버·HTML UI(`aux_pane`/`global`), 워크스페이스 레지스트리, 완료 서브에이전트 유휴 정책 추가.

- [DAG 창에서 실행 중인 task 열기, Pota 2.1.0 릴리스](docs/plan/dag-open-running-task.md): Claude Code DAG 창의 실행 중 카드를 누르면 에이전트 대화가 열리며 `main` 병합과 태그 `v2.1.0`으로 릴리스했습니다.
- [호스트 플러그인 설치 전환, Pota 2.0.0 릴리스](docs/plan/plugin-native-install.md): npm 설치 프로그램을 없애고 저장소 루트를 Claude Code·Codex·Antigravity CLI 플러그인으로 배포했으며 `main` 병합과 태그 `v2.0.0`으로 릴리스했습니다.
- [Pota 1.5.0 안내 릴리스 인계](docs/plan/handoff-notice-1x.md): 플러그인 설치를 안내하는 마지막 npm 버전 1.5.0을 `release/1.x`에서 게시하고 패키지를 deprecate했습니다.
- [요청 계약과 스티어링 기록, Pota 1.4.0 릴리스](docs/plan/request-brief-steering.md): 요청 계약 게이트·스티어링 기록·`pota plan steering`을 넣고 npm `latest` 1.4.0으로 게시했습니다.
- [`--tasks` 쉼표 목록 거부와 Pota 1.3.2 릴리스](docs/plan/release-1.3.2.md): 쉼표 목록·깨진 JSON을 오류로 거부하고 mod manifest 버전을 맞춰 npm `latest` 1.3.2로 게시했습니다.
- [Pota 1.3.1 릴리스](docs/plan/release-1.3.1.md): dev·main PR을 CI 통과 후 병합하고 exact main tarball을 npm `latest` 1.3.1로 게시해 digest와 격리 설치를 확인했습니다.
- [구독 등급에 맞춘 모델 상한](docs/plan/available-model-ceiling.md): `POTA_MODEL_CEILING`·`config.json` `"modelCeiling"`으로 쓸 수 있는 최고 tier를 선언하면 게이트와 캡슐이 그 기준으로 판정한다.
- [main 모델 게이트, 테스트 시간 단축, DAG 기본 보기](docs/plan/main-model-gate-and-test-time.md): opus 미만 main 모델의 계획·리뷰를 알림과 완료 게이트로 막고(`POTA_MAIN_MODEL_GATE=0`으로 끔), 테스트 분할로 `npm test` 235초→165초, DAG 기본 보기를 전체로.
- [Pota 1.3.0 릴리스](docs/plan/release-1.3.0.md): dev·main PR을 CI 통과 후 병합하고 exact main tarball을 npm `latest` 1.3.0으로 게시해 digest와 격리 설치를 확인했습니다.
- [DAG 패널 터미널 그래프와 worktree 대응](docs/plan/dag-terminal-graph.md): 터미널 pane에 박스 문자 wave 그래프를 그리고, 패널이 worktree의 goal을 따라가도록 root 결정 규칙을 고쳤습니다.
