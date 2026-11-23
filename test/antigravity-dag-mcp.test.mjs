import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import {
  goalHistoryPath,
  goalStatePath,
  recordReceipt,
  setTaskStatus,
  startGoal,
  transitionGoal,
} from "../scripts/pota-goal.mjs";
import {
  readWorkspaceRegistry,
  recordActiveWorkspace,
  runAntigravityHook,
  workspaceRegistryPath,
} from "../scripts/pota-state-antigravity.mjs";
import {
  createDagMcpServer,
  resolveSafeRepoFileUri,
  resolveWorkspace,
} from "../scripts/pota-dag-mcp-core.mjs";
import {
  DAG_APP_MIME_TYPE,
  DAG_APP_RESOURCE_URI,
  renderDagAppHtml,
} from "../scripts/pota-dag-app-html.mjs";

const pluginRoot = resolve(".");
const mcpEntry = resolve("scripts/pota-dag-mcp.mjs");
const hookAdapter = resolve("scripts/pota-state-antigravity.mjs");
const ONE_MIB = 1_048_576;

test("1. stdio JSON-RPC E2E 수명주기와 NDJSON 프레이밍·종료 검증", async () => {
  await withWorkspace(async ({ repo, env }) => {
    await startGoal({
      root: repo,
      goal: "E2E DAG Goal",
      planId: "docs/plan/e2e.md",
      evidencePolicy: "declared",
      tasks: [
        { id: "t1", title: "Step One", requiredEvidence: ["moduleAcceptance"] },
        { id: "t2", title: "Step Two", dependsOn: ["t1"], requiredEvidence: ["moduleAcceptance"] },
      ],
    });
    await recordActiveWorkspace({ workspacePath: repo, conversationId: "conv-e2e", env });

    const client = spawnMcpClient(env, { cwd: pluginRoot });
    try {
      client.send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "test-harness", version: "1.0.0" },
        },
      });
      const init = await client.nextResponse();
      assert.equal(init.id, 1);
      assert.equal(init.result.protocolVersion, "2025-11-25");
      assert.equal(init.result.serverInfo.name, "pota-dag");
      assert.ok(init.result.capabilities.tools);
      assert.ok(init.result.capabilities.resources);

      // notifications/initialized는 응답을 내지 않아야 하며 바로 뒤 ping 응답(id: 2)이 와야 한다.
      client.send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
      client.send({ jsonrpc: "2.0", id: 2, method: "ping" });
      const ping = await client.nextResponse();
      assert.equal(ping.id, 2);
      assert.deepEqual(ping.result, {});

      client.send({ jsonrpc: "2.0", id: 3, method: "tools/list" });
      const toolsList = await client.nextResponse();
      assert.equal(toolsList.id, 3);
      assert.deepEqual(
        toolsList.result.tools.map((tool) => tool.name),
        ["open_pota_dag", "pota_dag_state"],
      );

      client.send({ jsonrpc: "2.0", id: 4, method: "resources/list" });
      const resourcesList = await client.nextResponse();
      assert.equal(resourcesList.id, 4);
      assert.equal(resourcesList.result.resources.length, 1);
      assert.equal(resourcesList.result.resources[0].uri, DAG_APP_RESOURCE_URI);

      client.send({ jsonrpc: "2.0", id: 5, method: "resources/templates/list" });
      const templatesList = await client.nextResponse();
      assert.equal(templatesList.id, 5);
      assert.deepEqual(templatesList.result, { resourceTemplates: [] });

      client.send({
        jsonrpc: "2.0",
        id: 6,
        method: "resources/read",
        params: { uri: DAG_APP_RESOURCE_URI },
      });
      const resourceRead = await client.nextResponse();
      assert.equal(resourceRead.id, 6);
      assert.equal(resourceRead.result.contents[0].mimeType, DAG_APP_MIME_TYPE);
      assert.equal(resourceRead.result.contents[0]._meta.ui.prefersBorder, false);
      assert.ok(resourceRead.result.contents[0].text.includes("<!DOCTYPE html>"));

      client.send({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "open_pota_dag", arguments: {} },
      });
      const openRes = await client.nextResponse();
      assert.equal(openRes.id, 7);
      assert.equal(openRes.error, undefined);
      assert.equal(openRes.result.structuredContent.root, repo);
      assert.equal(openRes.result.structuredContent.goal.title, "E2E DAG Goal");

      client.send({
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: { name: "pota_dag_state", arguments: {} },
      });
      const stateRes = await client.nextResponse();
      assert.equal(stateRes.id, 8);
      assert.equal(stateRes.error, undefined);
      assert.equal(stateRes.result.structuredContent.seq, 1);
      assert.ok(stateRes.result.structuredContent.svg.source.includes("<svg "));

      client.send("{malformed json");
      const parseErr = await client.nextResponse();
      assert.equal(parseErr.id, null);
      assert.equal(parseErr.error.code, -32700);

      client.send("[1, 2, 3]");
      const invalidReqErr = await client.nextResponse();
      assert.equal(invalidReqErr.id, null);
      assert.equal(invalidReqErr.error.code, -32600);

      client.send({ jsonrpc: "2.0", id: 9, method: "unknown/method" });
      const methodErr = await client.nextResponse();
      assert.equal(methodErr.id, 9);
      assert.equal(methodErr.error.code, -32601);

      const exit = await client.close();
      assert.equal(exit.code, 0);
      assert.equal(exit.stderr, "");
      assert.equal(exit.rawLines.length, 11);
      for (const parsed of exit.parsedLines) {
        assert.equal(parsed.jsonrpc, "2.0");
      }
    } finally {
      await client.dispose();
    }
  });
});

test("2. MCP App 메타데이터·리소스 계약 및 잘못된 요청 코드(-32002/-32602)", async () => {
  await withWorkspace(async ({ env }) => {
    const server = createDagMcpServer({ env });

    const init = await server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    });
    assert.equal(init.result.protocolVersion, "2025-06-18");
    assert.ok(init.result.capabilities.resources);
    assert.ok(init.result.capabilities.tools);

    const initFallback = await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: { protocolVersion: "1999-01-01" },
    });
    assert.equal(initFallback.result.protocolVersion, "2025-03-26");

    const listed = await server.handleMessage({ jsonrpc: "2.0", id: 3, method: "tools/list" });
    const openTool = listed.result.tools.find((item) => item.name === "open_pota_dag");
    const stateTool = listed.result.tools.find((item) => item.name === "pota_dag_state");
    assert.ok(openTool);
    assert.ok(stateTool);

    assert.equal(openTool._meta.ui.resourceUri, DAG_APP_RESOURCE_URI);
    assert.deepEqual(openTool._meta.ui.visibility, ["model", "app"]);
    assert.deepEqual(openTool._meta["com.google.antigravity/ui"].entrypoints, [
      { type: "aux_pane", title: "Pota DAG" },
      { type: "global", title: "Pota DAG" },
    ]);
    assert.equal(openTool.inputSchema.required, undefined);

    assert.deepEqual(stateTool._meta.ui.visibility, ["app"]);

    const emptyOpenCall = await server.handleMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "open_pota_dag", arguments: {} },
    });
    assert.equal(emptyOpenCall.error, undefined);
    assert.equal(emptyOpenCall.result.structuredContent.root, null);

    const readOk = await server.handleMessage({
      jsonrpc: "2.0",
      id: 5,
      method: "resources/read",
      params: { uri: DAG_APP_RESOURCE_URI },
    });
    assert.equal(readOk.result.contents[0].mimeType, "text/html;profile=mcp-app");
    assert.equal(readOk.result.contents[0]._meta.ui.prefersBorder, false);

    const readMissing = await server.handleMessage({
      jsonrpc: "2.0",
      id: 6,
      method: "resources/read",
      params: { uri: "ui://pota-dag/missing.html" },
    });
    assert.equal(readMissing.error.code, -32002);

    const readNoUri = await server.handleMessage({
      jsonrpc: "2.0",
      id: 7,
      method: "resources/read",
      params: {},
    });
    assert.equal(readNoUri.error.code, -32602);

    const unknownTool = await server.handleMessage({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "nonexistent_tool", arguments: {} },
    });
    assert.equal(unknownTool.error.code, -32602);

    for (const [idx, params] of [
      { name: "open_pota_dag", arguments: "not-an-object" },
      { name: "open_pota_dag", arguments: { root: 123 } },
      { name: "open_pota_dag", arguments: { view: 99 } },
      { name: "open_pota_dag", arguments: { locale: true } },
      { name: "pota_dag_state", arguments: { width: "wide" } },
      { name: "pota_dag_state", arguments: { forceEpoch: "yes" } },
      { arguments: {} },
    ].entries()) {
      const badCall = await server.handleMessage({
        jsonrpc: "2.0",
        id: 20 + idx,
        method: "tools/call",
        params,
      });
      assert.equal(badCall.error.code, -32602, `case ${idx} should fail with -32602`);
    }
  });
});

test("3. 비간섭 워크스페이스 레지스트리, symlink 방어, 우선순위 및 잘못된 root 처리", async () => {
  await withWorkspace(async ({ base, repo, env }) => {
    const stubRun = async () => ({
      status: 0,
      message: "",
      hookOutput: { hookSpecificOutput: { additionalContext: "capsule" } },
    });

    const startOut = await runAntigravityHook(
      "session-start",
      { conversationId: "conv-1", workspacePaths: [repo] },
      { env, now: new Date("2026-11-23T01:00:00Z"), run: stubRun },
    );
    assert.deepEqual(startOut, { injectSteps: [{ systemMessage: { systemMessage: "capsule" } }] });

    const preOut = await runAntigravityHook(
      "pre-invocation",
      { conversationId: "conv-1", workspacePaths: [repo], invocationNum: 0, lastUserInput: "Go" },
      { env, now: new Date("2026-11-23T01:01:00Z"), run: stubRun },
    );
    assert.deepEqual(preOut, { injectSteps: [{ systemMessage: { systemMessage: "capsule" } }] });

    // hosts/antigravity-dag/workspaces.json만 쓰고 hosts/antigravity 디렉터리는 건드리지 않는다.
    assert.equal(existsSync(workspaceRegistryPath(env)), true);
    assert.equal(existsSync(join(env.POTA_HOME, "hosts", "antigravity")), false);
    const registry = await readWorkspaceRegistry({ env, now: new Date("2026-11-23T01:02:00Z") });
    assert.equal(registry.workspaces.length, 1);
    assert.equal(registry.workspaces[0].root, repo);

    // symlinked hosts/antigravity-dag 디렉터리 방어 (외부 대상에 쓰지 않고 훅은 정상 exit 0 반환)
    const symDirHome = join(base, "sym-dir-home");
    const outsideDir = join(base, "outside-dir");
    await mkdir(join(symDirHome, "hosts"), { recursive: true });
    await mkdir(outsideDir, { recursive: true });
    await symlink(outsideDir, join(symDirHome, "hosts", "antigravity-dag"));
    const symDirEnv = { ...env, POTA_HOME: symDirHome };

    const cliStartSymDir = runHookCli(symDirEnv, "session-start", {
      conversationId: "conv-sym-dir",
      workspacePaths: [repo],
    });
    assert.equal(cliStartSymDir.status, 0);
    assert.match(cliStartSymDir.output.injectSteps[0].systemMessage.systemMessage, /^Pota kernel:/);
    assert.deepEqual(await readdir(outsideDir), []);

    const cliPreSymDir = runHookCli(symDirEnv, "pre-invocation", {
      conversationId: "conv-sym-dir",
      workspacePaths: [repo],
      invocationNum: 0,
      lastUserInput: "Hi",
    });
    assert.equal(cliPreSymDir.status, 0);
    assert.match(cliPreSymDir.output.injectSteps[0].systemMessage.systemMessage, /^Pota kernel:/);
    assert.deepEqual(await readdir(outsideDir), []);

    // symlinked workspaces.json 방어 (외부 파일에 쓰지 않고 훅은 정상 exit 0 반환)
    const symFileHome = join(base, "sym-file-home");
    const outsideFile = join(base, "outside-workspaces.json");
    await mkdir(join(symFileHome, "hosts", "antigravity-dag"), { recursive: true });
    await writeFile(outsideFile, "KEEP_OUTSIDE\n", "utf8");
    await symlink(outsideFile, join(symFileHome, "hosts", "antigravity-dag", "workspaces.json"));
    const symFileEnv = { ...env, POTA_HOME: symFileHome };

    const cliStartSymFile = runHookCli(symFileEnv, "session-start", {
      conversationId: "conv-sym-file",
      workspacePaths: [repo],
    });
    assert.equal(cliStartSymFile.status, 0);
    assert.match(cliStartSymFile.output.injectSteps[0].systemMessage.systemMessage, /^Pota kernel:/);
    assert.equal(await readFile(outsideFile, "utf8"), "KEEP_OUTSIDE\n");
    assert.equal((await resolveWorkspace({ env: symFileEnv })).root, null);

    // 우선순위: 명시 root > workspaces.json(live goal 우선 -> 최신 유효 dir) > HARNESS_REPO_ROOT > null
    const priorityHome = join(base, "priority-home");
    const priorityEnv = { ...env, POTA_HOME: priorityHome };
    process.env.POTA_HOME = priorityHome;

    const repoOlderWithGoal = await initTempRepo(join(base, "repo-older-goal"));
    const repoNewerWithGoal = await initTempRepo(join(base, "repo-newer-goal"));
    const repoNewestNoGoal = await initTempRepo(join(base, "repo-newest-empty"));
    const repoEnvOnly = await initTempRepo(join(base, "repo-env-only"));
    const repoExplicit = await initTempRepo(join(base, "repo-explicit"));

    await startGoal({
      root: repoOlderWithGoal,
      goal: "Older Live Goal",
      planId: "docs/plan/live-old.md",
      evidencePolicy: "declared",
      tasks: [{ id: "t1", title: "Old Live Task", requiredEvidence: ["moduleAcceptance"] }],
    });
    await startGoal({
      root: repoNewerWithGoal,
      goal: "Newer Live Goal",
      planId: "docs/plan/live-new.md",
      evidencePolicy: "declared",
      tasks: [{ id: "t1", title: "New Live Task", requiredEvidence: ["moduleAcceptance"] }],
    });

    await recordActiveWorkspace({
      workspacePath: repoOlderWithGoal,
      conversationId: "c-old",
      env: priorityEnv,
      now: new Date("2026-11-23T01:00:00Z"),
    });
    await recordActiveWorkspace({
      workspacePath: repoNewerWithGoal,
      conversationId: "c-mid",
      env: priorityEnv,
      now: new Date("2026-11-23T02:00:00Z"),
    });
    await recordActiveWorkspace({
      workspacePath: repoNewestNoGoal,
      conversationId: "c-new",
      env: priorityEnv,
      now: new Date("2026-11-23T03:00:00Z"),
    });

    const withExplicit = await resolveWorkspace({
      root: repoExplicit,
      env: { ...priorityEnv, HARNESS_REPO_ROOT: repoEnvOnly },
      now: new Date("2026-11-23T04:00:00Z"),
    });
    assert.equal(withExplicit.root, repoExplicit);
    assert.equal(withExplicit.source, "explicit");
    assert.equal(withExplicit.error, null);

    const liveBeatsNewer = await resolveWorkspace({
      env: { ...priorityEnv, HARNESS_REPO_ROOT: repoEnvOnly },
      now: new Date("2026-11-23T04:00:00Z"),
    });
    assert.equal(liveBeatsNewer.root, repoNewerWithGoal);
    assert.equal(liveBeatsNewer.source, "registry");

    // live goal이 모두 없어진 뒤에는 더 최근의 유효 디렉터리(repoNewestNoGoal)가 선택되어야 한다.
    await rm(goalStatePath(repoOlderWithGoal), { force: true });
    await rm(goalStatePath(repoNewerWithGoal), { force: true });
    const newerBeatsOlder = await resolveWorkspace({
      env: { ...priorityEnv, HARNESS_REPO_ROOT: repoEnvOnly },
      now: new Date("2026-11-23T04:00:00Z"),
    });
    assert.equal(newerBeatsOlder.root, repoNewestNoGoal);
    assert.equal(newerBeatsOlder.source, "registry");

    // workspaces.json이 비어 있으면 HARNESS_REPO_ROOT를 사용한다.
    const envOnlyHome = join(base, "env-only-home");
    const envOnly = await resolveWorkspace({
      env: { ...env, POTA_HOME: envOnlyHome, HARNESS_REPO_ROOT: repoEnvOnly },
    });
    assert.equal(envOnly.root, repoEnvOnly);
    assert.equal(envOnly.source, "env");

    // 모두 없으면 process.cwd()/플러그인 루트로 폴백하지 않고 root: null을 반환한다.
    const emptyFallback = await resolveWorkspace({ env: { ...env, POTA_HOME: envOnlyHome } });
    assert.equal(emptyFallback.root, null);
    assert.equal(emptyFallback.source, "none");
    assert.equal(emptyFallback.error, null);

    const emptyServer = createDagMcpServer({ env: { ...env, POTA_HOME: envOnlyHome } });
    const emptyOpen = await emptyServer.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "open_pota_dag", arguments: {} },
    });
    assert.equal(emptyOpen.result.structuredContent.root, null);
    assert.equal(emptyOpen.result.structuredContent.goal, null);
    assert.equal(emptyOpen.result.structuredContent.error, null);

    // 상대 경로·미존재 경로·일반 파일 경로는 크래시 없이 구조화된 invalid-root 오류를 반환한다.
    const regularFile = join(base, "plain.txt");
    await writeFile(regularFile, "x", "utf8");
    for (const badRoot of ["relative/repo", join(base, "does-not-exist"), regularFile]) {
      const badResolved = await resolveWorkspace({ root: badRoot, env: priorityEnv });
      assert.equal(badResolved.root, null);
      assert.equal(badResolved.error, "invalid-root");

      const badCall = await emptyServer.handleMessage({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "pota_dag_state", arguments: { root: badRoot } },
      });
      assert.equal(badCall.error, undefined);
      assert.equal(badCall.result.structuredContent.root, null);
      assert.equal(badCall.result.structuredContent.error, "invalid-root");
    }
  });
});

test("4. DAG 보기 전환, 반응형 폭, SVG 메모이제이션, 종료 goal 전환 및 오류/1MiB 한도", async () => {
  await withWorkspace(async ({ base, repo, env }) => {
    await mkdir(join(repo, "docs", "plan"), { recursive: true });
    await mkdir(join(repo, "src"), { recursive: true });
    await writeFile(join(repo, "docs", "plan", "panel.md"), "# Plan\n", "utf8");
    await writeFile(join(repo, "src", "app.mjs"), "export const ok = true;\n", "utf8");

    await startGoal({
      root: repo,
      goal: "DAG Panel Goal",
      planId: "docs/plan/panel.md",
      evidencePolicy: "declared",
      requiredEvidence: ["finalReview"],
      tasks: [
        { id: "t1", title: "AlphaDone", requiredEvidence: ["moduleAcceptance"] },
        {
          id: "t2",
          title: "BetaRunning",
          dependsOn: ["t1"],
          requiredEvidence: ["moduleAcceptance"],
          writeScope: ["src/app.mjs"],
        },
        {
          id: "t2b",
          title: "BlockedTask",
          dependsOn: ["t1"],
          requiredEvidence: ["moduleAcceptance"],
          writeScope: ["src/other.mjs"],
        },
        { id: "t3", title: "GammaNext", dependsOn: ["t2"], requiredEvidence: ["moduleAcceptance"] },
        { id: "t4", title: "DeltaFuture", dependsOn: ["t3"], requiredEvidence: ["moduleAcceptance"] },
      ],
    });
    await recordReceipt({ root: repo, taskId: "t1", kind: "moduleAcceptance", command: "test t1", exitCode: 0 });
    await setTaskStatus({ root: repo, taskId: "t1", status: "completed", mainModelGate: false });
    await setTaskStatus({
      root: repo,
      taskId: "t2b",
      status: "blocked",
      blocker: "Waiting on API",
      mainModelGate: false,
    });

    // 분(minute) 경계에 맞춘 가짜 시계로 연속 폴링 메모이제이션을 결정적으로 검증한다.
    let fakeNow = 1_700_000_040_000;
    let nextCallId = 1;
    const server = createDagMcpServer({ env, now: () => fakeNow });

    const callState = async (args = {}) => {
      const res = await server.handleMessage({
        jsonrpc: "2.0",
        id: nextCallId++,
        method: "tools/call",
        params: { name: "pota_dag_state", arguments: { root: repo, locale: "en", ...args } },
      });
      assert.equal(res.error, undefined);
      assert.ok(Buffer.byteLength(JSON.stringify(res.result), "utf8") < ONE_MIB);
      return res.result.structuredContent;
    };

    // 기본 view는 all이며 모든 wave와 요약, 상세 파일 URI를 포함한다.
    const allView = await callState({ width: 420 });
    assert.equal(allView.view, "all");
    assert.equal(allView.hiddenAfter, 0);
    assert.equal(allView.summary.waveCurrent, 2);
    assert.equal(allView.summary.waveTotal, 4);
    assert.equal(allView.summary.done, 1);
    assert.equal(allView.summary.total, 5);
    assert.equal(allView.summary.running, 1);
    assert.equal(allView.summary.blocked, 1);
    assert.ok(allView.goal.planFileUri?.startsWith("file://"));
    assert.equal(allView.sections.running[0].id, "t2");
    assert.equal(allView.sections.running[0].files[0].path, "src/app.mjs");
    assert.ok(allView.sections.running[0].files[0].uri.startsWith("file://"));
    assert.equal(allView.sections.blocked[0].reason, "Waiting on API");
    assert.equal(allView.sections.next[0].id, "t3");
    for (const title of ["AlphaDone", "BetaRunning", "BlockedTask", "GammaNext", "DeltaFuture"]) {
      assert.ok(allView.svg.source.includes(title), `all view includes ${title}`);
    }

    // previous / current / next 보기 전환 검증
    const prevView = await callState({ view: "previous", width: 420 });
    assert.equal(prevView.view, "previous");
    assert.ok(prevView.svg.source.includes("AlphaDone"));
    assert.equal(prevView.svg.source.includes("BetaRunning"), false);
    assert.equal(prevView.svg.source.includes("GammaNext"), false);

    const currView = await callState({ view: "current", width: 420 });
    assert.equal(currView.view, "current");
    assert.ok(currView.svg.source.includes("BetaRunning"));
    assert.ok(currView.svg.source.includes("BlockedTask"));
    assert.ok(currView.svg.source.includes("AlphaDone"));
    assert.equal(currView.svg.source.includes("GammaNext"), false);
    assert.equal(currView.svg.source.includes("DeltaFuture"), false);

    const nextView = await callState({ view: "next", width: 420 });
    assert.equal(nextView.view, "next");
    assert.ok(nextView.svg.source.includes("GammaNext"));
    assert.ok(nextView.svg.source.includes("BetaRunning"));
    assert.equal(nextView.svg.source.includes("AlphaDone"), false);
    assert.equal(nextView.svg.source.includes("DeltaFuture"), false);
    assert.equal(nextView.hiddenAfter, 1);

    // 반응형 폭(900 row vs 360 column)에 따라 SVG 크기와 방향이 바뀐다.
    const wide = await callState({ view: "all", width: 900 });
    const narrow = await callState({ view: "all", width: 360 });
    const wideSize = svgDimensions(wide.svg.source);
    const narrowSize = svgDimensions(narrow.svg.source);
    assert.equal(wideSize.width, 900);
    assert.equal(narrowSize.width, 360);
    assert.ok(narrowSize.height > wideSize.height, `narrow height ${narrowSize.height} > wide height ${wideSize.height}`);

    // 같은 상태·같은 분에서 연속 호출 시 seq와 svg.source가 바이트 단위로 동일하다.
    const memo1 = await callState({ view: "all", width: 420 });
    fakeNow += 5_000;
    const memo2 = await callState({ view: "all", width: 420 });
    assert.equal(memo2.seq, memo1.seq);
    assert.equal(memo2.epoch, memo1.epoch);
    assert.equal(memo2.svg.source, memo1.svg.source);

    // live goal을 completed로 전이(state.json 삭제, history.jsonl 기록)한 뒤 다음 조회 검증
    await setTaskStatus({ root: repo, taskId: "t2b", status: "pending", mainModelGate: false });
    for (const id of ["t2", "t2b", "t3", "t4"]) {
      await setTaskStatus({ root: repo, taskId: id, status: "active", mainModelGate: false });
      await recordReceipt({ root: repo, taskId: id, kind: "moduleAcceptance", command: `test ${id}`, exitCode: 0 });
      await setTaskStatus({ root: repo, taskId: id, status: "completed", mainModelGate: false });
    }
    await recordReceipt({ root: repo, scope: "goal", kind: "finalReview", command: "final review", exitCode: 0 });
    await transitionGoal({ root: repo, status: "completed", mainModelGate: false });
    assert.equal(existsSync(goalStatePath(repo)), false);
    assert.equal(existsSync(goalHistoryPath(repo)), true);

    fakeNow += 5_000;
    const endedState = await callState({ view: "all", width: 420 });
    assert.equal(endedState.ended?.status, "completed");
    assert.equal(endedState.goal?.status, "completed");
    assert.equal(endedState.summary?.allDone, true);
    assert.equal(endedState.summary?.done, endedState.summary?.total);

    // 빈 저장소, 손상된 state.json, 1 MiB 초과 초대형 task 목록 처리 검증
    const emptyRepo = await initTempRepo(join(base, "repo-empty"));
    const emptyRes = await server.handleMessage({
      jsonrpc: "2.0",
      id: 100,
      method: "tools/call",
      params: { name: "pota_dag_state", arguments: { root: emptyRepo } },
    });
    assert.equal(emptyRes.result.structuredContent.goal, null);
    assert.equal(emptyRes.result.structuredContent.error, null);
    assert.ok(Buffer.byteLength(JSON.stringify(emptyRes.result), "utf8") < ONE_MIB);

    const corruptRepo = await initTempRepo(join(base, "repo-corrupt"));
    await mkdir(dirname(goalStatePath(corruptRepo)), { recursive: true });
    await writeFile(goalStatePath(corruptRepo), "{broken json", "utf8");
    const corruptRes = await server.handleMessage({
      jsonrpc: "2.0",
      id: 101,
      method: "tools/call",
      params: { name: "pota_dag_state", arguments: { root: corruptRepo } },
    });
    assert.equal(corruptRes.result.structuredContent.goal, null);
    assert.equal(typeof corruptRes.result.structuredContent.error, "string");
    assert.ok(corruptRes.result.structuredContent.error.length > 0);
    assert.ok(Buffer.byteLength(JSON.stringify(corruptRes.result), "utf8") < ONE_MIB);

    const hugeRepo = await initTempRepo(join(base, "repo-huge"));
    const hugeState = {
      schemaVersion: 3,
      revision: 1,
      goal: {
        id: "goal-huge",
        title: "H".repeat(4000),
        planId: "docs/plan/huge.md",
        status: "active",
        blocker: "B".repeat(4000),
        createdAt: "2026-11-23T00:00:00Z",
        updatedAt: "2026-11-23T00:00:00Z",
        requiredEvidence: ["finalReview"],
      },
      tasks: Array.from({ length: 240 }, (_, index) => ({
        id: `huge-${index + 1}`,
        title: `Task-${index + 1}-${"T".repeat(4000)}`,
        status: index < 4 ? "active" : index < 20 ? "blocked" : "pending",
        dependsOn: [],
        assignedAgentId: null,
        requiredEvidence: ["moduleAcceptance"],
        writeScope: null,
        blocker: index < 20 ? `Blocker-${"X".repeat(2500)}` : null,
        createdAt: "2026-11-23T00:00:00Z",
        updatedAt: "2026-11-23T00:00:00Z",
      })),
      receipts: [],
    };
    const hugeServer = createDagMcpServer({
      env,
      now: () => fakeNow,
      readGoalState: async () => hugeState,
    });
    const hugeRes = await hugeServer.handleMessage({
      jsonrpc: "2.0",
      id: 102,
      method: "tools/call",
      params: { name: "pota_dag_state", arguments: { root: hugeRepo } },
    });
    assert.equal(hugeRes.error, undefined);
    assert.ok(Buffer.byteLength(JSON.stringify(hugeRes.result), "utf8") < ONE_MIB);
  });
});

test("5. 보안 검증: SVG XSS 이스케이프, file:// URI 경로 검증 및 HTML CSP", async () => {
  await withWorkspace(async ({ base, repo, env }) => {
    await mkdir(join(repo, "scripts"), { recursive: true });
    await writeFile(join(repo, "scripts", "inside.mjs"), "export default 1;\n", "utf8");
    const outsideSecret = join(base, "secret.txt");
    await writeFile(outsideSecret, "SECRET\n", "utf8");
    await symlink(outsideSecret, join(repo, "scripts", "escaped-link.txt"));
    const outsideDir = join(base, "outside-sub");
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(outsideDir, "nested.txt"), "OUT\n", "utf8");
    await symlink(outsideDir, join(repo, "linked-dir"));

    // 5-1. goal/task/blocker XSS payloads -> SVG XML 이스케이프 검증
    const xssTitle = 'Goal <script>alert(1)</script> " onload=x';
    const xssTask1 = 'T1 <script>alert(1)</script>';
    const xssTask2 = 'T2 <svg onload=x>';
    const xssBlocker = 'Blk <script>alert(1)</script> <img onload=x>';

    await startGoal({
      root: repo,
      goal: xssTitle,
      planId: "docs/plan/xss.md",
      evidencePolicy: "declared",
      tasks: [
        { id: "t1", title: xssTask1, requiredEvidence: ["moduleAcceptance"] },
        { id: "t2", title: xssTask2, dependsOn: ["t1"], requiredEvidence: ["moduleAcceptance"] },
      ],
    });
    await setTaskStatus({
      root: repo,
      taskId: "t2",
      status: "blocked",
      blocker: xssBlocker,
      mainModelGate: false,
    });

    const server = createDagMcpServer({ env });
    const xssRes = await server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "pota_dag_state", arguments: { root: repo } },
    });
    const svgSource = xssRes.result.structuredContent.svg.source;
    assert.doesNotMatch(svgSource, /<script/i);
    assert.ok(svgSource.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert.ok(svgSource.includes("&lt;svg onload=x&gt;"));
    assert.ok(svgSource.includes("&lt;img onload=x&gt;"));
    // 어떤 XML 요소 태그 안에도 이벤트 핸들러(on*=) 속성이 삽입되지 않아야 한다.
    const openingTags = svgSource.match(/<[^>]+>/g) ?? [];
    for (const tag of openingTags) {
      assert.doesNotMatch(tag, /\son[a-z]+\s*=/i, `unexpected event attribute in ${tag}`);
    }

    // 5-2. renderDagAppHtml() CSP, 프로토콜 메시지 및 안전 DOM 조작 검증
    const html = renderDagAppHtml({ title: 'Pota <script>alert("x")</script>', version: "2.2.1" });
    assert.ok(html.startsWith("<!DOCTYPE html>"));
    for (const needle of [
      "ui/initialize",
      "2026-01-26",
      "ui/notifications/initialized",
      "ping",
      "ui/notifications/tool-result",
      "ui/notifications/host-context-changed",
      "ui/notifications/size-changed",
      "com.google.antigravity/toggle-aux-pane",
      "tools/call",
      "DOMParser",
      "textContent",
    ]) {
      assert.ok(html.includes(needle), `HTML must include ${needle}`);
    }
    assert.doesNotMatch(html, /<script[^>]*\bsrc\s*=/i);
    assert.doesNotMatch(html, /<link[^>]*\bhref\s*=/i);
    assert.doesNotMatch(html, /\bfetch\s*\(/);
    assert.doesNotMatch(html, /\bnew\s+WebSocket\b/);
    assert.doesNotMatch(html, /https?:\/\//i);
    assert.doesNotMatch(html, /\.innerHTML\b|insertAdjacentHTML|outerHTML|document\.write/);
    // 인라인 스크립트가 문법적으로 유효하고 title 옵션의 태그 탈출이 없는지 확인한다.
    const scriptMatches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    assert.equal(scriptMatches.length, 1);
    assert.doesNotThrow(() => new vm.Script(scriptMatches[0][1]));

    // 5-3. resolveSafeRepoFileUri 경로 탈출·글롭·디렉터리·심볼릭 링크 차단 검증
    for (const unsafe of [
      "../../etc/passwd",
      "/etc/passwd",
      "scripts/inside.mjs\0",
      "*.mjs",
      "scripts/*.mjs",
      "scripts",
      "scripts/escaped-link.txt",
      "linked-dir/nested.txt",
      "scripts/missing.mjs",
    ]) {
      assert.equal(resolveSafeRepoFileUri(repo, unsafe), null, `must block ${JSON.stringify(unsafe)}`);
    }

    const safeUri = resolveSafeRepoFileUri(repo, "scripts/inside.mjs");
    assert.ok(typeof safeUri === "string" && safeUri.startsWith("file://"));
    assert.equal(fileURLToPath(safeUri), realpathSync(join(repo, "scripts", "inside.mjs")));
  });
});

function svgDimensions(source) {
  const match = source.match(/^<svg\b[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"/);
  assert.ok(match, "SVG root element must expose width and height");
  return { width: Number(match[1]), height: Number(match[2]) };
}

function runHookCli(env, event, input) {
  const result = spawnSync(process.execPath, [hookAdapter, event], {
    cwd: pluginRoot,
    env,
    input: JSON.stringify(input),
    encoding: "utf8",
  });
  assert.equal(result.stderr, "", result.stderr);
  return { status: result.status, output: JSON.parse(result.stdout) };
}

function spawnMcpClient(env, { cwd = pluginRoot } = {}) {
  const child = spawn(process.execPath, [mcpEntry], {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdoutBuffer = "";
  let stderrBuffer = "";
  let closed = false;
  const rawLines = [];
  const parsedLines = [];
  const waiters = [];

  const failWaiters = (err) => {
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      clearTimeout(waiter.timer);
      waiter.reject(err);
    }
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    let idx;
    while ((idx = stdoutBuffer.indexOf("\n")) !== -1) {
      const line = stdoutBuffer.slice(0, idx);
      stdoutBuffer = stdoutBuffer.slice(idx + 1);
      if (line.length === 0) {
        failWaiters(new Error("Unexpected blank line on stdout"));
        return;
      }
      rawLines.push(line);
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        failWaiters(new Error(`Non-JSON line on stdout: ${line} (${err.message})`));
        return;
      }
      parsedLines.push(parsed);
      if (waiters.length > 0) {
        const waiter = waiters.shift();
        clearTimeout(waiter.timer);
        waiter.resolve(parsed);
      }
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderrBuffer += chunk;
  });

  const exitPromise = new Promise((resolveExit, rejectExit) => {
    child.on("error", (err) => {
      closed = true;
      failWaiters(err);
      rejectExit(err);
    });
    child.on("close", (code, signal) => {
      closed = true;
      if (stdoutBuffer.trim().length > 0) {
        failWaiters(new Error(`Trailing non-newline stdout: ${stdoutBuffer}`));
      } else {
        failWaiters(new Error(`MCP server exited unexpectedly (code=${code}, signal=${signal})`));
      }
      resolveExit({ code, signal, stderr: stderrBuffer, rawLines, parsedLines });
    });
  });

  let readIndex = 0;
  return {
    send(msg) {
      const line = typeof msg === "string" ? msg : JSON.stringify(msg);
      child.stdin.write(`${line}\n`);
    },
    nextResponse(timeoutMs = 10_000) {
      if (readIndex < parsedLines.length) {
        return Promise.resolve(parsedLines[readIndex++]);
      }
      if (closed) {
        return Promise.reject(new Error("MCP server already closed before response arrived"));
      }
      return new Promise((resolveNext, rejectNext) => {
        const timer = setTimeout(() => {
          const pos = waiters.findIndex((entry) => entry.resolve === resolveNext);
          if (pos !== -1) waiters.splice(pos, 1);
          rejectNext(new Error(`Timed out waiting for MCP response #${readIndex + 1}`));
        }, timeoutMs);
        waiters.push({
          timer,
          resolve: (val) => {
            readIndex += 1;
            resolveNext(val);
          },
          reject: rejectNext,
        });
      });
    },
    close() {
      child.stdin.end();
      return exitPromise;
    },
    async dispose() {
      if (!closed) {
        child.kill("SIGKILL");
        await exitPromise.catch(() => {});
      }
    },
  };
}

async function initTempRepo(dirPath) {
  await mkdir(dirPath, { recursive: true });
  const git = spawnSync("git", ["init", "-q"], { cwd: dirPath, encoding: "utf8" });
  assert.equal(git.status, 0, git.stderr);
  return realpathSync(dirPath);
}

// 테스트마다 임시 HOME/POTA_HOME/repo를 격리하고 process.env 오염을 방지한다.
async function withWorkspace(work) {
  const base = realpathSync(await mkdtemp(join(tmpdir(), "pota-antigravity-dag-")));
  const home = join(base, "home");
  const potaHomeDir = join(base, "pota-home");
  const repo = join(base, "repo");
  await mkdir(home, { recursive: true });
  await initTempRepo(repo);

  const env = {
    PATH: process.env.PATH,
    HOME: home,
    POTA_HOME: potaHomeDir,
    LANG: "en_US.UTF-8",
    POTA_COMMENT_CHECKER: "0",
    POTA_AUTO_UPGRADE: "0",
  };
  const savedKeys = ["HOME", "POTA_HOME", "HARNESS_REPO_ROOT", "POTA_MODEL_CEILING", "POTA_COMMENT_CHECKER", "POTA_AUTO_UPGRADE"];
  const previous = Object.fromEntries(savedKeys.map((key) => [key, process.env[key]]));
  process.env.HOME = home;
  process.env.POTA_HOME = potaHomeDir;
  process.env.POTA_COMMENT_CHECKER = "0";
  process.env.POTA_AUTO_UPGRADE = "0";
  delete process.env.HARNESS_REPO_ROOT;
  delete process.env.POTA_MODEL_CEILING;

  try {
    await work({ base, home, potaHomeDir, repo, env });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(base, { recursive: true, force: true });
  }
}
