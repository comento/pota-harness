import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  MAX_CACHE_ENTRIES,
  MAX_TRANSCRIPT_BYTES,
  clearTranscriptCache,
  deriveEffortFromModel,
  enrichTasksWithTranscripts,
  isValidAgentUuid,
  parseTranscriptLines,
  readAntigravityTranscript,
  resolveAntigravityBrainDirs,
} from "../scripts/pota-dag-transcript.mjs";

const UUID_1 = "abcdef01-2345-4678-89ab-cdef01234567";
const UUID_2 = "22222222-2222-4222-8222-222222222222";
const UUID_3 = "33333333-3333-4333-8333-333333333333";

function makeUuid(index) {
  const hex = index.toString(16).padStart(12, "0");
  return `aaaaaaaa-bbbb-4ccc-8ddd-${hex}`;
}

async function withTempBrain(work) {
  const base = await mkdtemp(join(tmpdir(), "pota-dag-transcript-"));
  const brainDir = join(base, "brain");
  const isolatedHome = join(base, "isolated-home");
  await mkdir(brainDir, { recursive: true });
  await mkdir(isolatedHome, { recursive: true });
  clearTranscriptCache();
  try {
    return await work({ base, brainDir, isolatedHome });
  } finally {
    clearTranscriptCache();
    await rm(base, { recursive: true, force: true });
  }
}

async function writeAgentTranscript(brainDir, agentId, content, { legacyLocation = false } = {}) {
  const filePath = legacyLocation
    ? join(brainDir, agentId, "transcript.jsonl")
    : join(brainDir, agentId, ".system_generated", "logs", "transcript.jsonl");
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  return filePath;
}

test("1. isValidAgentUuid 및 deriveEffortFromModel 경계 검증", () => {
  assert.equal(isValidAgentUuid(UUID_1), true);
  assert.equal(isValidAgentUuid(UUID_1.toUpperCase()), false);
  assert.equal(isValidAgentUuid("main"), false);
  assert.equal(isValidAgentUuid("../etc/passwd"), false);
  assert.equal(isValidAgentUuid("worker-1"), false);
  assert.equal(isValidAgentUuid(`${UUID_1}\n`), false);
  assert.equal(isValidAgentUuid(null), false);
  assert.equal(isValidAgentUuid(123), false);

  assert.equal(deriveEffortFromModel("gemini-4-hydrogen-tiered-xhigh"), "xhigh");
  assert.equal(deriveEffortFromModel("gemini-3.8-flash-HIGH"), "high");
  assert.equal(deriveEffortFromModel("claude-sonnet-5-5-medium"), "medium");
  assert.equal(deriveEffortFromModel("gpt-oss-120b-low"), "low");
  assert.equal(deriveEffortFromModel("gemini-3.5-flash-lite"), null);
  assert.equal(deriveEffortFromModel(""), null);
  assert.equal(deriveEffortFromModel(null), null);
});

test("2. resolveAntigravityBrainDirs 우선순위·중복 제거·환경변수 폴백 검증", async () => {
  await withTempBrain(async ({ base, brainDir, isolatedHome }) => {
    const appDataDir = join(base, "app-data");
    const agyHome = join(base, "agy-home");

    const ordered = resolveAntigravityBrainDirs({
      brainDir,
      env: {
        ANTIGRAVITY_BRAIN_DIR: join(base, "env-brain"),
        ANTIGRAVITY_APP_DATA_DIR: appDataDir,
        ANTIGRAVITY_HOME: agyHome,
      },
      homeDir: isolatedHome,
    });

    assert.deepEqual(ordered, [
      resolve(brainDir),
      resolve(join(base, "env-brain")),
      resolve(join(appDataDir, "brain")),
      resolve(join(agyHome, "brain")),
      resolve(join(isolatedHome, ".gemini", "antigravity", "brain")),
    ]);

    const deduplicated = resolveAntigravityBrainDirs({
      brainDir: `${join(agyHome, "brain")}/`,
      env: {
        ANTIGRAVITY_BRAIN_DIR: join(agyHome, "brain"),
        ANTIGRAVITY_APP_DATA_DIR: "   ",
        ANTIGRAVITY_HOME: agyHome,
        HOME: isolatedHome,
      },
    });

    assert.deepEqual(deduplicated, [
      resolve(join(agyHome, "brain")),
      resolve(join(isolatedHome, ".gemini", "antigravity", "brain")),
    ]);
  });
});

test("3. 정상 Antigravity transcript.jsonl 파싱(snake_case/camelCase, 캐시 적중률, 폴백 경로)", async () => {
  await withTempBrain(async ({ brainDir, isolatedHome }) => {
    const lines = [
      JSON.stringify({ step_index: 0, type: "SYSTEM_MESSAGE", content: "boot" }),
      JSON.stringify({ step_index: 1, type: "USER_INPUT", content: "implement" }),
      JSON.stringify({
        step_index: 2,
        type: "PLANNER_RESPONSE",
        model: "gemini-3.8-flash-high",
        input_tokens: 1000,
        cache_read_tokens: 250,
        output_tokens: 100,
      }),
      JSON.stringify({
        step_index: 3,
        type: "PLANNER_RESPONSE",
        model: "gemini-4-hydrogen-tiered-xhigh",
        inputTokens: 1000,
        cacheReadTokens: 750,
        outputTokens: 200,
      }),
      // 모델이 비어 있는 후속 턴은 직전 비공백 resolvedModel을 유지해야 한다.
      JSON.stringify({
        step_index: 4,
        type: "PLANNER_RESPONSE",
        model: "",
        input_tokens: -50,
        inputTokens: 500,
        cache_read_tokens: 1.5,
        output_tokens: "invalid",
      }),
    ].join("\n");

    await writeAgentTranscript(brainDir, UUID_1, `${lines}\n`);
    const result = await readAntigravityTranscript(UUID_1, {
      brainDir,
      env: {},
      homeDir: isolatedHome,
    });

    assert.ok(result);
    assert.equal(result.resolvedModel, "gemini-4-hydrogen-tiered-xhigh");
    assert.equal(result.resolvedEffort, "xhigh");
    assert.equal(result.resolvedTier, "stronger");
    assert.equal(result.turns, 3);
    // input=2500, cacheRead=1000 -> denom=2500 -> 1000/2500 = 0.4
    assert.deepEqual(result.tokens, {
      input: 2500,
      cacheRead: 1000,
      output: 300,
      cacheHitRate: 0.4,
      truncated: false,
    });
    assert.equal(Number.isNaN(Date.parse(result.updatedAt)), false);

    // .system_generated/logs/transcript.jsonl이 없고 <uuid>/transcript.jsonl만 있는 경우도 읽는다.
    await writeAgentTranscript(
      brainDir,
      UUID_2,
      `${JSON.stringify({
        type: "PLANNER_RESPONSE",
        model: "gemini-4-argon-high",
        input_tokens: 200,
        cache_read_tokens: 800,
        output_tokens: 50,
      })}\n`,
      { legacyLocation: true },
    );

    const legacy = await readAntigravityTranscript(UUID_2, {
      brainDir,
      env: {},
      homeDir: isolatedHome,
    });
    assert.ok(legacy);
    assert.equal(legacy.resolvedModel, "gemini-4-argon-high");
    assert.equal(legacy.resolvedEffort, "high");
    assert.equal(legacy.resolvedTier, "strongest");
    // cacheRead(800) > input(200) 분기: denom = 200 + 800 = 1000 -> 0.8
    assert.equal(legacy.tokens.cacheHitRate, 0.8);
  });
});

test("4. 스트리밍 중인 마지막 불완전 JSON 줄을 안전하게 스킵하고 이전 턴·토큰을 보존", async () => {
  await withTempBrain(async ({ brainDir, isolatedHome }) => {
    const content = [
      JSON.stringify({
        step_index: 0,
        type: "PLANNER_RESPONSE",
        model: "gemini-4-hydrogen-tiered-high",
        input_tokens: 1200,
        cache_read_tokens: 600,
        output_tokens: 80,
      }),
      JSON.stringify({
        step_index: 1,
        type: "PLANNER_RESPONSE",
        model: "gemini-4-neon-high",
        input_tokens: 800,
        cache_read_tokens: 400,
        output_tokens: 120,
      }),
      '{"type":"PLANNER_RESPONSE","model":"gemini-4-neon-hi',
    ].join("\n");

    await writeAgentTranscript(brainDir, UUID_1, content);
    const result = await readAntigravityTranscript(UUID_1, {
      brainDir,
      env: {},
      homeDir: isolatedHome,
    });

    assert.ok(result);
    assert.equal(result.resolvedModel, "gemini-4-neon-high");
    assert.equal(result.resolvedEffort, "high");
    assert.equal(result.resolvedTier, "stronger");
    assert.equal(result.turns, 2);
    assert.deepEqual(result.tokens, {
      input: 2000,
      cacheRead: 1000,
      output: 200,
      cacheHitRate: 0.5,
      truncated: false,
    });
  });
});

test("5. 비-Antigravity 호스트·비-UUID·빈 파일·손상 파일·권한 오류에서 예외 없이 null 반환", async () => {
  await withTempBrain(async ({ base, brainDir, isolatedHome }) => {
    const missingBrainDir = join(base, "does-not-exist");

    assert.equal(
      await readAntigravityTranscript(UUID_1, { brainDir: missingBrainDir, env: {}, homeDir: isolatedHome }),
      null,
    );

    for (const invalidId of ["main", "../etc/passwd", "worker-1", UUID_1.toUpperCase(), ""]) {
      assert.equal(
        await readAntigravityTranscript(invalidId, { brainDir, env: {}, homeDir: isolatedHome }),
        null,
      );
    }

    // 빈 파일
    await writeAgentTranscript(brainDir, UUID_1, "");
    assert.equal(
      await readAntigravityTranscript(UUID_1, { brainDir, env: {}, homeDir: isolatedHome }),
      null,
    );

    // 손상 JSON 파일
    await writeAgentTranscript(brainDir, UUID_2, "{corrupt json\n[broken\n");
    assert.equal(
      await readAntigravityTranscript(UUID_2, { brainDir, env: {}, homeDir: isolatedHome }),
      null,
    );

    // PLANNER_RESPONSE가 없는 정상 JSONL 파일
    await writeAgentTranscript(
      brainDir,
      UUID_3,
      `${JSON.stringify({ type: "USER_INPUT", content: "hello" })}\n`,
    );
    assert.equal(
      await readAntigravityTranscript(UUID_3, { brainDir, env: {}, homeDir: isolatedHome }),
      null,
    );

    // transcript.jsonl 자리가 디렉터리인 경우
    const dirAgent = makeUuid(10);
    await mkdir(join(brainDir, dirAgent, ".system_generated", "logs", "transcript.jsonl"), { recursive: true });
    assert.equal(
      await readAntigravityTranscript(dirAgent, { brainDir, env: {}, homeDir: isolatedHome }),
      null,
    );

    // 읽기 권한이 없는 파일 (root가 아닌 경우에만 검증)
    if (typeof process.getuid === "function" && process.getuid() !== 0) {
      const lockedAgent = makeUuid(11);
      const lockedFile = await writeAgentTranscript(
        brainDir,
        lockedAgent,
        `${JSON.stringify({ type: "PLANNER_RESPONSE", model: "gemini-3.8-flash-high", input_tokens: 10 })}\n`,
      );
      await chmod(lockedFile, 0o000);
      try {
        assert.equal(
          await readAntigravityTranscript(lockedAgent, { brainDir, env: {}, homeDir: isolatedHome }),
          null,
        );
      } finally {
        await chmod(lockedFile, 0o644);
      }
    }
  });
});

test("6. 심볼릭 링크 방어: <uuid> 디렉터리·중간 경로·transcript.jsonl 심볼릭 링크 모두 거부", async () => {
  await withTempBrain(async ({ base, brainDir, isolatedHome }) => {
    const externalDir = join(base, "external-secret");
    const externalLogs = join(externalDir, ".system_generated", "logs");
    await mkdir(externalLogs, { recursive: true });
    const externalTranscript = join(externalLogs, "transcript.jsonl");
    await writeFile(
      externalTranscript,
      `${JSON.stringify({
        type: "PLANNER_RESPONSE",
        model: "gemini-4-hydrogen-tiered-xhigh",
        input_tokens: 100,
        output_tokens: 20,
      })}\n`,
      "utf8",
    );

    // 6-1. <uuid> 디렉터리 자체가 심볼릭 링크
    await symlink(externalDir, join(brainDir, UUID_1));
    assert.equal(
      await readAntigravityTranscript(UUID_1, { brainDir, env: {}, homeDir: isolatedHome }),
      null,
    );

    // 6-2. transcript.jsonl 파일이 심볼릭 링크
    const logsDir2 = join(brainDir, UUID_2, ".system_generated", "logs");
    await mkdir(logsDir2, { recursive: true });
    await symlink(externalTranscript, join(logsDir2, "transcript.jsonl"));
    assert.equal(
      await readAntigravityTranscript(UUID_2, { brainDir, env: {}, homeDir: isolatedHome }),
      null,
    );

    // 6-3. 중간 디렉터리(logs)가 심볼릭 링크
    const sysGenDir3 = join(brainDir, UUID_3, ".system_generated");
    await mkdir(sysGenDir3, { recursive: true });
    await symlink(externalLogs, join(sysGenDir3, "logs"));
    assert.equal(
      await readAntigravityTranscript(UUID_3, { brainDir, env: {}, homeDir: isolatedHome }),
      null,
    );
  });
});

test("7. 4 MiB tail-read 트렁케이션: 선두 잘린 줄 폐기·꼬리 파싱·truncated=true 설정", async () => {
  // parseTranscriptLines 직접 트렁케이션 단위 검증
  const slicedInput = [
    '{"type":"PLANNER_RESPONSE","model":"gemini-3.5-flash-lite","input_tokens":99999}',
    JSON.stringify({
      type: "PLANNER_RESPONSE",
      model: "gemini-4-hydrogen-tiered-xhigh",
      input_tokens: 300,
      cache_read_tokens: 150,
      output_tokens: 50,
    }),
    '{"type":"PLANNER_RESPONSE","model":"incomplete',
  ].join("\n");

  const directParsed = parseTranscriptLines(slicedInput, { truncated: true });
  assert.ok(directParsed);
  assert.equal(directParsed.resolvedModel, "gemini-4-hydrogen-tiered-xhigh");
  assert.equal(directParsed.turns, 1);
  assert.deepEqual(directParsed.tokens, {
    input: 300,
    cacheRead: 150,
    output: 50,
    cacheHitRate: 0.5,
    truncated: true,
  });

  // 실제 > 4 MiB 파일 기반 tail-read 검증
  await withTempBrain(async ({ brainDir, isolatedHome }) => {
    const earlyLine = JSON.stringify({
      step_index: 0,
      type: "PLANNER_RESPONSE",
      model: "gemini-3.5-flash-lite",
      input_tokens: 999999,
      output_tokens: 99999,
    });
    const tailLine1 = JSON.stringify({
      step_index: 100,
      type: "PLANNER_RESPONSE",
      model: "gemini-4-neon-medium",
      input_tokens: 400,
      cache_read_tokens: 100,
      output_tokens: 40,
    });
    const tailLine2 = JSON.stringify({
      step_index: 101,
      type: "PLANNER_RESPONSE",
      model: "gemini-4-hydrogen-tiered-xhigh",
      input_tokens: 600,
      cache_read_tokens: 400,
      output_tokens: 60,
    });

    const paddingChunk = JSON.stringify({
      type: "GENERIC",
      content: "x".repeat(4000),
    });
    const padUnitBytes = Buffer.byteLength(`${paddingChunk}\n`, "utf8");

    // 4 MiB tail 경계가 반드시 이 줄의 중간을 자르도록 앞쪽에 배치해 선두 폐기를 검증한다.
    const boundarySlicedLine = JSON.stringify({
      type: "PLANNER_RESPONSE",
      model: "gemini-3.5-flash-lite",
      padding: "p".repeat(64 * 1024),
      input_tokens: 777777,
    });

    const prefixText = `${earlyLine}\n`;
    const suffixText = `${tailLine1}\n${tailLine2}\n`;
    const targetAfterBoundaryBytes = MAX_TRANSCRIPT_BYTES - 32 * 1024;
    const suffixBytes = Buffer.byteLength(suffixText, "utf8");
    const repeatCount = Math.floor((targetAfterBoundaryBytes - suffixBytes) / padUnitBytes);
    const fillerParts = [];
    for (let i = 0; i < repeatCount; i += 1) {
      fillerParts.push(paddingChunk);
    }
    const afterBoundaryText = `\n${fillerParts.join("\n")}\n${suffixText}`;
    const fullContent = `${prefixText}${boundarySlicedLine}${afterBoundaryText}`;
    const totalSize = Buffer.byteLength(fullContent, "utf8");
    assert.ok(totalSize > MAX_TRANSCRIPT_BYTES);

    // tail offset은 boundarySlicedLine 안쪽에 위치해야 한다.
    const tailOffset = totalSize - MAX_TRANSCRIPT_BYTES;
    const boundaryStart = Buffer.byteLength(prefixText, "utf8");
    const boundaryEnd = boundaryStart + Buffer.byteLength(boundarySlicedLine, "utf8");
    assert.ok(tailOffset > boundaryStart && tailOffset < boundaryEnd);

    await writeAgentTranscript(brainDir, UUID_1, fullContent);
    const result = await readAntigravityTranscript(UUID_1, {
      brainDir,
      env: {},
      homeDir: isolatedHome,
    });

    assert.ok(result);
    assert.equal(result.resolvedModel, "gemini-4-hydrogen-tiered-xhigh");
    assert.equal(result.resolvedEffort, "xhigh");
    assert.equal(result.resolvedTier, "stronger");
    assert.equal(result.turns, 2);
    assert.deepEqual(result.tokens, {
      input: 1000,
      cacheRead: 500,
      output: 100,
      cacheHitRate: 0.5,
      truncated: true,
    });
  });
});

test("8. LRU 캐시 히트, mtime/size 무효화 및 64엔트리 상한 축출 검증", async () => {
  await withTempBrain(async ({ brainDir, isolatedHome }) => {
    const cache = new Map();
    const filePath = await writeAgentTranscript(
      brainDir,
      UUID_1,
      `${JSON.stringify({
        type: "PLANNER_RESPONSE",
        model: "gemini-3.8-flash-medium",
        input_tokens: 100,
        cache_read_tokens: 20,
        output_tokens: 10,
      })}\n`,
    );

    const first = await readAntigravityTranscript(UUID_1, {
      brainDir,
      env: {},
      homeDir: isolatedHome,
      cache,
    });
    assert.ok(first);
    assert.equal(cache.size, 1);
    assert.equal(first.turns, 1);
    assert.equal(first.tokens.input, 100);

    // 호출자가 반환 객체를 변이시켜도 캐시가 오염되지 않아야 한다.
    first.tokens.input = 999999;
    const second = await readAntigravityTranscript(UUID_1, {
      brainDir,
      env: {},
      homeDir: isolatedHome,
      cache,
    });
    assert.equal(second.tokens.input, 100);

    // 파일 내용 및 mtime 변경 시 캐시가 무효화되고 새 토큰을 반영해야 한다.
    const updatedContent = [
      JSON.stringify({
        type: "PLANNER_RESPONSE",
        model: "gemini-3.8-flash-medium",
        input_tokens: 100,
        cache_read_tokens: 20,
        output_tokens: 10,
      }),
      JSON.stringify({
        type: "PLANNER_RESPONSE",
        model: "gemini-4-hydrogen-tiered-xhigh",
        input_tokens: 300,
        cache_read_tokens: 180,
        output_tokens: 40,
      }),
    ].join("\n") + "\n";
    await writeFile(filePath, updatedContent, "utf8");
    const futureTime = new Date(Date.now() + 5000);
    await utimes(filePath, futureTime, futureTime);

    const third = await readAntigravityTranscript(UUID_1, {
      brainDir,
      env: {},
      homeDir: isolatedHome,
      cache,
    });
    assert.ok(third);
    assert.equal(third.turns, 2);
    assert.equal(third.resolvedModel, "gemini-4-hydrogen-tiered-xhigh");
    assert.equal(third.tokens.input, 400);
    assert.equal(third.tokens.cacheRead, 200);
    assert.equal(third.tokens.output, 50);

    // LRU 64개 상한 + 히트 시 순서 갱신 검증
    const lruCache = new Map();
    const uuids = [];
    for (let i = 1; i <= MAX_CACHE_ENTRIES + 1; i += 1) {
      const id = makeUuid(i);
      uuids.push(id);
      await writeAgentTranscript(
        brainDir,
        id,
        `${JSON.stringify({ type: "PLANNER_RESPONSE", model: "gemini-3.8-flash-high", input_tokens: i })}\n`,
      );
    }

    for (let i = 0; i < MAX_CACHE_ENTRIES; i += 1) {
      await readAntigravityTranscript(uuids[i], {
        brainDir,
        env: {},
        homeDir: isolatedHome,
        cache: lruCache,
      });
    }
    assert.equal(lruCache.size, MAX_CACHE_ENTRIES);

    // 첫 번째 항목을 다시 읽어 MRU로 올리면 두 번째 항목이 가장 오래된 항목이 된다.
    await readAntigravityTranscript(uuids[0], {
      brainDir,
      env: {},
      homeDir: isolatedHome,
      cache: lruCache,
    });

    // 65번째 항목 삽입 시 두 번째 항목이 축출되고 첫 번째 항목은 유지된다.
    await readAntigravityTranscript(uuids[MAX_CACHE_ENTRIES], {
      brainDir,
      env: {},
      homeDir: isolatedHome,
      cache: lruCache,
    });
    assert.equal(lruCache.size, MAX_CACHE_ENTRIES);

    const cachedKeys = Array.from(lruCache.keys());
    assert.equal(cachedKeys.some((key) => key.includes(uuids[0])), true);
    assert.equal(cachedKeys.some((key) => key.includes(uuids[1])), false);
    assert.equal(cachedKeys.some((key) => key.includes(uuids[MAX_CACHE_ENTRIES])), true);
  });
});

test("9. enrichTasksWithTranscripts 비변이 동작 및 동일 assignedAgentId 중복 합산 방지 검증", async () => {
  await withTempBrain(async ({ brainDir, isolatedHome }) => {
    await writeAgentTranscript(
      brainDir,
      UUID_1,
      `${JSON.stringify({
        type: "PLANNER_RESPONSE",
        model: "gemini-4-hydrogen-tiered-xhigh",
        input_tokens: 1000,
        cache_read_tokens: 400,
        output_tokens: 100,
      })}\n`,
    );
    await writeAgentTranscript(
      brainDir,
      UUID_2,
      [
        JSON.stringify({
          type: "PLANNER_RESPONSE",
          model: "gemini-3.8-flash-high",
          input_tokens: 500,
          cache_read_tokens: 100,
          output_tokens: 50,
        }),
        JSON.stringify({
          type: "PLANNER_RESPONSE",
          model: "gemini-3.8-flash-high",
          input_tokens: 500,
          cache_read_tokens: 100,
          output_tokens: 50,
        }),
      ].join("\n") + "\n",
    );

    const tasks = Object.freeze([
      Object.freeze({ id: "t1", title: "Task 1", assignedAgentId: UUID_1 }),
      Object.freeze({ id: "t2", title: "Task 2 (shared agent)", assignedAgentId: UUID_1 }),
      Object.freeze({ id: "t3", title: "Task 3", assignedAgentId: UUID_2 }),
      Object.freeze({ id: "t4", title: "Main task", assignedAgentId: "main" }),
      Object.freeze({ id: "t5", title: "Unassigned task", assignedAgentId: null }),
      Object.freeze({ id: "t6", title: "Missing transcript", assignedAgentId: UUID_3 }),
    ]);

    const { enrichedByTaskId, agentStats } = await enrichTasksWithTranscripts(tasks, {
      brainDir,
      env: {},
      homeDir: isolatedHome,
    });

    assert.deepEqual(Object.keys(enrichedByTaskId).sort(), ["t1", "t2", "t3"]);
    assert.equal(enrichedByTaskId.t1.resolvedModel, "gemini-4-hydrogen-tiered-xhigh");
    assert.equal(enrichedByTaskId.t2.resolvedModel, "gemini-4-hydrogen-tiered-xhigh");
    assert.notEqual(enrichedByTaskId.t1, enrichedByTaskId.t2);
    assert.equal(enrichedByTaskId.t3.resolvedModel, "gemini-3.8-flash-high");
    assert.equal(enrichedByTaskId.t3.turns, 2);

    // UUID_1이 t1, t2에 공통 할당돼도 agentStats는 2개 에이전트(UUID_1 + UUID_2)만 합산한다.
    assert.deepEqual(agentStats, {
      enrichedAgents: 2,
      totalTurns: 3,
      totalInputTokens: 2000,
      totalCacheReadTokens: 600,
      totalOutputTokens: 200,
    });

    // 빈 목록/비배열 입력 폴백 검증
    const emptyRes = await enrichTasksWithTranscripts(null, { brainDir, env: {}, homeDir: isolatedHome });
    assert.deepEqual(emptyRes, {
      enrichedByTaskId: {},
      agentStats: {
        enrichedAgents: 0,
        totalTurns: 0,
        totalInputTokens: 0,
        totalCacheReadTokens: 0,
        totalOutputTokens: 0,
      },
    });
  });
});
