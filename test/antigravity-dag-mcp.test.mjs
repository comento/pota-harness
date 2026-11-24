import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import {
  assignTask,
  goalHistoryPath,
  goalStatePath,
  readGoalState,
  recordReceipt,
  setTaskApprovalGate,
  setTaskStatus,
  startGoal,
  transitionGoal,
  verifyAndRecord,
  workspaceFingerprint,
} from "../scripts/pota-goal.mjs";
import {
  DAG_MCP_REFRESH_THROTTLE_MS,
  DAG_MCP_SERVER_NAME,
  clearDagMcpServerPid,
  dagMcpServerStatePath,
  ensureAntigravityDagMcp,
  readDagMcpServerState,
  readWorkspaceRegistry,
  recordActiveWorkspace,
  recordDagMcpServerPid,
  runAntigravityHook,
  workspaceRegistryPath,
} from "../scripts/pota-state-antigravity.mjs";
import {
  createDagMcpServer,
  resolveSafeRepoFileUri,
  resolveWorkspace,
} from "../scripts/pota-dag-mcp-core.mjs";
import { parseHostArg } from "../scripts/pota-dag-mcp.mjs";
import { runStateResult } from "../scripts/pota-state.mjs";
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
        ["open_pota_dag", "pota_dag_state", "pota_dag_action"],
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

test("6. DAG MCP 서버 PID 수명주기, ensureAntigravityDagMcp 자동 복구, SSRF 방어 및 훅/CLI 연동", async () => {
  await withWorkspace(async ({ base, repo, env }) => {
    const secretToken = "super-secret-csrf-token-12345";
    const t0 = new Date("2026-11-24T01:00:00.000Z");

    // 6-1. recordDagMcpServerPid / clearDagMcpServerPid 소유권 및 lastRefreshAt 보존 검증
    const firstRecord = await recordDagMcpServerPid({ pid: 424242, env, now: t0 });
    assert.equal(firstRecord.recorded, true);
    assert.equal(existsSync(dagMcpServerStatePath(env)), true);
    assert.equal(existsSync(join(env.POTA_HOME, "hosts", "antigravity")), false);

    const wrongClear = await clearDagMcpServerPid({ pid: 999999, env });
    assert.equal(wrongClear.cleared, false);
    assert.equal((await readDagMcpServerState({ env })).pid, 424242);

    // 6-2. 살아 있는 PID는 RefreshMcpServers를 호출하지 않고 alive를 반환한다.
    let fetchCalls = 0;
    const countingFetch = async () => {
      fetchCalls += 1;
      return { ok: true, status: 200 };
    };
    const aliveResult = await ensureAntigravityDagMcp({
      env: { ...env, ANTIGRAVITY_CSRF_TOKEN: secretToken },
      now: new Date("2026-11-24T01:00:05.000Z"),
      fetchImpl: countingFetch,
      isPidAlive: (pid) => pid === 424242,
    });
    assert.deepEqual(aliveResult, { status: "alive", pid: 424242 });
    assert.equal(fetchCalls, 0);

    // 6-3. 정상 종료 시 자기 PID일 때만 pid: null로 정리한다.
    const ownClear = await clearDagMcpServerPid({ pid: 424242, env });
    assert.equal(ownClear.cleared, true);
    assert.equal((await readDagMcpServerState({ env })).pid, null);

    // 6-4. CSRF 토큰 부재 및 POTA_ANTIGRAVITY_DAG_REFRESH=0 비활성화 시 네트워크를 호출하지 않는다.
    const noTokenResult = await ensureAntigravityDagMcp({
      env,
      now: t0,
      fetchImpl: countingFetch,
      isPidAlive: () => false,
    });
    assert.deepEqual(noTokenResult, { status: "skipped", reason: "no-csrf-token" });
    assert.equal(fetchCalls, 0);

    for (const offValue of ["0", "false", "off", "no"]) {
      const disabledResult = await ensureAntigravityDagMcp({
        env: { ...env, ANTIGRAVITY_CSRF_TOKEN: secretToken, POTA_ANTIGRAVITY_DAG_REFRESH: offValue },
        now: t0,
        fetchImpl: countingFetch,
        isPidAlive: () => false,
      });
      assert.deepEqual(disabledResult, { status: "skipped", reason: "disabled" });
    }
    assert.equal(fetchCalls, 0);

    // 6-5. 비-loopback / 비정상 ANTIGRAVITY_LS_ADDRESS는 CSRF 토큰 유출 방지를 위해 차단한다.
    for (const badAddr of [
      "evil.example:5387",
      "192.168.1.10:5387",
      "user@localhost:5387",
      "http://localhost:5387",
      "localhost:5387/extra",
      "localhost:99999",
      "localhost:0",
      "localhost.evil.com:5387",
    ]) {
      const blocked = await ensureAntigravityDagMcp({
        env: { ...env, ANTIGRAVITY_CSRF_TOKEN: secretToken, ANTIGRAVITY_LS_ADDRESS: badAddr },
        now: t0,
        fetchImpl: countingFetch,
        isPidAlive: () => false,
      });
      assert.deepEqual(blocked, { status: "skipped", reason: "non-loopback-address" }, `must reject ${badAddr}`);
    }
    assert.equal(fetchCalls, 0);

    // 6-6. dead PID 상태에서 loopback RefreshMcpServers POST 호출 및 30초 스로틀 / --force 검증
    await recordDagMcpServerPid({ pid: 777777, env, now: t0 });
    const capturedRequests = [];
    const mockFetch = async (url, init) => {
      capturedRequests.push({ url, init });
      return { ok: true, status: 200 };
    };
    const tRefresh1 = new Date(t0.getTime() + 1_000);
    const refreshed = await ensureAntigravityDagMcp({
      env: { ...env, ANTIGRAVITY_CSRF_TOKEN: secretToken, ANTIGRAVITY_LS_ADDRESS: "127.0.0.1:5399" },
      now: tRefresh1,
      fetchImpl: mockFetch,
      isPidAlive: () => false,
    });
    assert.deepEqual(refreshed, { status: "refreshed" });
    assert.equal(capturedRequests.length, 1);
    assert.equal(
      capturedRequests[0].url,
      "http://127.0.0.1:5399/exa.language_server_pb.LanguageServerService/RefreshMcpServers",
    );
    assert.equal(capturedRequests[0].init.method, "POST");
    assert.equal(capturedRequests[0].init.headers["Content-Type"], "application/json");
    assert.equal(capturedRequests[0].init.headers["x-codeium-csrf-token"], secretToken);
    assert.deepEqual(JSON.parse(capturedRequests[0].init.body), { serverName: DAG_MCP_SERVER_NAME });

    const afterRefreshState = await readDagMcpServerState({ env });
    assert.equal(afterRefreshState.pid, null);
    assert.equal(afterRefreshState.lastRefreshAt, tRefresh1.toISOString());

    // 30초 이내 재호출은 스로틀된다.
    const throttled = await ensureAntigravityDagMcp({
      env: { ...env, ANTIGRAVITY_CSRF_TOKEN: secretToken },
      now: new Date(tRefresh1.getTime() + DAG_MCP_REFRESH_THROTTLE_MS - 1),
      fetchImpl: mockFetch,
      isPidAlive: () => false,
    });
    assert.deepEqual(throttled, { status: "throttled" });
    assert.equal(capturedRequests.length, 1);

    // force: true는 스로틀을 우회한다.
    const forced = await ensureAntigravityDagMcp({
      env: { ...env, ANTIGRAVITY_CSRF_TOKEN: secretToken, ANTIGRAVITY_LS_ADDRESS: "[::1]:5400" },
      now: new Date(tRefresh1.getTime() + 2_000),
      force: true,
      fetchImpl: mockFetch,
      isPidAlive: () => false,
    });
    assert.deepEqual(forced, { status: "refreshed" });
    assert.equal(capturedRequests.length, 2);
    assert.equal(
      capturedRequests[1].url,
      "http://[::1]:5400/exa.language_server_pb.LanguageServerService/RefreshMcpServers",
    );

    // recordDagMcpServerPid는 기존 lastRefreshAt을 보존한다.
    await recordDagMcpServerPid({ pid: 888888, env, now: new Date(tRefresh1.getTime() + 3_000) });
    const preservedState = await readDagMcpServerState({ env });
    assert.equal(preservedState.pid, 888888);
    assert.equal(preservedState.lastRefreshAt, new Date(tRefresh1.getTime() + 2_000).toISOString());
    await clearDagMcpServerPid({ pid: 888888, env });

    // 6-7. HTTP 500 및 fetch 예외 시 throw 없이 실패를 반환하고 토큰을 노출하지 않는다.
    const http500 = await ensureAntigravityDagMcp({
      env: { ...env, ANTIGRAVITY_CSRF_TOKEN: secretToken },
      now: new Date(tRefresh1.getTime() + DAG_MCP_REFRESH_THROTTLE_MS + 5_000),
      fetchImpl: async () => ({ ok: false, status: 500 }),
      isPidAlive: () => false,
    });
    assert.deepEqual(http500, { status: "failed", statusCode: 500 });
    assert.equal(JSON.stringify(http500).includes(secretToken), false);

    const threw = await ensureAntigravityDagMcp({
      env: { ...env, ANTIGRAVITY_CSRF_TOKEN: secretToken },
      now: new Date(tRefresh1.getTime() + DAG_MCP_REFRESH_THROTTLE_MS * 2 + 10_000),
      fetchImpl: async () => {
        throw new Error(`network failure with ${secretToken}`);
      },
      isPidAlive: () => false,
    });
    assert.deepEqual(threw, { status: "failed", reason: "request-error" });
    assert.equal(JSON.stringify(threw).includes(secretToken), false);

    // 6-8. symlink된 server.json은 읽지 않고 빈 상태로 폴백한다.
    const symHome = join(base, "sym-server-home");
    const outsideServer = join(base, "outside-server.json");
    await mkdir(join(symHome, "hosts", "antigravity-dag"), { recursive: true });
    await writeFile(outsideServer, JSON.stringify({ schemaVersion: 1, pid: 12345 }), "utf8");
    await symlink(outsideServer, join(symHome, "hosts", "antigravity-dag", "server.json"));
    const symState = await readDagMcpServerState({ env: { ...env, POTA_HOME: symHome } });
    assert.deepEqual(symState, { schemaVersion: 1, pid: null, startedAt: null, lastRefreshAt: null });

    // 6-9. 실제 로컬 loopback HTTP 서버로 `pota-dag-mcp.mjs ensure` CLI와 `runAntigravityHook` 연동을 검증한다.
    const serverRequests = [];
    const testServer = http.createServer((req, res) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        serverRequests.push({
          method: req.method,
          url: req.url,
          csrf: req.headers["x-codeium-csrf-token"],
          body,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
      });
    });
    await new Promise((resolveListen) => testServer.listen(0, "127.0.0.1", resolveListen));
    try {
      const address = testServer.address();
      const cliHome = join(base, "cli-ensure-home");
      const cliEnv = {
        ...env,
        POTA_HOME: cliHome,
        ANTIGRAVITY_CSRF_TOKEN: secretToken,
        ANTIGRAVITY_LS_ADDRESS: `127.0.0.1:${address.port}`,
      };

      const cliRes = await runCliAsync(process.execPath, [mcpEntry, "ensure"], {
        cwd: pluginRoot,
        env: cliEnv,
      });
      assert.equal(cliRes.status, 0);
      assert.equal(cliRes.stderr, "");
      assert.equal(cliRes.stdout.includes(secretToken), false);
      assert.deepEqual(JSON.parse(cliRes.stdout.trim()), { status: "refreshed" });
      assert.equal(serverRequests.length, 1);
      assert.equal(serverRequests[0].url, "/exa.language_server_pb.LanguageServerService/RefreshMcpServers");
      assert.equal(serverRequests[0].csrf, secretToken);
      assert.deepEqual(JSON.parse(serverRequests[0].body), { serverName: DAG_MCP_SERVER_NAME });

      const cliForceRes = await runCliAsync(process.execPath, [mcpEntry, "ensure", "--force"], {
        cwd: pluginRoot,
        env: cliEnv,
      });
      assert.equal(cliForceRes.status, 0);
      assert.equal(cliForceRes.stderr, "");
      assert.equal(cliForceRes.stdout.includes(secretToken), false);
      assert.deepEqual(JSON.parse(cliForceRes.stdout.trim()), { status: "refreshed" });
      assert.equal(serverRequests.length, 2);

      // runAntigravityHook은 session-start와 pre-invocation(invocationNum: 0)에서 ensureAntigravityDagMcp를 호출하고
      // hosts/antigravity/ 세션 파일과 훅 출력에는 영향을 주지 않는다.
      const hookHome = join(base, "hook-ensure-home");
      const hookEnv = {
        ...env,
        POTA_HOME: hookHome,
        ANTIGRAVITY_CSRF_TOKEN: secretToken,
        ANTIGRAVITY_LS_ADDRESS: `127.0.0.1:${address.port}`,
      };
      const stubRun = async () => ({
        status: 0,
        message: "",
        hookOutput: { hookSpecificOutput: { additionalContext: "capsule" } },
      });

      const hookStart = await runAntigravityHook(
        "session-start",
        { conversationId: "conv-recover", workspacePaths: [repo] },
        { env: hookEnv, now: new Date("2026-11-24T02:00:00.000Z"), run: stubRun },
      );
      assert.deepEqual(hookStart, { injectSteps: [{ systemMessage: { systemMessage: "capsule" } }] });
      assert.equal(serverRequests.length, 3);
      assert.equal(existsSync(join(hookHome, "hosts", "antigravity")), false);

      // 30초 경과 후 pre-invocation(invocationNum: 0)에서 다시 복구 호출이 수행된다.
      const hookPre = await runAntigravityHook(
        "pre-invocation",
        { conversationId: "conv-recover", workspacePaths: [repo], invocationNum: 0, lastUserInput: "Go" },
        { env: hookEnv, now: new Date("2026-11-24T02:01:00.000Z"), run: stubRun },
      );
      assert.deepEqual(hookPre, { injectSteps: [{ systemMessage: { systemMessage: "capsule" } }] });
      assert.equal(serverRequests.length, 4);
      assert.equal(existsSync(join(hookHome, "hosts", "antigravity")), false);

      // stdio MCP 서버 기동/종료 시 server.json PID 기록 및 정리를 검증한다.
      const mcpClient = spawnMcpClient(hookEnv, { cwd: pluginRoot });
      try {
        mcpClient.send({ jsonrpc: "2.0", id: 1, method: "ping" });
        const ping = await mcpClient.nextResponse();
        assert.equal(ping.id, 1);
        const liveState = await readDagMcpServerState({ env: hookEnv });
        assert.equal(typeof liveState.pid, "number");
        assert.ok(liveState.pid > 0);
        const exit = await mcpClient.close();
        assert.equal(exit.code, 0);
        assert.equal(exit.stderr, "");
        const closedState = await readDagMcpServerState({ env: hookEnv });
        assert.equal(closedState.pid, null);
      } finally {
        await mcpClient.dispose();
      }
    } finally {
      await new Promise((resolveClose) => testServer.close(resolveClose));
    }
  });
});

test("7. OpenAI Apps SDK _meta 및 리소스/툴 듀얼 메타데이터 계약 검증", async () => {
  await withWorkspace(async ({ env }) => {
    const server = createDagMcpServer({ env });

    const listedTools = await server.handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    assert.equal(listedTools.error, undefined);
    const openTool = listedTools.result.tools.find((item) => item.name === "open_pota_dag");
    const stateTool = listedTools.result.tools.find((item) => item.name === "pota_dag_state");
    assert.ok(openTool);
    assert.ok(stateTool);

    // open_pota_dag: Antigravity(SEP-1865) + OpenAI Apps SDK 공개 위젯 메타데이터 병존 검증
    assert.equal(openTool._meta.ui.resourceUri, DAG_APP_RESOURCE_URI);
    assert.deepEqual(openTool._meta.ui.visibility, ["model", "app"]);
    assert.deepEqual(openTool._meta["com.google.antigravity/ui"].entrypoints, [
      { type: "aux_pane", title: "Pota DAG" },
      { type: "global", title: "Pota DAG" },
    ]);
    assert.equal(openTool._meta["openai/outputTemplate"], DAG_APP_RESOURCE_URI);
    assert.equal(openTool._meta["openai/resultCanProduceWidget"], true);
    assert.equal(openTool._meta["openai/widgetAccessible"], true);
    assert.equal(openTool._meta["openai/visibility"], "public");
    assert.deepEqual(openTool._meta["openai/ui"], { availableDisplayModes: ["inline", "fullscreen"] });
    assert.equal(openTool._meta["openai/widgetPrefersBorder"], false);
    assert.equal(typeof openTool._meta["openai/widgetDescription"], "string");
    assert.ok(openTool._meta["openai/widgetDescription"].length > 0);

    // pota_dag_state: 비공개 위젯 전용 상태 폴링 메타데이터 검증
    assert.deepEqual(stateTool._meta.ui.visibility, ["app"]);
    assert.equal(stateTool._meta["openai/visibility"], "private");
    assert.equal(stateTool._meta["openai/widgetAccessible"], true);
    assert.equal(stateTool._meta["openai/resultCanProduceWidget"], false);

    // resources/list 및 resources/read의 DAG_RESOURCE_META 계약 검증
    const listedResources = await server.handleMessage({ jsonrpc: "2.0", id: 2, method: "resources/list" });
    assert.equal(listedResources.error, undefined);
    assert.equal(listedResources.result.resources.length, 1);
    const resDescriptor = listedResources.result.resources[0];
    assert.equal(resDescriptor.uri, DAG_APP_RESOURCE_URI);
    assert.equal(resDescriptor.mimeType, DAG_APP_MIME_TYPE);

    const readResource = await server.handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "resources/read",
      params: { uri: DAG_APP_RESOURCE_URI },
    });
    assert.equal(readResource.error, undefined);
    assert.equal(readResource.result.contents.length, 1);
    const contentMeta = readResource.result.contents[0]._meta;

    for (const meta of [resDescriptor._meta, contentMeta]) {
      assert.equal(meta.ui.prefersBorder, false);
      assert.deepEqual(meta.ui.csp, { connectDomains: [], resourceDomains: [] });
      assert.deepEqual(meta["openai/ui"], { availableDisplayModes: ["inline", "fullscreen"] });
      assert.equal(meta["openai/widgetPrefersBorder"], false);
      assert.equal(meta["openai/widgetDescription"], openTool._meta["openai/widgetDescription"]);
      assert.deepEqual(meta["openai/widgetCSP"], { connect_domains: [], resource_domains: [] });
    }
  });
});

test("8. 듀얼 호스트 window.openai / SEP-1865 HTML 클라이언트 브리지 및 CSP/XSS 방어 검증", async () => {
  await withWorkspace(async ({ repo, env }) => {
    await mkdir(join(repo, "docs", "plan"), { recursive: true });
    await mkdir(join(repo, "src"), { recursive: true });
    await writeFile(join(repo, "docs", "plan", "bridge.md"), "# Bridge Plan\n", "utf8");
    await writeFile(join(repo, "src", "widget.mjs"), "export const dual = true;\n", "utf8");

    await startGoal({
      root: repo,
      goal: "Dual Bridge Goal",
      planId: "docs/plan/bridge.md",
      evidencePolicy: "declared",
      tasks: [
        { id: "t1", title: "DoneStep", requiredEvidence: ["moduleAcceptance"] },
        {
          id: "t2",
          title: "ActiveStep",
          dependsOn: ["t1"],
          requiredEvidence: ["moduleAcceptance"],
          writeScope: ["src/widget.mjs"],
        },
      ],
    });
    await recordReceipt({ root: repo, taskId: "t1", kind: "moduleAcceptance", command: "test t1", exitCode: 0 });
    await setTaskStatus({ root: repo, taskId: "t1", status: "completed", mainModelGate: false });

    const server = createDagMcpServer({ env, now: () => 1_700_000_040_000 });
    const openEnRes = await server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "open_pota_dag", arguments: { root: repo, locale: "en" } },
    });
    const stateEnRes = await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "pota_dag_state", arguments: { root: repo, locale: "en" } },
    });
    const stateKoRes = await server.handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "pota_dag_state", arguments: { root: repo, locale: "ko" } },
    });
    // open_pota_dag는 모델에 보이는 슬림 요약만 돌려주고, 전체 UI 상태는 앱 전용 pota_dag_state로 수화한다.
    const enPayload = openEnRes.result.structuredContent;
    const enStatePayload = stateEnRes.result.structuredContent;
    const koStatePayload = stateKoRes.result.structuredContent;
    assert.equal(enPayload.kind, "pota-dag-open");
    assert.equal(enPayload.root, repo);
    assert.equal(enPayload.sections, undefined);
    assert.ok(enStatePayload.goal.planFileUri?.startsWith("file://"));
    assert.ok(enStatePayload.sections.running[0].files[0].uri?.startsWith("file://"));

    const html = renderDagAppHtml({ title: "Pota DAG", version: "2.3.0" });

    // 8-0. HTML에 외부 네트워크·스크립트 주입·동적 HTML 삽입 금지 규칙이 유지되는지 확인한다.
    assert.doesNotMatch(html, /<script[^>]*\bsrc\s*=/i);
    assert.doesNotMatch(html, /<link[^>]*\bhref\s*=/i);
    assert.doesNotMatch(html, /\bfetch\s*\(/);
    assert.doesNotMatch(html, /\bnew\s+WebSocket\b/);
    assert.doesNotMatch(html, /https?:\/\//i);
    assert.doesNotMatch(html, /\.innerHTML\b|insertAdjacentHTML|outerHTML|document\.write/);

    // 8-1. 순수 window.openai 호스트: 슬림 toolOutput 즉시 pota_dag_state 수화, 정적 파일 칩, 전체화면 버튼, notifyIntrinsicHeight, ui/initialize 무응답 무오류
    {
      const callToolCalls = [];
      const intrinsicHeights = [];
      const modeRequests = [];
      const app = mountDagHtmlApp({
        html,
        hasDistinctParent: true,
        openai: {
          theme: "light",
          locale: "en-US",
          displayMode: "inline",
          toolOutput: enPayload,
          callTool: async (name, args) => {
            callToolCalls.push({ name, args });
            return { structuredContent: enStatePayload };
          },
          requestDisplayMode: async (req) => {
            modeRequests.push({ mode: req.mode });
            return { mode: req.mode };
          },
          notifyIntrinsicHeight: (height) => {
            intrinsicHeights.push(height);
          },
        },
      });

      // 슬림 toolOutput을 받으면 지연 없이 그 root로 pota_dag_state를 한 번 호출해 제목과 SVG를 렌더링해야 한다.
      await app.flushMicrotasks();
      assert.equal(callToolCalls.length, 1);
      assert.equal(callToolCalls[0].name, "pota_dag_state");
      assert.equal(callToolCalls[0].args.root, repo);
      assert.equal(callToolCalls[0].args.locale, "en");
      assert.ok(app.headerEl.textContent.includes("Dual Bridge Goal"));
      assert.equal(app.svgWrapEl.hidden, false);
      assert.equal(app.svgWrapEl.children.length, 1);
      assert.equal(app.svgWrapEl.children[0].localName, "svg");
      assert.ok(app.findByTag("svg", app.svgWrapEl).length >= 1);

      // 순수 window.openai 모드에서는 planId 배지가 버튼이 아닌 정적 span이어야 한다.
      assert.equal(app.findByClass("dag-plan-btn", app.headerEl).length, 0);
      const staticPlan = app.findByClass("dag-plan-static", app.headerEl);
      assert.equal(staticPlan.length, 1);
      staticPlan[0].click();

      // 실행 중 task를 펼치면 파일 칩도 정적 span으로 렌더링되고 toggle-aux-pane을 호출하지 않는다.
      const taskToggles = app.findByClass("dag-task-toggle", app.sectionsEl);
      assert.equal(taskToggles.length, 1);
      taskToggles[0].click();
      const fileChips = app.findByClass("dag-file-chip", app.sectionsEl);
      assert.equal(fileChips.length, 1);
      assert.equal(fileChips[0].localName, "span");
      fileChips[0].click();

      // requestDisplayMode 존재 시 전체화면 토글 버튼이 노출되어야 한다.
      const fsBtns = app.findByClass("dag-fullscreen-btn", app.toolbarEl);
      assert.equal(fsBtns.length, 1);
      assert.equal(fsBtns[0].hidden, false);

      // rAF 플러시 시 notifyIntrinsicHeight가 호출되어야 한다.
      app.flushAnimationFrames();
      assert.ok(intrinsicHeights.length >= 1);
      assert.ok(intrinsicHeights[0] > 0 && intrinsicHeights[0] <= 800);

      // 부모가 ui/initialize 프로브에 응답하지 않고 2000ms 타임아웃을 지나도 에러 배너가 없어야 한다.
      assert.ok(app.postedMessages.some((msg) => msg.method === "ui/initialize"));
      await app.advanceTime(2500);
      assert.equal(callToolCalls.length, 1);
      assert.equal(app.footerEl.children.length, 0);
      assert.equal(app.toastEl.hidden, true);
      assert.equal(
        app.postedMessages.some((msg) => msg.method === "com.google.antigravity/toggle-aux-pane"),
        false,
      );

      // 8-3a. 전체화면 토글 왕복: fullscreen -> inline
      fsBtns[0].click();
      await app.flushMicrotasks();
      assert.deepEqual(modeRequests, [{ mode: "fullscreen" }]);
      assert.equal(fsBtns[0].getAttribute("aria-pressed"), "true");
      assert.equal(fsBtns[0].classList.contains("is-active"), true);

      fsBtns[0].click();
      await app.flushMicrotasks();
      app.flushAnimationFrames();
      assert.deepEqual(modeRequests, [{ mode: "fullscreen" }, { mode: "inline" }]);
      assert.equal(fsBtns[0].getAttribute("aria-pressed"), "false");
      assert.equal(fsBtns[0].classList.contains("is-active"), false);
      assert.ok(intrinsicHeights.length >= 2);
    }

    // 8-2. toolOutput: null 자가 수화, 3종 반환 형식 정규화, openai:set_globals 반응, 비신뢰 payload 방어
    {
      const callToolCalls = [];
      const directPayload = {
        ...enStatePayload,
        view: "current",
        goal: { ...enStatePayload.goal, title: "Direct Format Goal" },
      };
      const wrappedJsonPayload = {
        ...enStatePayload,
        view: "all",
        goal: { ...enStatePayload.goal, title: "JSON Wrapped Goal" },
      };
      const rawJsonPayload = {
        ...enStatePayload,
        goal: { ...enStatePayload.goal, title: "Raw JSON Goal" },
      };
      const scriptedResponses = [
        { content: [{ type: "text", text: "ok" }], structuredContent: enStatePayload },
        directPayload,
        JSON.stringify({ structuredContent: wrappedJsonPayload }),
        JSON.stringify(rawJsonPayload),
      ];
      const openaiBridge = {
        theme: "light",
        locale: "en-US",
        displayMode: "inline",
        toolOutput: null,
        callTool: async (name, args) => {
          callToolCalls.push({ name, args });
          return scriptedResponses[callToolCalls.length - 1] ?? { structuredContent: enStatePayload };
        },
        requestDisplayMode: async (req) => ({ mode: req.mode }),
        notifyIntrinsicHeight: () => {},
      };
      const app = mountDagHtmlApp({ html, hasDistinctParent: false, openai: openaiBridge });

      // toolOutput: null일 때는 로딩 상태에서 시작해 150ms 뒤 pota_dag_state로 자가 수화한다.
      assert.ok(app.headerEl.textContent.includes("Reading the Pota goal"));
      assert.equal(callToolCalls.length, 0);

      await app.advanceTime(200);
      assert.equal(callToolCalls.length, 1);
      assert.equal(callToolCalls[0].name, "pota_dag_state");
      assert.equal(callToolCalls[0].args.view, "all");
      assert.ok(app.headerEl.textContent.includes("Dual Bridge Goal"));
      assert.equal(app.footerEl.children.length, 0);

      // 직접 payload / JSON 문자열 래퍼 / raw JSON 문자열 반환 형식이 각각 DOM에 반영되는지 검증한다.
      const viewBtns = app.findByClass("dag-btn", app.toolbarEl);
      const currentBtn = viewBtns.find((btn) => btn.dataset.view === "current");
      const allBtn = viewBtns.find((btn) => btn.dataset.view === "all");
      const refreshBtn = app.findByClass("dag-refresh-btn", app.toolbarEl)[0];
      assert.ok(currentBtn && allBtn && refreshBtn);

      currentBtn.click();
      await app.flushMicrotasks();
      assert.equal(callToolCalls.length, 2);
      assert.equal(callToolCalls[1].args.view, "current");
      assert.equal(app.findByClass("dag-title", app.headerEl)[0].textContent, "Direct Format Goal");
      assert.equal(app.footerEl.children.length, 0);

      allBtn.click();
      await app.flushMicrotasks();
      assert.equal(callToolCalls.length, 3);
      assert.equal(callToolCalls[2].args.view, "all");
      assert.equal(app.findByClass("dag-title", app.headerEl)[0].textContent, "JSON Wrapped Goal");
      assert.equal(app.footerEl.children.length, 0);

      refreshBtn.click();
      await app.flushMicrotasks();
      assert.equal(callToolCalls.length, 4);
      assert.equal(callToolCalls[3].args.forceEpoch, true);
      assert.equal(app.findByClass("dag-title", app.headerEl)[0].textContent, "Raw JSON Goal");
      assert.equal(app.footerEl.children.length, 0);

      // openai:set_globals 이벤트로 theme/locale/displayMode/toolOutput 동적 반영 및 XSS/URI 방어를 검증한다.
      const koUpdated = {
        ...koStatePayload,
        goal: {
          ...koStatePayload.goal,
          title: 'Updated <script>alert(1)</script> Goal',
          planFileUri: "javascript:alert(1)",
        },
      };
      app.dispatchWindowEvent("openai:set_globals", {
        detail: {
          globals: {
            theme: "dark",
            locale: "ko-KR",
            displayMode: "fullscreen",
            toolOutput: koUpdated,
          },
        },
      });
      await app.flushMicrotasks();

      assert.equal(app.document.documentElement.dataset.theme, "dark");
      assert.equal(app.document.documentElement.style.colorScheme, "dark");
      assert.equal(app.document.documentElement.lang, "ko");
      assert.equal(app.findByClass("dag-title", app.headerEl)[0].textContent, 'Updated <script>alert(1)</script> Goal');
      assert.equal(app.findByClass("dag-plan-btn", app.headerEl).length, 0);
      assert.deepEqual(
        app.findByClass("dag-btn", app.toolbarEl)
          .filter((btn) => Boolean(btn.dataset.view))
          .map((btn) => btn.textContent),
        ["이전", "현재", "다음", "전체"],
      );
      const fsBtn = app.findByClass("dag-fullscreen-btn", app.toolbarEl)[0];
      assert.equal(fsBtn.textContent, "인라인 보기");
      assert.equal(fsBtn.getAttribute("aria-pressed"), "true");
      assert.equal(fsBtn.classList.contains("is-active"), true);

      // light / en / inline 복귀 및 JSON 문자열 toolOutput 갱신을 검증한다.
      app.dispatchWindowEvent("openai:set_globals", {
        detail: {
          globals: {
            theme: "light",
            locale: "en-US",
            displayMode: "inline",
            toolOutput: JSON.stringify({ structuredContent: enStatePayload }),
          },
        },
      });
      await app.flushMicrotasks();
      assert.equal(app.document.documentElement.dataset.theme, "light");
      assert.equal(app.document.documentElement.style.colorScheme, "light");
      assert.equal(app.document.documentElement.lang, "en");
      assert.equal(app.findByClass("dag-title", app.headerEl)[0].textContent, "Dual Bridge Goal");
      assert.equal(fsBtn.textContent, "Fullscreen");
      assert.equal(fsBtn.getAttribute("aria-pressed"), "false");
      assert.equal(fsBtn.classList.contains("is-active"), false);
    }

    // 8-3b. 순수 SEP-1865(Antigravity) 호스트: window.openai·availableDisplayModes 없으면 전체화면 버튼 숨김 유지
    {
      const app = mountDagHtmlApp({ html, hasDistinctParent: true, openai: undefined });
      const fsBtn = app.findByClass("dag-fullscreen-btn", app.toolbarEl)[0];
      assert.equal(fsBtn.hidden, true);

      const initReq = app.postedMessages.find((msg) => msg.method === "ui/initialize");
      assert.ok(initReq);
      app.dispatchHostMessage({
        jsonrpc: "2.0",
        id: initReq.id,
        result: {
          protocolVersion: "2026-01-26",
          hostCapabilities: {},
          hostContext: {
            theme: "light",
            locale: "en",
            displayMode: "inline",
            containerDimensions: { maxHeight: 720 },
          },
        },
      });
      await app.flushMicrotasks();

      assert.ok(app.postedMessages.some((msg) => msg.method === "ui/notifications/initialized"));
      assert.equal(fsBtn.hidden, true);

      app.dispatchHostMessage({
        jsonrpc: "2.0",
        method: "ui/notifications/tool-result",
        params: { structuredContent: enPayload },
      });
      await app.flushMicrotasks();

      // 슬림 tool-result는 SEP-1865 tools/call pota_dag_state로 전체 상태를 받아 렌더링한다.
      const hydrateReq = app.postedMessages.find((msg) => msg.method === "tools/call" && msg.params.name === "pota_dag_state");
      assert.ok(hydrateReq);
      assert.equal(hydrateReq.params.arguments.root, repo);
      app.dispatchHostMessage({ jsonrpc: "2.0", id: hydrateReq.id, result: { structuredContent: enStatePayload } });
      await app.flushMicrotasks();

      const planButtons = app.findByClass("dag-plan-btn", app.headerEl);
      assert.equal(planButtons.length, 1);
      planButtons[0].click();
      const auxMsg = app.postedMessages.find((msg) => msg.method === "com.google.antigravity/toggle-aux-pane");
      assert.ok(auxMsg);
      assert.equal(auxMsg.params.uri, enStatePayload.goal.planFileUri);
    }
  });
});

test("9. Codex 훅(scripts/pota-state.mjs) 활성 워크스페이스 레지스트리 기록 및 호스트 격리 검증", async () => {
  await withWorkspace(async ({ base, repo, env }) => {
    const t0 = new Date("2026-11-24T03:00:00.000Z");
    const t1 = new Date("2026-11-24T03:01:00.000Z");

    // 9-1. Codex session-start 및 user-prompt-submit가 명시 payload.cwd를 workspaces.json에 기록한다.
    const codexEnv = { ...env, POTA_LEGACY_MIGRATION: "0" };
    const repoGoal = await initTempRepo(join(base, "codex-goal-repo"));
    await startGoal({
      root: repoGoal,
      goal: "Codex Workspace Goal",
      planId: "docs/plan/codex-ws.md",
      evidencePolicy: "declared",
      tasks: [{ id: "t1", title: "Codex Task", requiredEvidence: ["moduleAcceptance"] }],
    });

    const startRes = await runStateResult("session-start", {
      host: "codex",
      payload: { cwd: repo, session_id: "codex-sess-1" },
      migration: { env: codexEnv, now: t0 },
    });
    assert.equal(startRes.status, 0);
    assert.equal(existsSync(workspaceRegistryPath(codexEnv)), true);

    const regAfterStart = await readWorkspaceRegistry({ env: codexEnv, now: t0 });
    assert.equal(regAfterStart.workspaces.length, 1);
    assert.equal(regAfterStart.workspaces[0].root, repo);
    assert.equal(regAfterStart.workspaces[0].conversationId, "codex-sess-1");

    const promptRes = await runStateResult("user-prompt-submit", {
      host: "codex",
      payload: { cwd: repoGoal, session_id: "codex-sess-2" },
      migration: { env: codexEnv, now: t1 },
    });
    assert.equal(promptRes.status, 0);

    const regAfterPrompt = await readWorkspaceRegistry({ env: codexEnv, now: t1 });
    assert.deepEqual(regAfterPrompt.workspaces.map((item) => item.root), [repoGoal, repo]);

    // pota-dag-mcp-core.mjs의 open_pota_dag {}가 기록된 워크스페이스를 읽어야 한다.
    const server = createDagMcpServer({ env: codexEnv, now: () => t1.getTime() });
    const openRes = await server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "open_pota_dag", arguments: {} },
    });
    assert.equal(openRes.error, undefined);
    assert.equal(openRes.result.structuredContent.root, repoGoal);
    assert.equal(openRes.result.structuredContent.goal.title, "Codex Workspace Goal");
    assert.equal(existsSync(join(codexEnv.POTA_HOME, "hosts", "antigravity")), false);

    // 9-2. root와 payload.cwd가 모두 없으면 플러그인 루트 / process.cwd()를 기록하지 않는다.
    const noCwdHome = join(base, "codex-nocwd-home");
    const noCwdEnv = { ...env, POTA_HOME: noCwdHome, POTA_LEGACY_MIGRATION: "0" };
    await runStateResult("session-start", {
      host: "codex",
      payload: { session_id: "codex-nocwd" },
      migration: { env: noCwdEnv, now: t0 },
    });
    await runStateResult("user-prompt-submit", {
      host: "codex",
      payload: { session_id: "codex-nocwd" },
      migration: { env: noCwdEnv, now: t1 },
    });
    assert.equal(existsSync(workspaceRegistryPath(noCwdEnv)), false);
    const noCwdOpen = await createDagMcpServer({ env: noCwdEnv, now: () => t1.getTime() }).handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "open_pota_dag", arguments: {} },
    });
    assert.equal(noCwdOpen.result.structuredContent.root, null);

    // 9-3. host === "claude"는 workspaces.json에 기록하지 않는다.
    const claudeHome = join(base, "claude-isolated-home");
    const claudeEnv = { ...env, POTA_HOME: claudeHome, POTA_LEGACY_MIGRATION: "0" };
    await runStateResult("session-start", {
      host: "claude",
      payload: { cwd: repoGoal, session_id: "claude-sess-1" },
      migration: { env: claudeEnv, now: t0 },
    });
    await runStateResult("user-prompt-submit", {
      host: "claude",
      payload: { cwd: repoGoal, session_id: "claude-sess-1" },
      migration: { env: claudeEnv, now: t1 },
    });
    assert.equal(existsSync(workspaceRegistryPath(claudeEnv)), false);
  });
});

test("10. pota-dag-mcp.mjs --host codex 격리 실행 및 Antigravity server.json 보호 검증", async () => {
  await withWorkspace(async ({ base, env }) => {
    assert.equal(parseHostArg(["--host", "codex"]), "codex");
    assert.equal(parseHostArg(["--host=codex"]), "codex");
    assert.equal(parseHostArg(["--host"]), null);
    assert.equal(parseHostArg([]), null);

    // 10-1. 격리된 POTA_HOME에서 --host codex 실행 시 server.json을 생성하지 않고 정상 종료한다.
    const codexHome = join(base, "codex-mcp-isolated");
    const codexEnv = { ...env, POTA_HOME: codexHome };
    const client = spawnMcpClient(codexEnv, { cwd: pluginRoot, args: ["--host", "codex"] });
    try {
      client.send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25", capabilities: {} },
      });
      const init = await client.nextResponse();
      assert.equal(init.id, 1);
      assert.equal(init.result.protocolVersion, "2025-11-25");
      assert.equal(init.result.serverInfo.name, "pota-dag");
      assert.equal(existsSync(dagMcpServerStatePath(codexEnv)), false);

      const exit = await client.close();
      assert.equal(exit.code, 0);
      assert.equal(exit.stderr, "");
      assert.equal(existsSync(dagMcpServerStatePath(codexEnv)), false);
    } finally {
      await client.dispose();
    }

    // 10-2. Antigravity와 같은 POTA_HOME에서 동시 실행돼도 기존 server.json PID를 덮어쓰거나 지우지 않는다.
    const sharedHome = join(base, "shared-mcp-home");
    const sharedEnv = { ...env, POTA_HOME: sharedHome };
    const t0 = new Date("2026-11-24T04:00:00.000Z");
    await recordDagMcpServerPid({ pid: 424242, env: sharedEnv, now: t0 });

    const sharedClient = spawnMcpClient(sharedEnv, { cwd: pluginRoot, args: ["--host=codex"] });
    try {
      sharedClient.send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25", capabilities: {} },
      });
      const init = await sharedClient.nextResponse();
      assert.equal(init.id, 1);
      assert.equal((await readDagMcpServerState({ env: sharedEnv })).pid, 424242);

      const exit = await sharedClient.close();
      assert.equal(exit.code, 0);
      assert.equal(exit.stderr, "");
      const afterExit = await readDagMcpServerState({ env: sharedEnv });
      assert.equal(afterExit.pid, 424242);
      assert.equal(afterExit.startedAt, t0.toISOString());
    } finally {
      await sharedClient.dispose();
    }
  });
});

test("11. pota_dag_action HITL 도구 계약, pause/resume·toggle_gate 왕복 및 S2 상태 payload 필드", async () => {
  await withWorkspace(async ({ repo, env }) => {
    await seedS2Workspace(repo);
    // pota_dag_action은 등록된 워크스페이스에만 동작하므로 훅과 같은 경로로 repo를 레지스트리에 기록한다.
    await recordActiveWorkspace({ workspacePath: repo, conversationId: "conv-s2-action", env });
    const server = createDagMcpServer({ env, now: () => 1_700_000_040_000 });
    let rpcId = 0;
    const call = (name, args) => server.handleMessage({
      jsonrpc: "2.0",
      id: ++rpcId,
      method: "tools/call",
      params: { name, arguments: args },
    });

    // 11-1. tools/list 3종과 pota_dag_action의 app 전용·비공개 메타데이터
    const listed = await server.handleMessage({ jsonrpc: "2.0", id: 0, method: "tools/list" });
    assert.deepEqual(listed.result.tools.map((tool) => tool.name), ["open_pota_dag", "pota_dag_state", "pota_dag_action"]);
    const actionTool = listed.result.tools.find((tool) => tool.name === "pota_dag_action");
    assert.deepEqual(actionTool._meta.ui.visibility, ["app"]);
    assert.equal(actionTool._meta["openai/visibility"], "private");
    assert.equal(actionTool._meta["openai/widgetAccessible"], true);
    assert.deepEqual(actionTool.inputSchema.required, ["action"]);
    assert.deepEqual(actionTool.inputSchema.properties.action.enum, ["pause", "resume", "toggle_gate"]);
    assert.equal(actionTool.inputSchema.properties.taskId.type, "string");
    assert.equal(actionTool.inputSchema.properties.enabled.type, "boolean");
    assert.equal(actionTool.inputSchema.additionalProperties, false);
    assert.match(actionTool.description, /enabled/);
    assert.equal(actionTool.annotations.readOnlyHint, false);

    // 11-2. UI가 쓰는 상태 payload 필드: approvalGate, receipts, writeScopeDiff, gitDiff, planOverview, agentStats, 트랜스크립트 부재
    const payload = (await call("pota_dag_state", { root: repo, locale: "en" })).result.structuredContent;
    const t1 = payload.tasks.find((task) => task.id === "t1");
    const t2 = payload.tasks.find((task) => task.id === "t2");
    assert.equal(t1.status, "active");
    assert.equal(t1.approvalGate, false);
    assert.equal(t2.approvalGate, false);
    assert.equal(t1.assignedAgentId, "main");
    assert.equal(t1.transcript, null);
    assert.equal(t1.resolvedModel, null);
    assert.equal(t1.receipts.length, 1);
    assert.equal(t1.receipts[0].kind, "moduleAcceptance");
    assert.equal(t1.receipts[0].command, "npm test -- s2");
    assert.equal(t1.receipts[0].exitCode, 0);
    assert.deepEqual(t2.receipts, []);
    assert.equal(t2.writeScopeDiff.available, true);
    assert.deepEqual(t2.writeScopeDiff.files.map((file) => [file.path, file.added, file.deleted]), [["src/s2.mjs", 1, 0]]);
    assert.ok(t2.writeScopeDiff.files[0].uri.startsWith("file://"));
    assert.equal(payload.gitDiff.available, true);
    const envDiff = payload.gitDiff.files.find((file) => file.path === ".env");
    assert.equal(envDiff.sensitive, true);
    assert.equal(envDiff.uri, null);
    const srcDiff = payload.gitDiff.files.find((file) => file.path === "src/s2.mjs");
    assert.equal(srcDiff.sensitive, false);
    assert.ok(srcDiff.uri.startsWith("file://"));
    assert.equal(payload.planOverview.title, "S2 Plan");
    assert.equal(payload.planOverview.goalSummary, "Ship the S2 dashboard.");
    assert.equal(payload.planOverview.currentRequest, "add the inspector");
    assert.equal(payload.planOverview.checklist.done, 1);
    assert.equal(payload.planOverview.checklist.total, 2);
    assert.equal(payload.agentStats.totalTasks, 2);
    assert.equal(payload.agentStats.doneTasks, 0);
    assert.equal(payload.agentStats.enrichedAgents, 0);
    assert.equal(payload.agentStats.totalInputTokens, 0);
    assert.ok(payload.svg.source.includes('data-task-id="t2"'));

    // 11-3. pause → resume 왕복: 결과에 갱신된 DAG 상태가 실리고 state.json도 전이된다.
    const paused = await call("pota_dag_action", { action: "pause", root: repo, locale: "en" });
    assert.equal(paused.error, undefined);
    assert.notEqual(paused.result.isError, true);
    assert.equal(paused.result.structuredContent.goal.status, "paused");
    assert.equal((await readGoalState({ root: repo })).goal.status, "paused");
    const resumed = await call("pota_dag_action", { action: "resume", root: repo, locale: "en" });
    assert.notEqual(resumed.result.isError, true);
    assert.equal(resumed.result.structuredContent.goal.status, "active");
    assert.equal((await readGoalState({ root: repo })).goal.status, "active");
    assert.equal((await readGoalState({ root: repo })).tasks.find((task) => task.id === "t1").status, "active");

    // 11-4. toggle_gate는 원하는 값(enabled)을 명시해 on/off 왕복한다.
    const gatedOn = await call("pota_dag_action", { action: "toggle_gate", taskId: "t2", enabled: true, root: repo, locale: "en" });
    assert.notEqual(gatedOn.result.isError, true);
    assert.equal(gatedOn.result.structuredContent.tasks.find((task) => task.id === "t2").approvalGate, true);
    assert.equal((await readGoalState({ root: repo })).tasks.find((task) => task.id === "t2").approvalGate, true);
    const gatedOff = await call("pota_dag_action", { action: "toggle_gate", taskId: "t2", enabled: false, root: repo, locale: "en" });
    assert.notEqual(gatedOff.result.isError, true);
    assert.equal(gatedOff.result.structuredContent.tasks.find((task) => task.id === "t2").approvalGate, false);
    assert.equal((await readGoalState({ root: repo })).tasks.find((task) => task.id === "t2").approvalGate, false);

    // 11-5. 잘못된 action·taskId 누락/미지·enabled 누락/비불리언·실행 중 task 게이트 설정·여분 인자·잘못된 root는
    // 크래시 없이 도구 오류로 반환한다. enabled 없는 toggle_gate(맹목 반전)는 오래된 UI 상태로 게이트를 풀 수 있어 거부한다.
    for (const args of [
      { action: "toggle_gate", root: repo },
      { action: "toggle_gate", taskId: "   ", enabled: true, root: repo },
      { action: "toggle_gate", taskId: "missing-task", enabled: true, root: repo },
      { action: "toggle_gate", taskId: "t1", enabled: true, root: repo },
      { action: "toggle_gate", taskId: "t2", root: repo },
      { action: "toggle_gate", taskId: "t2", enabled: "true", root: repo },
      { action: "toggle_gate", taskId: "t2", enabled: null, root: repo },
      { action: "pause", enabled: true, root: repo },
      { action: "delete", root: repo },
      { action: 7, root: repo },
      { root: repo },
      { action: "pause", root: repo, extra: true },
      { action: "pause", root: join(repo, "does-not-exist") },
    ]) {
      const res = await call("pota_dag_action", args);
      assert.equal(res.error, undefined, JSON.stringify(args));
      assert.equal(res.result.isError, true, JSON.stringify(args));
      assert.equal(res.result.structuredContent, undefined, JSON.stringify(args));
      assert.ok(res.result.content[0].text.length > 0, JSON.stringify(args));
    }
    const finalState = await readGoalState({ root: repo });
    assert.equal(finalState.goal.status, "active");
    assert.equal(Boolean(finalState.tasks.find((task) => task.id === "t1").approvalGate), false);
    assert.equal(Boolean(finalState.tasks.find((task) => task.id === "t2").approvalGate), false);
  });
});

test("12. S2 클라이언트: 4탭·전 노드 인스펙터·게이트/일시정지 동작·듀얼 후속 요청 브리지·비-트랜스크립트 폴백", async () => {
  await withWorkspace(async ({ repo, env }) => {
    await seedS2Workspace(repo);
    await recordActiveWorkspace({ workspacePath: repo, conversationId: "conv-s2-client", env });
    const transcriptStub = async () => ({
      enrichedByTaskId: {
        t1: {
          resolvedModel: "gemini-3-pro",
          resolvedEffort: "high",
          resolvedTier: "stronger",
          turns: 4,
          tokens: { input: 1200, cacheRead: 800, output: 300, cacheHitRate: 0.4, truncated: false },
          updatedAt: "2026-11-24T03:00:00.000Z",
        },
      },
      agentStats: { enrichedAgents: 1, totalTurns: 4, totalInputTokens: 1200, totalCacheReadTokens: 800, totalOutputTokens: 300 },
    });
    const enrichedServer = createDagMcpServer({ env, now: () => 1_700_000_040_000, transcriptEnricher: transcriptStub });
    const plainServer = createDagMcpServer({ env, now: () => 1_700_000_040_000 });
    let rpcId = 100;
    const callServer = async (server, name, args) => (await server.handleMessage({
      jsonrpc: "2.0",
      id: ++rpcId,
      method: "tools/call",
      params: { name, arguments: args },
    })).result;
    const html = renderDagAppHtml({ title: "Pota DAG", version: "2.3.0" });
    const enrichedPayload = (await callServer(enrichedServer, "pota_dag_state", { root: repo, locale: "en" })).structuredContent;
    assert.equal(enrichedPayload.tasks.find((task) => task.id === "t1").transcript.turns, 4);

    const clickCard = (app, taskId) => {
      const card = app.findByClass("card", app.svgWrapEl).find((node) => node.getAttribute("data-task-id") === taskId);
      assert.ok(card, `card ${taskId} should be rendered`);
      const inner = app.findByTag("rect", card)[0];
      assert.ok(inner);
      // 실제 브라우저처럼 카드 하위 노드를 target으로 SVG 래퍼에 위임 클릭을 전달한다.
      app.svgWrapEl.dispatchEvent({ type: "click", target: inner });
      return card;
    };

    // 12-1. ChatGPT(window.openai): 탭 전환, 비실행 task 인스펙터, 게이트·일시정지 실서버 왕복, sendFollowUpMessage
    {
      const toolCalls = [];
      const followUps = [];
      const app = mountDagHtmlApp({
        html,
        hasDistinctParent: false,
        openai: {
          theme: "light",
          locale: "en-US",
          displayMode: "inline",
          toolOutput: enrichedPayload,
          callTool: async (name, args) => {
            toolCalls.push({ name, args });
            return callServer(enrichedServer, name, args);
          },
          sendFollowUpMessage: async (req) => {
            followUps.push(req);
          },
          notifyIntrinsicHeight: () => {},
        },
      });

      const tabsEl = app.findByClass("dag-tabs")[0];
      const inspectorEl = app.findByClass("dag-inspector")[0];
      const tabPanelEl = app.findByClass("dag-tab-panel")[0];
      assert.ok(tabsEl && inspectorEl && tabPanelEl);
      assert.equal(tabsEl.hidden, false);
      const tabBtns = app.findByClass("dag-tab-btn", tabsEl);
      assert.deepEqual(tabBtns.map((btn) => btn.dataset.tab), ["dag", "diff", "plan", "stats"]);
      assert.deepEqual(tabBtns.map((btn) => btn.textContent), ["DAG", "Diff", "Plan", "Agents & Stats"]);
      assert.equal(tabBtns[0].getAttribute("aria-selected"), "true");
      assert.equal(inspectorEl.hidden, true);
      assert.equal(tabPanelEl.hidden, true);
      assert.equal(app.findByClass("dag-task-select", tabsEl)[0].children.length, 3);

      // Diff 탭: 읽기 전용 파일 목록, 민감 파일은 is-sensitive 정적 칩
      tabBtns[1].click();
      assert.equal(tabBtns[1].getAttribute("aria-selected"), "true");
      assert.equal(tabPanelEl.hidden, false);
      assert.equal(app.svgWrapEl.hidden, true);
      assert.equal(app.sectionsEl.hidden, true);
      assert.equal(app.findByClass("dag-diff-row", tabPanelEl).length, 2);
      const diffChips = app.findByClass("dag-file-chip", tabPanelEl);
      const envChip = diffChips.find((chip) => chip.textContent === ".env");
      assert.equal(envChip.localName, "span");
      assert.equal(envChip.classList.contains("is-sensitive"), true);
      assert.equal(diffChips.find((chip) => chip.textContent === "src/s2.mjs").localName, "span");
      assert.ok(app.findByClass("dag-diff-add", tabPanelEl).some((node) => node.textContent === "+1"));

      // Plan 탭: 제목·목표·현재 요청·체크리스트
      tabBtns[2].click();
      assert.ok(tabPanelEl.textContent.includes("S2 Plan"));
      assert.ok(tabPanelEl.textContent.includes("Ship the S2 dashboard."));
      assert.ok(tabPanelEl.textContent.includes("add the inspector"));
      assert.ok(tabPanelEl.textContent.includes("Checklist 1/2"));
      const checks = app.findByClass("dag-plan-check", tabPanelEl);
      assert.equal(checks.length, 2);
      assert.equal(checks[0].classList.contains("is-done"), true);
      assert.equal(checks[1].classList.contains("is-done"), false);

      // 에이전트·통계 탭: task별 행과 토큰 롤업, 행 선택 시 인스펙터
      tabBtns[3].click();
      const rows = app.findByClass("dag-stats-row", tabPanelEl);
      assert.deepEqual(rows.map((row) => row.dataset.taskId), ["t1", "t2"]);
      assert.ok(tabPanelEl.textContent.includes("in 1.2k · cache 800 · out 300"));
      assert.ok(rows[0].textContent.includes("gemini-3-pro"));
      app.findByClass("dag-stats-task-btn", rows[1])[0].click();
      assert.equal(inspectorEl.hidden, false);
      assert.equal(app.findByClass("dag-inspector-title", inspectorEl)[0].textContent, "Second Step");
      assert.equal(
        app.findByClass("dag-stats-row", tabPanelEl).find((row) => row.dataset.taskId === "t2").classList.contains("is-selected"),
        true,
      );

      tabBtns[0].click();
      assert.equal(app.svgWrapEl.hidden, false);
      assert.equal(app.sectionsEl.hidden, false);
      assert.equal(tabPanelEl.hidden, true);
      app.findByClass("dag-inspector-close", inspectorEl)[0].click();
      assert.equal(inspectorEl.hidden, true);

      // 실행 중이 아닌(t2: 대기) 카드 클릭으로도 인스펙터가 열린다.
      const t2Card = clickCard(app, "t2");
      assert.equal(inspectorEl.hidden, false);
      assert.equal(app.findByClass("dag-inspector-title", inspectorEl)[0].textContent, "Second Step");
      assert.equal(t2Card.classList.contains("is-selected"), true);
      assert.ok(inspectorEl.textContent.includes("No receipts recorded."));
      assert.ok(app.findByClass("dag-scoped-diff", inspectorEl)[0].textContent.includes("src/s2.mjs"));

      // 게이트 토글: 화면에 보인 버튼 의미(enabled)를 명시한 pota_dag_action toggle_gate 호출과 응답 상태 재렌더링
      const gateBtn = app.findByClass("dag-gate-btn", inspectorEl)[0];
      assert.equal(gateBtn.textContent, "Enable gate");
      assert.equal(gateBtn.getAttribute("aria-pressed"), "false");
      gateBtn.click();
      await waitForCondition(() => app.findByClass("dag-gate-badge", inspectorEl).length === 1);
      assert.equal(toolCalls.at(-1).name, "pota_dag_action");
      assert.equal(toolCalls.at(-1).args.action, "toggle_gate");
      assert.equal(toolCalls.at(-1).args.taskId, "t2");
      assert.equal(toolCalls.at(-1).args.enabled, true);
      assert.equal(toolCalls.at(-1).args.root, repo);
      assert.equal((await readGoalState({ root: repo })).tasks.find((task) => task.id === "t2").approvalGate, true);
      const gateOffBtn = app.findByClass("dag-gate-btn", inspectorEl)[0];
      assert.equal(gateOffBtn.textContent, "Disable gate");
      assert.equal(gateOffBtn.getAttribute("aria-pressed"), "true");
      gateOffBtn.click();
      await waitForCondition(() => app.findByClass("dag-gate-badge", inspectorEl).length === 0);
      assert.equal(toolCalls.at(-1).args.enabled, false);
      assert.equal((await readGoalState({ root: repo })).tasks.find((task) => task.id === "t2").approvalGate, false);
      assert.equal(app.findByClass("dag-gate-btn", inspectorEl)[0].textContent, "Enable gate");

      // 후속 요청: window.openai.sendFollowUpMessage({ prompt })
      app.findByClass("dag-followup-btn", inspectorEl)[0].click();
      await app.flushMicrotasks();
      assert.equal(followUps.length, 1);
      assert.deepEqual(Object.keys(followUps[0]), ["prompt"]);
      assert.ok(followUps[0].prompt.includes("t2"));
      assert.ok(followUps[0].prompt.includes("Second Step"));
      assert.equal(app.toastEl.textContent, "Follow-up message sent.");

      // 실행 중 t1: 트랜스크립트 모델·토큰 표시, 활성 task에는 게이트 설정 버튼을 노출하지 않는다.
      clickCard(app, "t1");
      assert.equal(app.findByClass("dag-inspector-title", inspectorEl)[0].textContent, "First Step");
      assert.ok(inspectorEl.textContent.includes("gemini-3-pro"));
      assert.ok(inspectorEl.textContent.includes("in 1.2k · cache 800 · out 300 · 4 turns"));
      assert.ok(inspectorEl.textContent.includes("40%"));
      assert.ok(inspectorEl.textContent.includes("npm test -- s2"));
      assert.equal(app.findByClass("dag-gate-btn", inspectorEl).length, 0);

      // 헤더 [Pause] → [Resume] → [Pause]
      const pauseBtn = app.findByClass("dag-pause-btn", app.headerEl)[0];
      assert.equal(pauseBtn.textContent, "Pause");
      pauseBtn.click();
      await waitForCondition(() => app.findByClass("dag-pause-btn", app.headerEl)[0]?.textContent === "Resume");
      assert.equal(toolCalls.at(-1).name, "pota_dag_action");
      assert.equal(toolCalls.at(-1).args.action, "pause");
      assert.equal(toolCalls.at(-1).args.taskId, undefined);
      assert.equal((await readGoalState({ root: repo })).goal.status, "paused");
      assert.equal(app.findByClass("dag-pause-btn", app.headerEl)[0].classList.contains("is-paused"), true);
      app.findByClass("dag-pause-btn", app.headerEl)[0].click();
      await waitForCondition(() => app.findByClass("dag-pause-btn", app.headerEl)[0]?.textContent === "Pause");
      assert.equal(toolCalls.at(-1).args.action, "resume");
      assert.equal((await readGoalState({ root: repo })).goal.status, "active");
      assert.equal(app.footerEl.children.length, 0);
      assert.equal(toolCalls.every((entry) => entry.name === "pota_dag_action"), true);
    }

    // 12-2. Antigravity(SEP-1865): 파일 칩 열기·민감 파일 차단, tools/call pota_dag_action, ui/message 후속 요청
    {
      const app = mountDagHtmlApp({ html, hasDistinctParent: true, openai: undefined });
      const initReq = app.postedMessages.find((msg) => msg.method === "ui/initialize");
      app.dispatchHostMessage({
        jsonrpc: "2.0",
        id: initReq.id,
        result: {
          protocolVersion: "2026-01-26",
          hostCapabilities: {},
          hostContext: { theme: "light", locale: "en", displayMode: "inline" },
        },
      });
      await app.flushMicrotasks();
      app.dispatchHostMessage({
        jsonrpc: "2.0",
        method: "ui/notifications/tool-result",
        params: { structuredContent: enrichedPayload },
      });
      await app.flushMicrotasks();
      const inspectorEl = app.findByClass("dag-inspector")[0];
      const tabPanelEl = app.findByClass("dag-tab-panel")[0];
      const tabBtns = app.findByClass("dag-tab-btn");

      tabBtns[1].click();
      const diffChips = app.findByClass("dag-file-chip", tabPanelEl);
      const envChip = diffChips.find((chip) => chip.textContent === ".env");
      const srcChip = diffChips.find((chip) => chip.textContent === "src/s2.mjs");
      assert.equal(envChip.localName, "span");
      assert.equal(envChip.classList.contains("is-sensitive"), true);
      assert.equal(srcChip.localName, "button");
      envChip.click();
      assert.equal(app.postedMessages.some((msg) => msg.method === "com.google.antigravity/toggle-aux-pane"), false);
      srcChip.click();
      const auxMsg = app.postedMessages.find((msg) => msg.method === "com.google.antigravity/toggle-aux-pane");
      assert.ok(auxMsg);
      assert.ok(auxMsg.params.uri.startsWith("file://"));
      assert.ok(auxMsg.params.uri.endsWith("/src/s2.mjs"));
      tabBtns[0].click();

      clickCard(app, "t2");
      assert.equal(inspectorEl.hidden, false);

      // 후속 요청: SEP-1865 ui/message { role: "user", content: [{ type: "text", text }] }
      app.findByClass("dag-followup-btn", inspectorEl)[0].click();
      const messageReq = app.postedMessages.find((msg) => msg.method === "ui/message");
      assert.ok(messageReq);
      assert.deepEqual(Object.keys(messageReq.params), ["role", "content"]);
      assert.equal(messageReq.params.role, "user");
      assert.equal(messageReq.params.content.length, 1);
      assert.equal(messageReq.params.content[0].type, "text");
      assert.ok(messageReq.params.content[0].text.includes("t2"));
      app.dispatchHostMessage({ jsonrpc: "2.0", id: messageReq.id, result: {} });
      await app.flushMicrotasks();
      assert.equal(app.toastEl.textContent, "Follow-up message sent.");

      const answerToolCall = async (predicate, respond) => {
        const req = app.postedMessages.filter((msg) => msg.method === "tools/call").reverse().find(predicate);
        assert.ok(req);
        app.dispatchHostMessage({ jsonrpc: "2.0", id: req.id, result: await respond(req) });
        await app.flushMicrotasks();
        return req;
      };

      // 게이트 토글: tools/call → 실서버 결과 응답
      app.findByClass("dag-gate-btn", inspectorEl)[0].click();
      const gateReq = await answerToolCall(
        (msg) => msg.params.name === "pota_dag_action" && msg.params.arguments.action === "toggle_gate",
        (msg) => callServer(enrichedServer, msg.params.name, msg.params.arguments),
      );
      assert.equal(gateReq.params.arguments.taskId, "t2");
      assert.equal(gateReq.params.arguments.enabled, true);
      assert.equal(app.findByClass("dag-gate-btn", inspectorEl)[0].textContent, "Disable gate");
      app.findByClass("dag-gate-btn", inspectorEl)[0].click();
      const gateOffReq = await answerToolCall(
        (msg) => msg.params.name === "pota_dag_action" && msg.params.arguments.action === "toggle_gate" && msg.id !== gateReq.id,
        (msg) => callServer(enrichedServer, msg.params.name, msg.params.arguments),
      );
      assert.equal(gateOffReq.params.arguments.enabled, false);
      assert.equal(app.findByClass("dag-gate-btn", inspectorEl)[0].textContent, "Enable gate");

      // 도구 오류 응답은 토스트로만 알리고 화면 상태는 유지한다.
      app.findByClass("dag-pause-btn", app.headerEl)[0].click();
      const failedPause = await answerToolCall(
        (msg) => msg.params.name === "pota_dag_action" && msg.params.arguments.action === "pause",
        async () => ({ isError: true, content: [{ type: "text", text: "simulated failure" }] }),
      );
      assert.ok(app.toastEl.textContent.startsWith("Could not execute action."));
      assert.equal(app.findByClass("dag-pause-btn", app.headerEl)[0].textContent, "Pause");
      assert.equal(app.footerEl.children.length, 0);

      app.findByClass("dag-pause-btn", app.headerEl)[0].click();
      await answerToolCall(
        (msg) => msg.params.name === "pota_dag_action" && msg.params.arguments.action === "pause" && msg.id !== failedPause.id,
        (msg) => callServer(enrichedServer, msg.params.name, msg.params.arguments),
      );
      assert.equal(app.findByClass("dag-pause-btn", app.headerEl)[0].textContent, "Resume");
      app.findByClass("dag-pause-btn", app.headerEl)[0].click();
      await answerToolCall(
        (msg) => msg.params.name === "pota_dag_action" && msg.params.arguments.action === "resume",
        (msg) => callServer(enrichedServer, msg.params.name, msg.params.arguments),
      );
      assert.equal(app.findByClass("dag-pause-btn", app.headerEl)[0].textContent, "Pause");
      assert.equal((await readGoalState({ root: repo })).goal.status, "active");
    }

    // 12-3. 트랜스크립트 없는 호스트(agent id "main") + 후속 요청 브리지 부재: 오류 없이 렌더링, 후속 요청 버튼 숨김
    {
      const plainPayload = (await callServer(plainServer, "pota_dag_state", { root: repo, locale: "en" })).structuredContent;
      assert.equal(plainPayload.tasks.every((task) => task.transcript === null), true);
      assert.equal(plainPayload.agentStats.enrichedAgents, 0);
      const app = mountDagHtmlApp({
        html,
        hasDistinctParent: false,
        openai: {
          theme: "light",
          locale: "en-US",
          displayMode: "inline",
          toolOutput: plainPayload,
          callTool: async () => ({ structuredContent: plainPayload }),
          notifyIntrinsicHeight: () => {},
        },
      });
      const inspectorEl = app.findByClass("dag-inspector")[0];
      const tabPanelEl = app.findByClass("dag-tab-panel")[0];
      clickCard(app, "t1");
      assert.equal(inspectorEl.hidden, false);
      assert.ok(inspectorEl.textContent.includes("main"));
      assert.equal(inspectorEl.textContent.includes("Tokens"), false);
      assert.equal(app.findByClass("dag-followup-btn", inspectorEl).length, 0);

      app.findByClass("dag-tab-btn").find((btn) => btn.dataset.tab === "stats").click();
      assert.equal(app.findByClass("dag-stats-row", tabPanelEl).length, 2);
      assert.equal(tabPanelEl.textContent.includes("cache"), false);
      assert.equal(app.footerEl.children.length, 0);
      assert.equal(app.toastEl.hidden, true);
    }
  });
});

test("13. open_pota_dag 슬림 structuredContent 바이트 상한과 듀얼 브리지 첫 렌더링", async () => {
  await withWorkspace(async ({ repo, env }) => {
    const taskCount = 20;
    const taskId = (index) => `task-${String(index + 1).padStart(2, "0")}`;
    await mkdir(join(repo, "docs", "plan"), { recursive: true });
    await mkdir(join(repo, "src"), { recursive: true });
    await writeFile(
      join(repo, "docs", "plan", "big.md"),
      "# Big Plan\n\n## Goal\n\nShip twenty modules.\n\n- Current request: render the whole DAG\n\n## Status\n\n- [ ] Done\n",
      "utf8",
    );
    for (let index = 0; index < taskCount; index += 1) {
      await writeFile(join(repo, "src", `module-${index + 1}.mjs`), `export const value${index} = ${index};\n`, "utf8");
    }
    await startGoal({
      root: repo,
      goal: "Big Slim Goal",
      planId: "docs/plan/big.md",
      evidencePolicy: "declared",
      tasks: Array.from({ length: taskCount }, (_, index) => ({
        id: taskId(index),
        title: `Implement module ${index + 1} with a reasonably descriptive multi-word title for realism`,
        dependsOn: index < 4 ? [] : [taskId(index - 4)],
        requiredEvidence: ["moduleAcceptance"],
        writeScope: [`src/module-${index + 1}.mjs`],
      })),
    });
    await assignTask({ root: repo, taskId: taskId(0), agentId: "main" });
    await recordReceipt({ root: repo, taskId: taskId(0), kind: "moduleAcceptance", command: "npm test -- module-1", exitCode: 0 });
    await recordActiveWorkspace({ workspacePath: repo, conversationId: "conv-slim", env });

    const server = createDagMcpServer({ env, now: () => 1_700_000_040_000 });
    let rpcId = 300;
    const callServer = async (name, args) => (await server.handleMessage({
      jsonrpc: "2.0",
      id: ++rpcId,
      method: "tools/call",
      params: { name, arguments: args },
    })).result;

    // 13-1. 모델에 보이는 structuredContent는 2 KiB 미만의 요약이며 무거운 UI 데이터·파일 목록·Plan 본문을 싣지 않는다.
    const openResult = await callServer("open_pota_dag", { locale: "en" });
    const slim = openResult.structuredContent;
    const slimBytes = Buffer.byteLength(JSON.stringify(slim), "utf8");
    assert.ok(slimBytes < 2048, `open_pota_dag structuredContent is ${slimBytes} bytes`);
    assert.equal(slim.kind, "pota-dag-open");
    assert.equal(slim.root, repo);
    assert.ok(typeof slim.rootLabel === "string" && slim.rootLabel.endsWith("/repo"));
    assert.equal(slim.goal.title, "Big Slim Goal");
    assert.equal(slim.goal.status, "active");
    assert.equal(slim.summary.total, taskCount);
    assert.equal(slim.summary.running, 1);
    assert.equal(slim.error, null);
    for (const heavyKey of ["tasks", "svg", "gitDiff", "planOverview", "sections", "workspaces", "messages", "agentStats"]) {
      assert.equal(Object.hasOwn(slim, heavyKey), false, `slim payload must not carry ${heavyKey}`);
    }
    assert.ok(openResult.content[0].text.includes("Big Slim Goal"));
    const openResultBytes = Buffer.byteLength(JSON.stringify(openResult), "utf8");
    assert.ok(openResultBytes < 4096, `open_pota_dag result (including _meta) is ${openResultBytes} bytes`);
    assert.doesNotMatch(JSON.stringify(openResult), /module-1\.mjs|Ship twenty modules/);

    // 앱 전용 pota_dag_state는 전체 상태를 그대로 돌려준다.
    const full = (await callServer("pota_dag_state", { root: repo, locale: "en" })).structuredContent;
    assert.equal(full.tasks.length, taskCount);
    assert.ok(full.svg.source.includes("<svg "));
    assert.ok(Buffer.byteLength(JSON.stringify(full), "utf8") > slimBytes * 10);

    const html = renderDagAppHtml({ title: "Pota DAG", version: "2.3.0" });
    const svgMounted = (app) => app.svgWrapEl.children.length === 1 && app.svgWrapEl.children[0].localName === "svg";

    // 13-2. window.openai: 슬림 toolOutput → 비공개 pota_dag_state 자가 수화로 첫 화면에 DAG를 그린다.
    {
      const toolCalls = [];
      const app = mountDagHtmlApp({
        html,
        hasDistinctParent: false,
        openai: {
          theme: "light",
          locale: "en-US",
          displayMode: "inline",
          toolInput: { locale: "en" },
          toolOutput: slim,
          toolResponseMetadata: openResult._meta ?? null,
          callTool: async (name, args) => {
            toolCalls.push({ name, args });
            return callServer(name, args);
          },
          notifyIntrinsicHeight: () => {},
        },
      });
      await waitForCondition(() => svgMounted(app));
      assert.equal(toolCalls[0].name, "pota_dag_state");
      assert.equal(toolCalls[0].args.root, repo);
      assert.ok(app.headerEl.textContent.includes("Big Slim Goal"));
      assert.ok(app.findByClass("card", app.svgWrapEl).length > 0);
      assert.equal(app.footerEl.children.length, 0);
    }

    // 13-3. window.openai: toolOutput이 마운트 뒤 openai:set_globals로 도착해도 한 번만 수화해 렌더링한다.
    {
      const toolCalls = [];
      const openaiBridge = {
        theme: "light",
        locale: "en-US",
        displayMode: "inline",
        toolOutput: null,
        callTool: async (name, args) => {
          toolCalls.push({ name, args });
          return callServer(name, args);
        },
        notifyIntrinsicHeight: () => {},
      };
      const app = mountDagHtmlApp({ html, hasDistinctParent: false, openai: openaiBridge });
      app.dispatchWindowEvent("openai:set_globals", { detail: { globals: { toolOutput: slim } } });
      await waitForCondition(() => svgMounted(app));
      await app.advanceTime(200);
      await waitForCondition(() => toolCalls.length >= 1);
      assert.equal(toolCalls.every((entry) => entry.name === "pota_dag_state" && entry.args.root === repo), true);
      assert.ok(app.headerEl.textContent.includes("Big Slim Goal"));
      assert.equal(app.footerEl.children.length, 0);
    }

    // 13-4. SEP-1865(Antigravity): 초기화 전에 온 슬림 tool-result도 초기화 직후 tools/call pota_dag_state로 수화해 렌더링한다.
    {
      const app = mountDagHtmlApp({ html, hasDistinctParent: true, openai: undefined });
      const initReq = app.postedMessages.find((msg) => msg.method === "ui/initialize");
      assert.ok(initReq);
      app.dispatchHostMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: { locale: "en" } } });
      app.dispatchHostMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: openResult });
      await app.flushMicrotasks();
      assert.equal(app.postedMessages.some((msg) => msg.method === "tools/call"), false);

      app.dispatchHostMessage({
        jsonrpc: "2.0",
        id: initReq.id,
        result: { protocolVersion: "2026-01-26", hostCapabilities: {}, hostContext: { theme: "light", locale: "en" } },
      });
      await app.flushMicrotasks();
      const hydrateReq = app.postedMessages.find((msg) => msg.method === "tools/call");
      assert.ok(hydrateReq);
      assert.equal(hydrateReq.params.name, "pota_dag_state");
      assert.equal(hydrateReq.params.arguments.root, repo);
      app.dispatchHostMessage({ jsonrpc: "2.0", id: hydrateReq.id, result: await callServer(hydrateReq.params.name, hydrateReq.params.arguments) });
      await app.flushMicrotasks();
      assert.equal(svgMounted(app), true);
      assert.ok(app.headerEl.textContent.includes("Big Slim Goal"));
      assert.equal(app.footerEl.children.length, 0);

      // 이미 초기화된 뒤 다시 온 슬림 tool-result는 즉시 재수화한다.
      const before = app.postedMessages.filter((msg) => msg.method === "tools/call").length;
      app.dispatchHostMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: openResult });
      await app.flushMicrotasks();
      assert.equal(app.postedMessages.filter((msg) => msg.method === "tools/call").length, before + 1);
    }
  });
});

test("14. pota_dag_action 명시 게이트 값(경합 시 해제 금지)과 미등록 워크스페이스 거부", async () => {
  await withWorkspace(async ({ base, repo, env }) => {
    await startGoal({
      root: repo,
      goal: "Gate Race Goal",
      planId: "docs/plan/race.md",
      evidencePolicy: "declared",
      tasks: [
        { id: "t1", title: "First", requiredEvidence: ["moduleAcceptance"] },
        { id: "t2", title: "Second", dependsOn: ["t1"], requiredEvidence: ["moduleAcceptance"] },
      ],
    });
    await assignTask({ root: repo, taskId: "t1", agentId: "main" });
    await recordActiveWorkspace({ workspacePath: repo, conversationId: "conv-race", env });
    const server = createDagMcpServer({ env, now: () => 1_700_000_040_000 });
    let rpcId = 400;
    const callServer = async (srv, name, args) => (await srv.handleMessage({
      jsonrpc: "2.0",
      id: ++rpcId,
      method: "tools/call",
      params: { name, arguments: args },
    })).result;

    // 14-1. 패널이 게이트 해제 상태를 그린 뒤 다른 주체가 게이트를 켜고, t1 완료로 t2가 게이트 대기(ready) 상태가 된다.
    const stalePayload = (await callServer(server, "pota_dag_state", { root: repo, locale: "en" })).structuredContent;
    assert.equal(stalePayload.tasks.find((task) => task.id === "t2").approvalGate, false);
    await setTaskApprovalGate({ root: repo, taskId: "t2", enabled: true });
    await recordReceipt({ root: repo, taskId: "t1", kind: "moduleAcceptance", command: "npm test", exitCode: 0 });
    await setTaskStatus({ root: repo, taskId: "t1", status: "completed", mainModelGate: false });
    const gatedState = await readGoalState({ root: repo });
    assert.equal(gatedState.tasks.find((task) => task.id === "t2").approvalGate, true);
    assert.equal(gatedState.tasks.find((task) => task.id === "t2").status, "pending");

    // 14-2. 오래된 화면에서 "Enable gate"를 누르면 enabled: true만 보내고, 게이트는 유지되며 t2는 활성화되지 않는다.
    const html = renderDagAppHtml({ title: "Pota DAG", version: "2.3.0" });
    const toolCalls = [];
    const app = mountDagHtmlApp({
      html,
      hasDistinctParent: false,
      openai: {
        theme: "light",
        locale: "en-US",
        displayMode: "inline",
        toolOutput: stalePayload,
        callTool: async (name, args) => {
          toolCalls.push({ name, args });
          return callServer(server, name, args);
        },
        notifyIntrinsicHeight: () => {},
      },
    });
    const card = app.findByClass("card", app.svgWrapEl).find((node) => node.getAttribute("data-task-id") === "t2");
    assert.ok(card);
    app.svgWrapEl.dispatchEvent({ type: "click", target: app.findByTag("rect", card)[0] });
    const inspectorEl = app.findByClass("dag-inspector")[0];
    const staleGateBtn = app.findByClass("dag-gate-btn", inspectorEl)[0];
    assert.equal(staleGateBtn.textContent, "Enable gate");
    staleGateBtn.click();
    await waitForCondition(() => toolCalls.some((entry) => entry.name === "pota_dag_action"));
    await waitForCondition(() => app.findByClass("dag-gate-badge", inspectorEl).length === 1);
    const actionCall = toolCalls.find((entry) => entry.name === "pota_dag_action");
    assert.equal(actionCall.args.action, "toggle_gate");
    assert.equal(actionCall.args.enabled, true);
    const afterUi = await readGoalState({ root: repo });
    assert.equal(afterUi.tasks.find((task) => task.id === "t2").approvalGate, true);
    assert.equal(afterUi.tasks.find((task) => task.id === "t2").status, "pending");
    assert.equal(afterUi.goal.status, "active");

    // 14-3. 직접 호출도 같다: enabled: true 반복은 유지, enabled 없는 맹목 반전은 상태를 건드리지 않고 거부한다.
    const again = await callServer(server, "pota_dag_action", { action: "toggle_gate", taskId: "t2", enabled: true, root: repo });
    assert.notEqual(again.isError, true);
    assert.equal(again.structuredContent.tasks.find((task) => task.id === "t2").status, "pending");
    const beforeBare = await readFile(goalStatePath(repo));
    const bare = await callServer(server, "pota_dag_action", { action: "toggle_gate", taskId: "t2", root: repo });
    assert.equal(bare.isError, true);
    assert.match(bare.content[0].text, /enabled/);
    assert.deepEqual(await readFile(goalStatePath(repo)), beforeBare);

    // 명시적 해제(enabled: false)만 게이트를 풀고 ready task를 진행시킨다.
    const released = await callServer(server, "pota_dag_action", { action: "toggle_gate", taskId: "t2", enabled: false, root: repo });
    assert.notEqual(released.isError, true);
    const releasedTask = (await readGoalState({ root: repo })).tasks.find((task) => task.id === "t2");
    assert.equal(releasedTask.approvalGate, false);
    assert.equal(releasedTask.status, "active");

    // 14-4. 등록되지 않은 저장소 root에는 어떤 action도 적용하지 않고 state.json을 바이트 단위로 보존한다.
    const otherRepo = await initTempRepo(join(base, "unregistered-repo"));
    await startGoal({
      root: otherRepo,
      goal: "Foreign Goal",
      planId: "docs/plan/foreign.md",
      evidencePolicy: "declared",
      tasks: [
        { id: "t1", title: "Foreign First", requiredEvidence: ["moduleAcceptance"] },
        { id: "t2", title: "Foreign Second", dependsOn: ["t1"], requiredEvidence: ["moduleAcceptance"] },
      ],
    });
    const otherStatePath = goalStatePath(otherRepo);
    const otherBefore = await readFile(otherStatePath);
    for (const args of [
      { action: "pause", root: otherRepo },
      { action: "resume", root: otherRepo },
      { action: "toggle_gate", taskId: "t2", enabled: true, root: otherRepo },
      { action: "toggle_gate", taskId: "t2", enabled: false, root: `${otherRepo}/` },
    ]) {
      const refused = await callServer(server, "pota_dag_action", args);
      assert.equal(refused.isError, true, JSON.stringify(args));
      assert.equal(refused.content[0].text, "Invalid workspace root", JSON.stringify(args));
      assert.equal(refused.structuredContent, undefined, JSON.stringify(args));
    }
    assert.deepEqual(await readFile(otherStatePath), otherBefore);

    // 읽기 전용 도구는 명시 root를 계속 허용한다.
    const readOnly = await callServer(server, "pota_dag_state", { root: otherRepo, locale: "en" });
    assert.equal(readOnly.structuredContent.root, otherRepo);
    assert.equal(readOnly.structuredContent.goal.title, "Foreign Goal");
    const readOnlyOpen = await callServer(server, "open_pota_dag", { root: otherRepo, locale: "en" });
    assert.equal(readOnlyOpen.structuredContent.root, otherRepo);
    assert.deepEqual(await readFile(otherStatePath), otherBefore);

    // HARNESS_REPO_ROOT로 서버에 지정된 저장소는 등록된 워크스페이스로 인정한다.
    const envServer = createDagMcpServer({ env: { ...env, HARNESS_REPO_ROOT: otherRepo }, now: () => 1_700_000_040_000 });
    const envPaused = await callServer(envServer, "pota_dag_action", { action: "pause", root: otherRepo, locale: "en" });
    assert.notEqual(envPaused.isError, true);
    assert.equal((await readGoalState({ root: otherRepo })).goal.status, "paused");
  });
});

test("15. 폴링 경로 증거 freshness: 감시 경로 없는 영수증은 null(unknown), 감시 영수증은 revision·TTL 캐시", async () => {
  await withWorkspace(async ({ repo, env }) => {
    await mkdir(join(repo, "src"), { recursive: true });
    await writeFile(join(repo, "src", "watched.mjs"), "export const v = 1;\n", "utf8");
    await startGoal({
      root: repo,
      goal: "Freshness Goal",
      planId: "docs/plan/fresh.md",
      evidencePolicy: "declared",
      tasks: [{ id: "t1", title: "Verify Step", requiredEvidence: ["moduleAcceptance"], writeScope: ["src"] }],
    });
    await assignTask({ root: repo, taskId: "t1", agentId: "main" });
    const runner = () => ({ status: 0, stdout: "ok\n", stderr: "" });
    await verifyAndRecord({ root: repo, taskId: "t1", kind: "moduleAcceptance", argv: ["node", "--version"], runner });
    await verifyAndRecord({
      root: repo,
      taskId: "t1",
      kind: "staticAnalysis",
      argv: ["node", "--version"],
      watchPaths: ["src/watched.mjs"],
      runner,
    });

    const fingerprintCalls = [];
    let nowMs = 1_700_000_040_000;
    const server = createDagMcpServer({
      env,
      now: () => nowMs,
      workspaceFingerprint: (root, watchPaths) => {
        fingerprintCalls.push(watchPaths);
        return workspaceFingerprint(root, watchPaths);
      },
    });
    let rpcId = 500;
    const callServer = async (name, args) => (await server.handleMessage({
      jsonrpc: "2.0",
      id: ++rpcId,
      method: "tools/call",
      params: { name, arguments: args },
    })).result;
    const receiptsOf = (payload) => Object.fromEntries(
      payload.tasks.find((task) => task.id === "t1").receipts.map((receipt) => [receipt.kind, receipt]),
    );

    // 15-1. 감시 경로 없는 tool 영수증은 전체 저장소 해시 없이 fresh: null, 감시 영수증만 지문을 계산한다.
    const first = (await callServer("pota_dag_state", { root: repo, locale: "en" })).structuredContent;
    assert.equal(receiptsOf(first).moduleAcceptance.fresh, null);
    assert.equal(receiptsOf(first).moduleAcceptance.source, "tool");
    assert.equal(receiptsOf(first).staticAnalysis.fresh, true);
    assert.deepEqual(fingerprintCalls, [["src/watched.mjs"]]);

    // 15-2. revision이 같은 연속 폴링과 open_pota_dag는 다시 해시하지 않는다.
    const second = (await callServer("pota_dag_state", { root: repo, locale: "en" })).structuredContent;
    assert.equal(receiptsOf(second).staticAnalysis.fresh, true);
    await callServer("open_pota_dag", { root: repo, locale: "en" });
    assert.equal(fingerprintCalls.length, 1);

    // 15-3. 짧은 TTL이 지나면 다시 계산해 변경된 감시 파일을 stale로 보고한다.
    await writeFile(join(repo, "src", "watched.mjs"), "export const v = 2;\n", "utf8");
    nowMs += 60_000;
    const third = (await callServer("pota_dag_state", { root: repo, locale: "en" })).structuredContent;
    assert.equal(fingerprintCalls.length, 2);
    assert.equal(receiptsOf(third).staticAnalysis.fresh, false);
    assert.equal(receiptsOf(third).moduleAcceptance.fresh, null);
    assert.equal(fingerprintCalls.every((watchPaths) => watchPaths.length > 0), true);

    // 15-4. UI는 fresh: null인 tool 영수증을 fresh/stale이 아닌 unknown으로, 선언 영수증은 declared로 표시한다.
    const html = renderDagAppHtml({ title: "Pota DAG", version: "2.3.0" });
    const app = mountDagHtmlApp({
      html,
      hasDistinctParent: false,
      openai: {
        theme: "light",
        locale: "en-US",
        displayMode: "inline",
        toolOutput: third,
        callTool: async () => ({ structuredContent: third }),
        notifyIntrinsicHeight: () => {},
      },
    });
    const card = app.findByClass("card", app.svgWrapEl).find((node) => node.getAttribute("data-task-id") === "t1");
    assert.ok(card);
    app.svgWrapEl.dispatchEvent({ type: "click", target: app.findByTag("rect", card)[0] });
    const rows = app.findByClass("dag-receipt-row", app.findByClass("dag-inspector")[0]);
    const rowText = Object.fromEntries(rows.map((row) => [app.findByClass("dag-badge", row)[0].textContent, row.textContent]));
    assert.ok(rowText.moduleAcceptance.includes("unknown"));
    assert.equal(rowText.moduleAcceptance.includes("fresh"), false);
    assert.equal(rowText.moduleAcceptance.includes("stale"), false);
    assert.ok(rowText.staticAnalysis.includes("stale"));
  });
});

// HTML 듀얼 브리지 클라이언트 스크립트를 가상 DOM/타이머 환경의 vm 컨텍스트에서 결정적으로 마운트한다.
function mountDagHtmlApp({ html, openai, hasDistinctParent = true, hostContextLocale = "en-US", initialWidth = 420, initialHeight = 320 }) {
  const scriptMatches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scriptMatches.length, 1);

  class MockElement {
    constructor(tagName) {
      this.nodeType = 1;
      this.tagName = String(tagName).toUpperCase();
      this.localName = String(tagName).toLowerCase();
      this.className = "";
      this.dataset = {};
      this.hidden = false;
      this.disabled = false;
      this.type = "";
      this.title = "";
      this.value = "";
      this.selected = false;
      this.id = "";
      this.clientWidth = 0;
      this.scrollHeight = 0;
      this.parentNode = null;
      this.childNodes = [];
      this._text = "";
      this._attrs = new Map();
      this._listeners = new Map();
      this._rect = { width: 0, height: 0 };
      this.style = {
        colorScheme: "",
        _props: new Map(),
        setProperty(key, val) {
          this._props.set(key, String(val));
        },
        removeProperty(key) {
          this._props.delete(key);
        },
        getPropertyValue(key) {
          return this._props.get(key) ?? "";
        },
      };
      const self = this;
      this.classList = {
        toggle(cls, force) {
          const tokens = new Set(self.className.split(/\s+/).filter(Boolean));
          const next = force === undefined ? !tokens.has(cls) : Boolean(force);
          if (next) tokens.add(cls);
          else tokens.delete(cls);
          self.className = [...tokens].join(" ");
          return next;
        },
        contains(cls) {
          return self.className.split(/\s+/).filter(Boolean).includes(cls);
        },
      };
    }

    get children() {
      return this.childNodes.filter((n) => n.nodeType === 1);
    }

    get firstChild() {
      return this.childNodes[0] ?? null;
    }

    get attributes() {
      return Array.from(this._attrs.entries()).map(([name, value]) => ({
        name,
        localName: name.includes(":") ? name.split(":")[1] : name,
        value,
      }));
    }

    get textContent() {
      if (this.childNodes.length === 0) return this._text;
      return this._text + this.childNodes.map((n) => n.textContent ?? "").join("");
    }

    set textContent(value) {
      this.childNodes = [];
      this._text = value === undefined || value === null ? "" : String(value);
    }

    setAttribute(name, value) {
      const str = String(value);
      this._attrs.set(name, str);
      if (name === "class") this.className = str;
      if (name === "id") this.id = str;
    }

    getAttribute(name) {
      if (name === "class") return this.className || null;
      return this._attrs.has(name) ? this._attrs.get(name) : null;
    }

    appendChild(node) {
      if (node.parentNode) {
        const idx = node.parentNode.childNodes.indexOf(node);
        if (idx !== -1) node.parentNode.childNodes.splice(idx, 1);
      }
      node.parentNode = this;
      this.childNodes.push(node);
      return node;
    }

    append(...nodes) {
      for (const node of nodes) {
        if (typeof node === "string") {
          this.childNodes.push({ nodeType: 3, textContent: node, parentNode: this });
        } else if (node) {
          this.appendChild(node);
        }
      }
    }

    insertBefore(newNode, refNode) {
      if (!refNode) return this.appendChild(newNode);
      const idx = this.childNodes.indexOf(refNode);
      if (idx === -1) return this.appendChild(newNode);
      newNode.parentNode = this;
      this.childNodes.splice(idx, 0, newNode);
      return newNode;
    }

    replaceChildren(...nodes) {
      this.childNodes = [];
      this._text = "";
      this.append(...nodes);
    }

    addEventListener(type, listener) {
      if (!this._listeners.has(type)) this._listeners.set(type, []);
      this._listeners.get(type).push(listener);
    }

    dispatchEvent(event) {
      const evt = { target: this, currentTarget: this, preventDefault() {}, ...event };
      for (const fn of this._listeners.get(evt.type) ?? []) {
        fn(evt);
      }
    }

    click() {
      this.dispatchEvent({ type: "click" });
    }

    getBoundingClientRect() {
      return this._rect;
    }

    cloneNode(deep = true) {
      const copy = new MockElement(this.localName);
      copy.className = this.className;
      copy.dataset = { ...this.dataset };
      copy.hidden = this.hidden;
      copy.disabled = this.disabled;
      copy.type = this.type;
      copy.title = this.title;
      copy.value = this.value;
      copy.selected = this.selected;
      copy.id = this.id;
      copy._text = this._text;
      copy._attrs = new Map(this._attrs);
      if (deep) {
        for (const child of this.childNodes) {
          if (child.nodeType === 1) copy.appendChild(child.cloneNode(true));
          else copy.append(child.textContent);
        }
      }
      return copy;
    }
  }

  function decodeXmlEntities(text) {
    return text
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"')
      .replaceAll("&apos;", "'")
      .replaceAll("&#39;", "'")
      .replaceAll("&amp;", "&");
  }

  function parseSvgXml(source) {
    const trimmed = String(source ?? "").trim();
    if (!trimmed.startsWith("<")) return { documentElement: null, getElementsByTagName: () => [] };
    const stack = [];
    let root = null;
    let parserError = false;
    const tokenRe = /<!--[\s\S]*?-->|<\/([A-Za-z_][A-Za-z0-9:_-]*)\s*>|<([A-Za-z_][A-Za-z0-9:_-]*)((?:\s+[A-Za-z_][A-Za-z0-9:_-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
    let match;
    let lastIndex = 0;
    while ((match = tokenRe.exec(trimmed)) !== null) {
      if (match.index !== lastIndex) {
        parserError = true;
        break;
      }
      lastIndex = tokenRe.lastIndex;
      const [, closeTag, openTag, attrStr, selfClose, textChunk] = match;
      if (closeTag) {
        const top = stack.pop();
        if (!top || top.tag !== closeTag) {
          parserError = true;
          break;
        }
      } else if (openTag) {
        const node = new MockElement(openTag);
        if (attrStr) {
          const attrRe = /([A-Za-z_][A-Za-z0-9:_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
          let attrMatch;
          while ((attrMatch = attrRe.exec(attrStr)) !== null) {
            node.setAttribute(attrMatch[1], decodeXmlEntities(attrMatch[2] ?? attrMatch[3] ?? ""));
          }
        }
        if (stack.length > 0) stack[stack.length - 1].node.appendChild(node);
        else if (!root) root = node;
        else {
          parserError = true;
          break;
        }
        if (!selfClose) stack.push({ tag: openTag, node });
      } else if (textChunk && stack.length > 0) {
        const text = decodeXmlEntities(textChunk);
        if (text.length > 0) stack[stack.length - 1].node.append(text);
      }
    }
    if (lastIndex !== trimmed.length || stack.length > 0 || !root) parserError = true;
    return {
      documentElement: parserError ? null : root,
      getElementsByTagName(name) {
        if (name === "parsererror") return parserError ? [new MockElement("parsererror")] : [];
        const found = [];
        if (!root) return found;
        const walk = (n) => {
          if (n.localName === name.toLowerCase()) found.push(n);
          for (const child of n.children) walk(child);
        };
        walk(root);
        return found;
      },
    };
  }

  let nowMs = 0;
  let nextTimerId = 1;
  const timers = new Map();
  const rafQueue = [];
  const windowListeners = new Map();
  const documentListeners = new Map();
  const postedMessages = [];

  const appEl = new MockElement("main");
  appEl.id = "app";
  appEl.clientWidth = initialWidth;
  appEl.scrollHeight = initialHeight;
  appEl._rect = { width: initialWidth, height: initialHeight };

  const headerEl = new MockElement("header");
  headerEl.id = "dag-header";
  const toolbarEl = new MockElement("nav");
  toolbarEl.id = "dag-toolbar";
  const svgWrapEl = new MockElement("section");
  svgWrapEl.id = "dag-svg-wrap";
  svgWrapEl.hidden = true;
  svgWrapEl.clientWidth = Math.max(240, initialWidth - 20);
  svgWrapEl._rect = { width: Math.max(240, initialWidth - 20), height: 180 };
  const sectionsEl = new MockElement("section");
  sectionsEl.id = "dag-sections";
  const footerEl = new MockElement("footer");
  footerEl.id = "dag-footer";
  const toastEl = new MockElement("div");
  toastEl.id = "dag-toast";
  toastEl.hidden = true;
  appEl.append(headerEl, toolbarEl, svgWrapEl, sectionsEl, footerEl);

  const elementsById = new Map([
    ["app", appEl],
    ["dag-header", headerEl],
    ["dag-toolbar", toolbarEl],
    ["dag-svg-wrap", svgWrapEl],
    ["dag-sections", sectionsEl],
    ["dag-footer", footerEl],
    ["dag-toast", toastEl],
  ]);

  const docElement = new MockElement("html");
  docElement.lang = "en";

  const mockDocument = {
    hidden: false,
    documentElement: docElement,
    getElementById: (id) => elementsById.get(id) ?? null,
    createElement: (tag) => new MockElement(tag),
    importNode: (node, deep) => node.cloneNode(deep),
    addEventListener: (type, fn) => {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(fn);
    },
  };

  const sandbox = {
    document: mockDocument,
    navigator: { language: hostContextLocale },
    DOMParser: class {
      parseFromString(src) {
        return parseSvgXml(src);
      }
    },
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout: (fn, delay = 0) => {
      const id = nextTimerId++;
      timers.set(id, { due: nowMs + Math.max(0, Number(delay) || 0), fn });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
    },
    requestAnimationFrame: (fn) => {
      rafQueue.push(fn);
      return rafQueue.length;
    },
    matchMedia: () => ({ matches: false }),
    addEventListener: (type, fn) => {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(fn);
    },
  };
  sandbox.window = sandbox;
  const parentMock = hasDistinctParent
    ? {
        postMessage: (msg) => {
          postedMessages.push(msg);
        },
      }
    : sandbox;
  sandbox.parent = parentMock;
  if (openai !== undefined) sandbox.openai = openai;

  const context = vm.createContext(sandbox);
  new vm.Script(scriptMatches[0][1]).runInContext(context);

  const flushMicrotasks = async (turns = 12) => {
    for (let i = 0; i < turns; i += 1) {
      await Promise.resolve();
    }
  };

  const flushAnimationFrames = () => {
    while (rafQueue.length > 0) {
      const fn = rafQueue.shift();
      fn(nowMs);
    }
  };

  const advanceTime = async (ms) => {
    const target = nowMs + ms;
    while (true) {
      await flushMicrotasks();
      let nextId = null;
      let nextEntry = null;
      for (const [id, entry] of timers.entries()) {
        if (entry.due <= target && (!nextEntry || entry.due < nextEntry.due || (entry.due === nextEntry.due && id < nextId))) {
          nextId = id;
          nextEntry = entry;
        }
      }
      if (!nextEntry) break;
      timers.delete(nextId);
      nowMs = nextEntry.due;
      nextEntry.fn();
    }
    nowMs = target;
    flushAnimationFrames();
    await flushMicrotasks();
  };

  const findAll = (predicate, rootNode = appEl) => {
    const out = [];
    const walk = (node) => {
      if (predicate(node)) out.push(node);
      for (const child of node.children) walk(child);
    };
    walk(rootNode);
    return out;
  };

  return {
    appEl,
    headerEl,
    toolbarEl,
    svgWrapEl,
    sectionsEl,
    footerEl,
    toastEl,
    document: mockDocument,
    postedMessages,
    flushMicrotasks,
    flushAnimationFrames,
    advanceTime,
    findByClass: (cls, rootNode = appEl) => findAll((n) => n.classList.contains(cls), rootNode),
    findByTag: (tag, rootNode = appEl) => findAll((n) => n.localName === tag.toLowerCase(), rootNode),
    dispatchWindowEvent: (type, eventInit = {}) => {
      const evt = { type, ...eventInit };
      for (const fn of windowListeners.get(type) ?? []) fn(evt);
    },
    dispatchHostMessage: (data) => {
      const evt = { type: "message", source: parentMock, data };
      for (const fn of windowListeners.get("message") ?? []) fn(evt);
    },
  };
}

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

function runCliAsync(command, args, { cwd, env }) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", rejectRun);
    child.on("close", (status) => {
      resolveRun({ status, stdout, stderr });
    });
  });
}

function spawnMcpClient(env, { cwd = pluginRoot, args = [] } = {}) {
  const child = spawn(process.execPath, [mcpEntry, ...args], {
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

// S2 대시보드용 Plan·커밋된 파일·작업 트리 변경(.env 포함)·goal(t1 실행 중, t2 대기)을 만든다.
async function seedS2Workspace(repo) {
  await mkdir(join(repo, "docs", "plan"), { recursive: true });
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(
    join(repo, "docs", "plan", "s2.md"),
    "# S2 Plan\n\n## Goal\n\nShip the S2 dashboard.\n\n- Current request: add the inspector\n\n## Status\n\n- [x] Planned\n- [ ] Verified\n",
    "utf8",
  );
  await writeFile(join(repo, "src", "s2.mjs"), "export const s2 = 1;\n", "utf8");
  await writeFile(join(repo, ".env"), "TOKEN=old\n", "utf8");
  for (const args of [
    ["add", "-A"],
    ["-c", "user.name=Pota Test", "-c", "user.email=pota-test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "seed"],
  ]) {
    const git = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    assert.equal(git.status, 0, git.stderr);
  }
  await writeFile(join(repo, "src", "s2.mjs"), "export const s2 = 1;\nexport const inspector = true;\n", "utf8");
  await writeFile(join(repo, ".env"), "TOKEN=new\n", "utf8");

  await startGoal({
    root: repo,
    goal: "S2 Dashboard Goal",
    planId: "docs/plan/s2.md",
    evidencePolicy: "declared",
    tasks: [
      { id: "t1", title: "First Step", requiredEvidence: ["moduleAcceptance"] },
      {
        id: "t2",
        title: "Second Step",
        dependsOn: ["t1"],
        requiredEvidence: ["moduleAcceptance"],
        writeScope: ["src/s2.mjs"],
      },
    ],
  });
  await assignTask({ root: repo, taskId: "t1", agentId: "main" });
  await recordReceipt({ root: repo, taskId: "t1", kind: "moduleAcceptance", command: "npm test -- s2", exitCode: 0 });
}

// 실서버 왕복처럼 실제 I/O가 끼는 비동기 UI 갱신을 실시간 타이머로 기다린다.
async function waitForCondition(predicate, { timeoutMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for UI condition");
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
  }
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
