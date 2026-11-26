import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startGoal } from "../scripts/pota-goal.mjs";
import { runStateResult } from "../scripts/pota-state.mjs";
import { detectCompletionClaim, stopHookOutput } from "../scripts/pota-state-hook.mjs";

const sentence = (claim) => ` Your last message claims completion ("${claim}"), but Pota has no record of it: correct that statement for the user or record the evidence.`;

test("detects English and Korean completion claims", () => {
  assert.equal(detectCompletionClaim("All tests pass."), "All tests pass");
  assert.match(detectCompletionClaim("Work done. The migration is now complete!"), /is now complete/);
  assert.match(detectCompletionClaim("구현을 마쳤습니다."), /구현을 마쳤습니다/);
  assert.match(detectCompletionClaim("확인 결과 모두 통과했습니다"), /모두 통과/);
});

test("negated, future, and unfinished sentences are not claims", () => {
  for (const text of [
    "Tests are not passing yet",
    "I will mark it complete after review",
    "아직 완료되지 않았습니다",
    "검증한 뒤 완료하겠습니다",
  ]) assert.equal(detectCompletionClaim(text), null, text);
});

test("claims inside code or quotes are ignored", () => {
  assert.equal(detectCompletionClaim("```\nAll tests pass.\n```"), null);
  assert.equal(detectCompletionClaim("Run `all tests pass` later"), null);
  assert.equal(detectCompletionClaim("> All tests pass."), null);
});

test("invalid input and long claims", () => {
  for (const value of [undefined, null, 42, {}, "", "   "]) assert.equal(detectCompletionClaim(value), null);
  const claim = detectCompletionClaim(`${"word ".repeat(40)}is complete.`);
  assert.ok(claim.length <= 60);
  assert.equal(detectCompletionClaim("x".repeat(5000) + "\u0007 done"), null);
});

test("claim sentence is appended only when the stop blocks", () => {
  const gate = { block: true, reason: "Goal active." };
  assert.deepEqual(stopHookOutput(gate, {}, { claim: "All tests pass" }), { decision: "block", reason: `Goal active.${sentence("All tests pass")}` });
  assert.deepEqual(stopHookOutput(gate, {}, { claim: null }), { decision: "block", reason: "Goal active." });
  assert.deepEqual(stopHookOutput({ block: false }, {}, { claim: "x" }), { continue: true });
  const guarded = stopHookOutput(gate, { stop_hook_active: true }, { claim: "All tests pass" });
  assert.equal(guarded.continue, true);
  assert.ok(guarded.systemMessage.includes(sentence("All tests pass")));
});

test("stop hook receipt integrates with goal state", async () => {
  await withTempRoot(async (root) => {
    const message = "All tests pass and the work is complete.";
    const stop = (extra = {}, options = {}) => runStateResult("stop", { root, locale: "en-US", payload: { session_id: "s1", ...extra }, ...options });
    assert.deepEqual((await stop({ last_assistant_message: message })).hookOutput, { continue: true });
    await startGoal({ root, goal: "Ship", planId: "docs/plan/x.md", ownerSessionId: "s1", tasks: [{ id: "t", title: "T" }] });
    const claimed = await stop({ last_assistant_message: message });
    assert.equal(claimed.hookOutput.decision, "block");
    assert.match(claimed.hookOutput.reason, /Your last message claims completion \("All tests pass/);
    assert.ok(claimed.message.includes("Your last message claims completion"));
    assert.ok(!(await stop({})).hookOutput.reason.includes("claims completion"));
    const off = await stop({ last_assistant_message: message }, { claimReceipt: { enabled: false } });
    assert.ok(!off.hookOutput.reason.includes("claims completion"));
  });
});

async function withTempRoot(work) {
  const root = await mkdtemp(join(tmpdir(), "pota-claim-receipt-"));
  const stateHome = `${root}-home`;
  const previous = process.env.POTA_HOME;
  process.env.POTA_HOME = stateHome;
  try {
    await work(root);
  } finally {
    if (previous === undefined) delete process.env.POTA_HOME;
    else process.env.POTA_HOME = previous;
    await rm(root, { recursive: true, force: true });
    await rm(stateHome, { recursive: true, force: true });
  }
}

test("advice and progress sentences are not claims", () => {
  for (const text of [
    "I implemented the parser and am now writing tests",
    "X를 구현했습니다",
    "Tests passed for module A, now starting module B",
    "Unverified: tests passed",
    "Next, I verified the parser",
  ]) assert.equal(detectCompletionClaim(text), null, text);
});

test("completion claims stay detected", () => {
  for (const text of [
    "All tests pass and the work is complete.",
    "The migration is now complete.",
    "All done!",
    "Implementation complete",
    "구현을 마쳤고 테스트가 모두 통과했습니다",
    "작업 완료",
    "완료했습니다",
  ]) assert.ok(detectCompletionClaim(text), text);
});

test("truncation never splits a surrogate pair", () => {
  const claim = detectCompletionClaim(`All tests pass ${"😀".repeat(40)}`);
  assert.ok(claim);
  assert.ok(!/[\ud800-\udbff]$/.test(claim));
});
