# MEMORY

저장소 지식의 색인입니다. Domain Knowledge 아래의 각 줄은 `docs/memory/`의 노트 하나를 가리키며, 지식 자체는 노트에 있습니다. `pota memory index`와 `pota memory check`로 관리합니다.

## Domain Knowledge

- [delegation-model-routing](docs/memory/delegation-model-routing.md): 작업별 모델 4-tier·호스트별 값, effort 라우팅, dispatch 기록과 완료 게이트(effort·설계 모델). 위임 규칙이나 goal assign을 바꿀 때 읽는다.
- [goal-state](docs/memory/goal-state.md): goal 상태 파일 위치·전이·lock·증거 freshness·이력(history.jsonl)과 cleanup 규칙. goal CLI나 완료 게이트를 바꿀 때 읽는다.
- [hook-context](docs/memory/hook-context.md): hook 캡슐의 상태별 내용·문자 예산, SessionStart 업데이트 알림, MEMORY.md/PLAN.md 인덱스 형식·검사 규칙. hook 문구나 인덱스 CLI를 바꿀 때 읽는다.
- [lifecycle-install](docs/memory/lifecycle-install.md): ~/.pota/install 레이아웃·호스트 선택·runtime 유예, lifecycle 트랜잭션, 자동 업그레이드, CLI exit 규약. 설치·CLI를 바꿀 때 읽는다.
- [policy-surfaces](docs/memory/policy-surfaces.md): 정책 문구를 바꿀 때 함께 고칠 표면 지도(skill·command·미러·agent·template·defaultPrompt·README)와 바이트 예산. 문구 변경 전에 읽는다.
- [release-process](docs/memory/release-process.md): 버전 표면, dev→main PR 승격, exact-main tarball 게시와 npm 대화형 인증, 게시 후 검증·로컬 업그레이드 절차. 릴리스 전에 읽는다.

## Policy

- Always start work from the `dev` branch.
- Prefer precise repository exploration before implementation.
- Preserve proper nouns, file names, variable names, service names, alert names, MCP tool names, and agent names exactly as written.
- Read only the detailed memory files needed for the current task.
- Write user-visible responses and generated or updated documentation, plans, and memory artifacts in the OS locale unless the user asks for another language.
