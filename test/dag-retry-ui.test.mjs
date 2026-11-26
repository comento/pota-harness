import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderDagAppHtml } from "../scripts/pota-dag-app-html.mjs";
import * as dagText from "../hooks/dag-text.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("DAG MCP App은 blocked task에만 retry_task 버튼을 노출한다", () => {
  const html = renderDagAppHtml();
  assert.match(html, /dag-retry-btn/);
  assert.match(html, /runDagAction\("retry_task", task\.id\)/);
  assert.match(html, /task\.status === "blocked"[\s\S]{0,200}dag-retry-btn/);
  assert.match(html, /retry: "재시도"/);
  assert.match(html, /retry: "Retry"/);
  assert.match(html, /retryHint: "막힌 task를 다시 배정 대기로 되돌립니다"/);
  assert.match(html, /retryHint: "Return this blocked task to the queue for a fresh dispatch"/);
  assert.match(html, /if \(typeof enabled === "boolean"\) args\.enabled = enabled;/);
});

test("hooks/dag-text.mjs ko/en 모두 retry 문구를 가진다", () => {
  const words = dagText.messages;
  assert.equal(typeof words, "function");
  for (const lang of ["ko", "en"]) {
    const w = words(lang);
    assert.equal(typeof w.retry, "string");
    assert.ok(w.retry.length > 0);
    assert.equal(typeof w.retryHint, "string");
  }
});

test("Claude Code mod은 blocked task에만 goal retry --task를 실행한다", async () => {
  const src = await readFile(join(root, "hooks", "register.tsx"), "utf8");
  assert.match(src, /task\.status === "blocked"[\s\S]{0,200}retry-\$\{task\.id\}/);
  assert.match(src, /"goal",\s*"retry",\s*"--task",\s*task\.id/);
});
