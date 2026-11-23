# Handoff: notice-1x (Pota 1.5.0)

계획 `docs/plan/plugin-native-install.md`의 task `notice-1x` 결과다. `release` task가 읽는다.

- 브랜치: `chore/plugin-notice-1.5.0` (부모 `122b031`, 1.4.0). 커밋 `632b31d`. 푸시하지 않았다.
- 대상 브랜치: `release/1.x`(`origin/main`의 `122b031`에서 만든다). `dev`·`main`에 병합하지 않는다.
- 변경: 세션 시작 안내(7일에 한 번, 한 세션만), 버전 표면 1.5.0, README 8개 머리 문단. lifecycle과 자동 업그레이드 runner는 바꾸지 않았다.
- 확인하지 못한 것: 실제 호스트에서 여러 줄 `systemMessage`의 표시, 실제 1.4.0 → 1.5.0 자동 업그레이드 경로. `release`에서 확인한다.
