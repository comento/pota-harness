# MEMORY

저장소 지식의 색인입니다. Domain Knowledge 아래의 각 줄은 `docs/memory/`의 노트 하나를 가리키며, 지식 자체는 노트에 있습니다. `pota memory index`와 `pota memory check`로 관리합니다.

## Domain Knowledge

- [delegation-model-routing](docs/memory/delegation-model-routing.md): 작업별 모델 4-tier·호스트별 값, effort 라우팅, dispatch 기록과 완료 게이트(effort·설계 모델). 위임 규칙이나 goal assign을 바꿀 때 읽는다.
- [goal-state](docs/memory/goal-state.md): goal 상태 파일 위치·전이·lock·증거 freshness·요청 계약 게이트·스티어링 기록·이력과 cleanup 규칙. goal CLI나 완료 게이트를 바꿀 때 읽는다.
- [hook-context](docs/memory/hook-context.md): hook 캡슐의 상태별 내용·문자 예산, 호스트별 hook 배선, SessionStart 이전 알림, MEMORY.md/PLAN.md 인덱스 형식·검사. hook 문구나 인덱스 CLI를 바꿀 때 읽는다.
- [lifecycle-install](docs/memory/lifecycle-install.md): 호스트별 플러그인 배치·hook 파일, runtime 위치 규칙, 1.x npm 설치본 이전(상태·사유·fail-closed), 한계, CLI exit 규약. 설치·CLI를 바꿀 때 읽는다.
- [policy-surfaces](docs/memory/policy-surfaces.md): 정책 문구를 바꿀 때 함께 고칠 표면 지도(skill·agent·template·manifest·defaultPrompt·README)와 바이트 예산. 문구 변경 전에 읽는다.
- [release-process](docs/memory/release-process.md): 버전 표면 4개, dev→main PR 승격(main 병합이 배포), 병합 뒤 호스트별 확인, 1.5.0 안내 릴리스와 npm 인증. 릴리스 전에 읽는다.

## Policy

- Always start work from the `dev` branch.
- Prefer precise repository exploration before implementation.
- Preserve proper nouns, file names, variable names, service names, alert names, MCP tool names, and agent names exactly as written.
- Read only the detailed memory files needed for the current task.
- Write user-visible responses and generated or updated documentation, plans, and memory artifacts in the OS locale unless the user asks for another language.
