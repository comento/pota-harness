import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GIT_MAX_BUFFER,
  GIT_TIMEOUT_MS,
  MAX_PLAN_BYTES,
  filterDiffByScope,
  isSensitiveRepoPath,
  normalizeRepoPath,
  parseGitStatusAndNumstat,
  parsePlanOverview,
  readPlanOverview,
  readRepoGitDiff,
  readScopedGitDiff,
  runGitReadOnly,
  validateRepoRelativePath,
} from "../scripts/pota-dag-git.mjs";

const GIT_TEST_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Pota Test",
  GIT_AUTHOR_EMAIL: "pota-test@example.com",
  GIT_COMMITTER_NAME: "Pota Test",
  GIT_COMMITTER_EMAIL: "pota-test@example.com",
  LC_ALL: "C",
};

function gitSync(repoDir, args) {
  return execFileSync("git", ["-C", repoDir, ...args], {
    encoding: "utf8",
    env: GIT_TEST_ENV,
    shell: false,
  });
}

async function withTempWorkspace(work) {
  const base = await mkdtemp(join(tmpdir(), "pota-dag-git-"));
  const repoDir = join(base, "repo");
  const outsideDir = join(base, "outside");
  await mkdir(repoDir, { recursive: true });
  await mkdir(outsideDir, { recursive: true });
  try {
    return await work({ base, repoDir, outsideDir });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

function initTempGitRepo(repoDir) {
  gitSync(repoDir, ["init"]);
  gitSync(repoDir, ["config", "user.name", "Pota Test"]);
  gitSync(repoDir, ["config", "user.email", "pota-test@example.com"]);
}

test("1. 상수·재내보내기 및 validateRepoRelativePath 경로·심볼릭 링크 차단 검증", async () => {
  assert.equal(GIT_TIMEOUT_MS, 3000);
  assert.equal(GIT_MAX_BUFFER, 1024 * 1024);
  assert.equal(MAX_PLAN_BYTES, 64 * 1024);
  assert.equal(typeof isSensitiveRepoPath, "function");
  assert.equal(typeof normalizeRepoPath, "function");
  assert.equal(typeof parseGitStatusAndNumstat, "function");
  assert.equal(typeof filterDiffByScope, "function");
  assert.equal(typeof parsePlanOverview, "function");

  await withTempWorkspace(async ({ repoDir, outsideDir }) => {
    await mkdir(join(repoDir, "src"), { recursive: true });
    await writeFile(join(repoDir, "src", "index.mjs"), "export const x = 1;\n", "utf8");
    await writeFile(join(outsideDir, "secret.txt"), "top-secret\n", "utf8");
    await symlink(join(outsideDir, "secret.txt"), join(repoDir, "link-file.txt"));
    await symlink(outsideDir, join(repoDir, "link-dir"));

    const okRegular = await validateRepoRelativePath(repoDir, "./src//index.mjs");
    assert.equal(okRegular.ok, true);
    assert.equal(okRegular.path, "src/index.mjs");
    assert.equal(okRegular.sensitive, false);

    const okMissing = await validateRepoRelativePath(repoDir, "src/new-file.mjs");
    assert.equal(okMissing.ok, true);
    assert.equal(okMissing.path, "src/new-file.mjs");
    assert.equal(okMissing.sensitive, false);

    const okSensitive = await validateRepoRelativePath(repoDir, "secrets/private.key");
    assert.equal(okSensitive.ok, true);
    assert.equal(okSensitive.sensitive, true);

    const rejectedCases = [
      "",
      null,
      undefined,
      ".",
      "./",
      "src\0evil.mjs",
      "/etc/passwd",
      "\\windows\\system32\\cmd.exe",
      "C:\\Users\\test\\a.txt",
      "--exec=evil",
      "-p",
      "../outside/secret.txt",
      "src/../../outside",
      "src/*.mjs",
      "src/[a].mjs",
      "src/a?.mjs",
      "link-file.txt",
      "link-dir/secret.txt",
      "link-dir/missing.txt",
    ];

    for (const candidate of rejectedCases) {
      const res = await validateRepoRelativePath(repoDir, candidate);
      assert.equal(res.ok, false, `거부되어야 할 경로가 통과함: ${String(candidate)}`);
      assert.equal(typeof res.reason, "string");
    }

    const missingRoot = await validateRepoRelativePath(join(repoDir, "nope"), "src/index.mjs");
    assert.equal(missingRoot.ok, false);
    assert.equal(missingRoot.reason, "invalid-root");

    const fileAsRoot = await validateRepoRelativePath(join(repoDir, "src", "index.mjs"), "a.txt");
    assert.equal(fileAsRoot.ok, false);
    assert.equal(fileAsRoot.reason, "invalid-root");
  });
});

test("2. runGitReadOnly 셸 미사용·인자 검증 및 안전 실행 검증", async () => {
  await withTempWorkspace(async ({ repoDir }) => {
    initTempGitRepo(repoDir);
    const inside = await runGitReadOnly(repoDir, ["rev-parse", "--is-inside-work-tree"]);
    assert.equal(inside.trim(), "true");

    // 셸 메타문자가 포함된 인자는 셸로 해석되지 않고 순수 리터럴 인자로 전달되어야 한다.
    const metaOut = await runGitReadOnly(repoDir, ["status", "--porcelain=v1", "--", "a;echo pwned"]);
    assert.equal(metaOut, "");
    await assert.rejects(() => runGitReadOnly(repoDir, ["rev-parse", "--verify", "HEAD"]));
    await assert.rejects(() => runGitReadOnly("", ["status"]));
    await assert.rejects(() => runGitReadOnly(repoDir, ["status\0bad"]));
    await assert.rejects(() => runGitReadOnly(repoDir, "status"));
  });
});

test("3. unborn HEAD(커밋 없는 새 Git 저장소)에서 readRepoGitDiff 정상 동작 검증", async () => {
  await withTempWorkspace(async ({ repoDir }) => {
    initTempGitRepo(repoDir);

    await mkdir(join(repoDir, "src"), { recursive: true });
    await writeFile(join(repoDir, "src", "staged.mjs"), "const a = 1;\nconst b = 2;\nconst c = 3;\n", "utf8");
    await writeFile(join(repoDir, "untracked.txt"), "hello\n", "utf8");
    gitSync(repoDir, ["add", "src/staged.mjs"]);

    const diff = await readRepoGitDiff(repoDir);
    assert.equal(diff.available, true);
    assert.equal(diff.truncated, false);
    assert.deepEqual(diff.totals, { files: 2, added: 3, deleted: 0 });

    const byPath = new Map(diff.files.map((item) => [item.path, item]));
    assert.deepEqual(byPath.get("src/staged.mjs"), {
      path: "src/staged.mjs",
      status: "A",
      added: 3,
      deleted: 0,
      binary: false,
      sensitive: false,
    });
    assert.deepEqual(byPath.get("untracked.txt"), {
      path: "untracked.txt",
      status: "??",
      added: 0,
      deleted: 0,
      binary: false,
      sensitive: false,
    });
  });
});

test("4. 커밋된 저장소의 staged·unstaged·untracked·renamed·binary 및 민감 파일 감지 검증", async () => {
  await withTempWorkspace(async ({ repoDir }) => {
    initTempGitRepo(repoDir);

    await mkdir(join(repoDir, "src"), { recursive: true });
    await mkdir(join(repoDir, "secrets"), { recursive: true });
    await writeFile(join(repoDir, "src", "app.mjs"), "line1\nline2\nline3\n", "utf8");
    await writeFile(join(repoDir, "src", "staged.mjs"), "s1\ns2\n", "utf8");
    await writeFile(join(repoDir, "src", "old-name.mjs"), "r1\nr2\nr3\nr4\n", "utf8");
    await writeFile(join(repoDir, "secrets", ".gitkeep"), "", "utf8");
    gitSync(repoDir, ["add", "."]);
    gitSync(repoDir, ["commit", "-m", "initial commit"]);

    // 커밋 직후 clean 상태 확인
    const clean = await readRepoGitDiff(repoDir);
    assert.equal(clean.available, true);
    assert.deepEqual(clean.files, []);
    assert.deepEqual(clean.totals, { files: 0, added: 0, deleted: 0 });

    // 1) unstaged 수정: line2 삭제 + line4, line5 추가 => +2 / -1
    await writeFile(join(repoDir, "src", "app.mjs"), "line1\nline3\nline4\nline5\n", "utf8");

    // 2) staged 수정: s3 추가 => +1 / -0
    await writeFile(join(repoDir, "src", "staged.mjs"), "s1\ns2\ns3\n", "utf8");
    gitSync(repoDir, ["add", "src/staged.mjs"]);

    // 3) rename + 내용 1줄 추가 => status R, +1 / -0
    gitSync(repoDir, ["mv", "src/old-name.mjs", "src/new-name.mjs"]);
    await writeFile(join(repoDir, "src", "new-name.mjs"), "r1\nr2\nr3\nr4\nr5\n", "utf8");
    gitSync(repoDir, ["add", "src/new-name.mjs"]);

    // 4) 바이너리 파일 staged => binary: true, +0 / -0
    await writeFile(join(repoDir, "assets.bin"), Buffer.from([0x00, 0x01, 0x02, 0xff]));
    gitSync(repoDir, ["add", "assets.bin"]);

    // 5) 민감 파일(.env untracked, secrets/private.key untracked) 및 일반 untracked 파일
    await writeFile(join(repoDir, ".env"), "API_KEY=secret\n", "utf8");
    await writeFile(join(repoDir, "secrets", "private.key"), "PRIVATE KEY\n", "utf8");
    await writeFile(join(repoDir, "notes.txt"), "note\n", "utf8");

    const diff = await readRepoGitDiff(repoDir);
    assert.equal(diff.available, true);
    assert.equal(diff.truncated, false);

    const byPath = new Map(diff.files.map((item) => [item.path, item]));
    assert.deepEqual(byPath.get("src/app.mjs"), {
      path: "src/app.mjs",
      status: "M",
      added: 2,
      deleted: 1,
      binary: false,
      sensitive: false,
    });
    assert.deepEqual(byPath.get("src/staged.mjs"), {
      path: "src/staged.mjs",
      status: "M",
      added: 1,
      deleted: 0,
      binary: false,
      sensitive: false,
    });
    assert.deepEqual(byPath.get("src/new-name.mjs"), {
      path: "src/new-name.mjs",
      status: "R",
      added: 1,
      deleted: 0,
      binary: false,
      sensitive: false,
    });
    assert.deepEqual(byPath.get("assets.bin"), {
      path: "assets.bin",
      status: "A",
      added: 0,
      deleted: 0,
      binary: true,
      sensitive: false,
    });
    assert.deepEqual(byPath.get(".env"), {
      path: ".env",
      status: "??",
      added: 0,
      deleted: 0,
      binary: false,
      sensitive: true,
    });
    assert.deepEqual(byPath.get("secrets/private.key"), {
      path: "secrets/private.key",
      status: "??",
      added: 0,
      deleted: 0,
      binary: false,
      sensitive: true,
    });
    assert.deepEqual(byPath.get("notes.txt"), {
      path: "notes.txt",
      status: "??",
      added: 0,
      deleted: 0,
      binary: false,
      sensitive: false,
    });

    assert.deepEqual(diff.totals, {
      files: 7,
      added: 4,
      deleted: 1,
    });
  });
});

test("5. readScopedGitDiff 범위 필터링, 악성/심볼릭 링크 경로 차단 및 repoDiff 캐시 빠른 경로 검증", async () => {
  await withTempWorkspace(async ({ repoDir, outsideDir }) => {
    initTempGitRepo(repoDir);

    await mkdir(join(repoDir, "src"), { recursive: true });
    await mkdir(join(repoDir, "src-other"), { recursive: true });
    await writeFile(join(repoDir, "src", "a.mjs"), "a1\n", "utf8");
    await writeFile(join(repoDir, "src", "b.mjs"), "b1\n", "utf8");
    await writeFile(join(repoDir, "src-other", "c.mjs"), "c1\n", "utf8");
    await writeFile(join(repoDir, ".env"), "SECRET=123\n", "utf8");
    gitSync(repoDir, ["add", "src/a.mjs", "src/b.mjs", "src-other/c.mjs"]);
    gitSync(repoDir, ["commit", "-m", "base"]);

    await writeFile(join(repoDir, "src", "a.mjs"), "a1\na2\n", "utf8");
    await writeFile(join(repoDir, "src-other", "c.mjs"), "c1\nc2\nc3\n", "utf8");
    await writeFile(join(outsideDir, "outside.txt"), "external\n", "utf8");
    await symlink(join(outsideDir, "outside.txt"), join(repoDir, "escape-link.txt"));

    const scoped = await readScopedGitDiff(repoDir, [
      "../outside",
      "--exec=evil",
      "/etc/passwd",
      "escape-link.txt",
      "src/a.mjs",
    ]);

    assert.equal(scoped.available, true);
    assert.deepEqual(scoped.totals, { files: 1, added: 1, deleted: 0 });
    assert.deepEqual(scoped.files, [
      {
        path: "src/a.mjs",
        status: "M",
        added: 1,
        deleted: 0,
        binary: false,
        sensitive: false,
      },
    ]);

    // 디렉터리 접두사 필터는 유사 접두사(src-other)를 포함하지 않아야 한다.
    const dirScoped = await readScopedGitDiff(repoDir, ["src"]);
    assert.deepEqual(dirScoped.files.map((item) => item.path), ["src/a.mjs"]);

    // 모든 경로가 거부되거나 빈 배열이면 서브프로세스 없이 빈 결과 반환
    const allRejected = await readScopedGitDiff(repoDir, ["../outside", "--exec=evil", "/etc/passwd", "escape-link.txt"]);
    assert.deepEqual(allRejected, {
      available: true,
      files: [],
      totals: { files: 0, added: 0, deleted: 0 },
    });

    // repoDiff가 전달되면 git 재실행 없이 해당 요약을 필터링하고 허용 필드만 노출한다.
    const syntheticRepoDiff = {
      available: true,
      files: [
        { path: "src/b.mjs", status: "M", added: 10, deleted: 2, binary: false, sensitive: false, rawContent: "SHOULD_NOT_LEAK" },
        { path: ".env", status: "M", added: 1, deleted: 0, binary: false, sensitive: false, rawContent: "SECRET" },
        { path: "escape-link.txt", status: "??", added: 0, deleted: 0, binary: false, sensitive: false },
      ],
      totals: { files: 3, added: 11, deleted: 2 },
    };

    const fastScoped = await readScopedGitDiff(
      repoDir,
      ["src/b.mjs", ".env", "escape-link.txt"],
      { repoDiff: syntheticRepoDiff },
    );
    assert.equal(fastScoped.available, true);
    assert.deepEqual(fastScoped.totals, { files: 2, added: 11, deleted: 2 });
    assert.deepEqual(fastScoped.files, [
      { path: "src/b.mjs", status: "M", added: 10, deleted: 2, binary: false, sensitive: false },
      { path: ".env", status: "M", added: 1, deleted: 0, binary: false, sensitive: true },
    ]);
    assert.equal("rawContent" in fastScoped.files[0], false);
    assert.equal("rawContent" in fastScoped.files[1], false);
  });
});

test("5b. 새 디렉터리 안 untracked 파일을 파일 단위로 나열하고 ignored는 제외하며 민감 파일을 표시", async () => {
  await withTempWorkspace(async ({ repoDir }) => {
    initTempGitRepo(repoDir);
    await writeFile(join(repoDir, "base.txt"), "base\n");
    await writeFile(join(repoDir, ".gitignore"), "ignored-dir/\n*.log\n");
    gitSync(repoDir, ["add", "."]);
    gitSync(repoDir, ["commit", "-m", "base"]);

    await mkdir(join(repoDir, "newdir", "sub"), { recursive: true });
    await mkdir(join(repoDir, "ignored-dir"), { recursive: true });
    await writeFile(join(repoDir, "newdir", "a.js"), "a\n");
    await writeFile(join(repoDir, "newdir", "sub", "b.js"), "b\n");
    await writeFile(join(repoDir, "newdir", ".env"), "SECRET=1\n");
    await writeFile(join(repoDir, "top.txt"), "top\n");
    await writeFile(join(repoDir, "ignored-dir", "x.js"), "x\n");
    await writeFile(join(repoDir, "debug.log"), "log\n");

    const repoDiff = await readRepoGitDiff(repoDir);
    assert.equal(repoDiff.available, true);
    const paths = repoDiff.files.map((file) => file.path).sort();
    assert.deepEqual(paths, ["newdir/.env", "newdir/a.js", "newdir/sub/b.js", "top.txt"]);
    assert.equal(paths.some((path) => path.endsWith("/")), false);
    assert.equal(repoDiff.files.find((file) => file.path === "newdir/.env").sensitive, true);
    assert.equal(repoDiff.files.find((file) => file.path === "newdir/a.js").sensitive, false);

    const scoped = await readScopedGitDiff(repoDir, ["newdir/a.js"]);
    assert.deepEqual(scoped.files.map((file) => file.path), ["newdir/a.js"]);
    assert.equal(scoped.totals.files, 1);
  });
});

test("5c. status.showUntrackedFiles=no 이면 untracked를 나열하지 않고 tracked 변경은 유지", async () => {
  await withTempWorkspace(async ({ repoDir }) => {
    initTempGitRepo(repoDir);
    await writeFile(join(repoDir, "base.txt"), "base\n");
    gitSync(repoDir, ["add", "."]);
    gitSync(repoDir, ["commit", "-m", "base"]);
    gitSync(repoDir, ["config", "status.showUntrackedFiles", "no"]);

    await mkdir(join(repoDir, "newdir"), { recursive: true });
    await writeFile(join(repoDir, "newdir", "a.js"), "a\n");
    await writeFile(join(repoDir, "top.txt"), "top\n");
    await writeFile(join(repoDir, "base.txt"), "base\nchanged\n");

    const repoDiff = await readRepoGitDiff(repoDir);
    assert.equal(repoDiff.available, true);
    assert.deepEqual(repoDiff.files.map((file) => file.path), ["base.txt"]);
  });
});

test("6. 비-Git 디렉터리 및 미존재 경로에서 예외 없이 available: false 반환 검증", async () => {
  await withTempWorkspace(async ({ repoDir }) => {
    await writeFile(join(repoDir, "plain.txt"), "not a git repo\n", "utf8");

    const nonGit = await readRepoGitDiff(repoDir);
    assert.equal(nonGit.available, false);
    assert.equal(typeof nonGit.reason, "string");
    assert.deepEqual(nonGit.files, []);
    assert.deepEqual(nonGit.totals, { files: 0, added: 0, deleted: 0 });
    assert.equal(nonGit.truncated, false);

    const scopedNonGit = await readScopedGitDiff(repoDir, ["plain.txt"]);
    assert.deepEqual(scopedNonGit, {
      available: false,
      files: [],
      totals: { files: 0, added: 0, deleted: 0 },
    });

    // 비-Git 디렉터리에서도 repoDiff가 주어지면 git 서브프로세스를 실행하지 않고 즉시 필터링한다.
    const zeroSubprocessScoped = await readScopedGitDiff(repoDir, ["plain.txt"], {
      repoDiff: {
        available: true,
        files: [{ path: "plain.txt", status: "M", added: 2, deleted: 1, binary: false, sensitive: false }],
      },
    });
    assert.deepEqual(zeroSubprocessScoped, {
      available: true,
      files: [{ path: "plain.txt", status: "M", added: 2, deleted: 1, binary: false, sensitive: false }],
      totals: { files: 1, added: 2, deleted: 1 },
    });

    const missing = await readRepoGitDiff(join(repoDir, "missing-dir"));
    assert.equal(missing.available, false);
    assert.deepEqual(missing.files, []);
    assert.deepEqual(missing.totals, { files: 0, added: 0, deleted: 0 });
  });
});

test("7. readPlanOverview 정상 파싱, 64 KiB 초과 트렁케이션(한글·펜스 포함) 및 보안 거부 검증", async () => {
  await withTempWorkspace(async ({ repoDir, outsideDir }) => {
    await mkdir(join(repoDir, "docs", "plan"), { recursive: true });
    await mkdir(join(repoDir, "secrets"), { recursive: true });

    const normalPlan = [
      "# Plan: S2 대시보드 구현",
      "",
      "## Goal",
      "",
      "읽기 전용 Git diff와 Plan 개요 조회 모듈을 안전하게 제공한다.",
      "",
      "```markdown",
      "- [x] 코드 펜스 내부 가짜 완료 항목",
      "- [ ] 코드 펜스 내부 가짜 대기 항목",
      "```",
      "",
      "- Current request (as of S2): 안전한 읽기 전용 diff와 plan 개요를 표시한다.",
      "",
      "## Status",
      "",
      "- [x] Planned",
      "- [x] Implemented",
      "- [ ] Reviewed",
      "",
    ].join("\n");

    await writeFile(join(repoDir, "docs", "plan", "normal.md"), normalPlan, "utf8");
    const parsedNormal = await readPlanOverview(repoDir, "./docs/plan/normal.md");
    assert.deepEqual(parsedNormal, {
      planId: "docs/plan/normal.md",
      truncated: false,
      title: "Plan: S2 대시보드 구현",
      goalSummary: "읽기 전용 Git diff와 Plan 개요 조회 모듈을 안전하게 제공한다.",
      currentRequest: "안전한 읽기 전용 diff와 plan 개요를 표시한다.",
      checklist: {
        done: 2,
        pending: 1,
        total: 3,
        items: [
          { done: true, text: "Planned" },
          { done: true, text: "Implemented" },
          { done: false, text: "Reviewed" },
        ],
      },
    });

    // > 64 KiB 대형 Plan 파일: 40 KiB 및 24 KiB 경계에 한글과 열린 코드 펜스가 걸리도록 구성한다.
    const fillerLine = `- 한글 멀티바이트 경계 테스트 문장입니다. ${"가나다라마바사아자차카타파하".repeat(4)}`;
    const middleLines = [];
    let middleBytes = 0;
    while (middleBytes < 72 * 1024) {
      if (middleLines.length === 200) {
        // 상단 40 KiB 구간에서 펜스를 열고 생략된 중간 구간에서 닫는 경우를 시뮬레이션한다.
        middleLines.push("```text");
      }
      if (middleLines.length === 450) {
        middleLines.push("```");
      }
      middleLines.push(fillerLine);
      middleBytes += Buffer.byteLength(`${fillerLine}\n`, "utf8");
    }

    const largePlan = [
      "# Plan: 대용량 S2 통합 계획",
      "",
      "## Goal",
      "",
      "64 KiB를 넘는 대형 계획 파일에서도 제목·목표·최신 요청·하단 체크리스트를 보존한다.",
      "",
      ...middleLines,
      "",
      "- Current request (as of S2): 대형 Plan 트렁케이션에서도 최신 요청을 유지한다.",
      "",
      "## Status",
      "",
      "- [x] Large plan head preserved",
      "- [ ] Large plan tail preserved",
      "",
    ].join("\n");

    assert.ok(Buffer.byteLength(largePlan, "utf8") > MAX_PLAN_BYTES);
    await writeFile(join(repoDir, "docs", "plan", "large.md"), largePlan, "utf8");

    const parsedLarge = await readPlanOverview(repoDir, "docs/plan/large.md");
    assert.ok(parsedLarge);
    assert.equal(parsedLarge.planId, "docs/plan/large.md");
    assert.equal(parsedLarge.truncated, true);
    assert.equal(parsedLarge.title, "Plan: 대용량 S2 통합 계획");
    assert.equal(
      parsedLarge.goalSummary,
      "64 KiB를 넘는 대형 계획 파일에서도 제목·목표·최신 요청·하단 체크리스트를 보존한다.",
    );
    assert.equal(parsedLarge.currentRequest, "대형 Plan 트렁케이션에서도 최신 요청을 유지한다.");
    assert.equal(parsedLarge.title?.includes("\uFFFD"), false);
    assert.equal(parsedLarge.goalSummary?.includes("\uFFFD"), false);
    assert.equal(parsedLarge.currentRequest?.includes("\uFFFD"), false);
    assert.deepEqual(parsedLarge.checklist, {
      done: 1,
      pending: 1,
      total: 2,
      items: [
        { done: true, text: "Large plan head preserved" },
        { done: false, text: "Large plan tail preserved" },
      ],
    });

    // 미존재 파일, 민감 파일, 비-.md 파일, 심볼릭 링크, 디렉터리, 경로 탈출 모두 null 반환
    await writeFile(join(outsideDir, "outside-plan.md"), "# Outside\n", "utf8");
    await symlink(join(outsideDir, "outside-plan.md"), join(repoDir, "docs", "plan", "symlink.md"));
    await symlink(outsideDir, join(repoDir, "docs", "linked-dir"));
    await writeFile(join(repoDir, ".env.md"), "# Secret Env\n", "utf8");
    await writeFile(join(repoDir, "secrets", "plan.md"), "# Secret Dir\n", "utf8");
    await writeFile(join(repoDir, "docs", "plan", "notes.txt"), "# Not markdown\n", "utf8");
    await mkdir(join(repoDir, "docs", "plan", "dir.md"), { recursive: true });

    const rejectedPlanIds = [
      "docs/plan/missing.md",
      "docs/plan/symlink.md",
      "docs/linked-dir/outside-plan.md",
      ".env.md",
      "secrets/plan.md",
      "docs/plan/notes.txt",
      "docs/plan/dir.md",
      "../outside/outside-plan.md",
      "/etc/passwd.md",
      "-flag.md",
      "",
      null,
    ];

    for (const planId of rejectedPlanIds) {
      assert.equal(
        await readPlanOverview(repoDir, planId),
        null,
        `거부되어야 할 planId가 null을 반환하지 않음: ${String(planId)}`,
      );
    }
  });
});
