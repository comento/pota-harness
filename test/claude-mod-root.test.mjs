import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  ancestorPaths,
  goalCommandTarget,
  initialDagState,
  isAbsolutePath,
  joinPath,
  observeGoalCommand,
  pickRoot,
  rebaseDagState,
  shouldCheckHome,
  reduceDagState,
  rootLabel,
  samePath,
} from "../claude-mod/hooks/dag-events.mjs";

const task = (id, status, updatedAt) => ({
  id, title: `Task ${id}`, status, dependsOn: [], assignedAgentId: null, route: null, kind: null, effort: null,
  model: null, effectiveModel: null, requiredEvidence: [], evidence: [], writeScope: null, blocker: null,
  createdAt: 0, updatedAt,
});
const snapshot = (tasks) => ({
  goalId: "goal-1", title: "Goal", planId: "docs/plan/x.md", status: "active", blocker: null, revision: 1,
  createdAt: 0, requiredEvidence: [], evidence: [], tasks,
});

test("1. isAbsolutePath", () => {
  for (const path of ["/a", "C:\\a", "c:/a", "\\\\srv\\share"]) assert.equal(isAbsolutePath(path), true, path);
  for (const path of ["a/b", "./a", "", "~/a"]) assert.equal(isAbsolutePath(path), false, path);
});

test("2. joinPath", () => {
  assert.equal(joinPath("/repo", "sub"), "/repo/sub");
  assert.equal(joinPath("/repo/a", "../b"), "/repo/b");
  assert.equal(joinPath("/repo", "/abs/x/"), "/abs/x");
  assert.equal(joinPath("/repo", "."), "/repo");
  assert.equal(joinPath("/", ".."), "/");
  assert.equal(joinPath("/repo//a/", "./b/./c"), "/repo/a/b/c");
  assert.equal(joinPath("C:\\repo", "sub\\x"), "C:\\repo\\sub\\x");
  assert.equal(joinPath("C:\\repo", "..\\wt"), "C:\\wt");
  assert.equal(joinPath("C:\\repo", "../../.."), "C:\\");
  assert.equal(joinPath("C:/repo", "sub"), "C:/repo/sub");
  assert.equal(joinPath("C:\\repo", "D:/x"), "D:/x");
  // R9: a UNC path's prefix is the share, so `..` stops there.
  assert.equal(joinPath("\\\\srv\\share\\x", "..\\.."), "\\\\srv\\share");
  assert.equal(joinPath("\\\\srv\\share", "a\\b"), "\\\\srv\\share\\a\\b");
});

test("3. samePath", () => {
  assert.equal(samePath("/repo", "/repo/"), true);
  assert.equal(samePath("/repo/a/..", "/repo"), true);
  assert.equal(samePath("C:\\Repo", "c:/repo"), true);
  assert.equal(samePath("/Repo", "/repo"), false);
  assert.equal(samePath(null, "/repo"), false);
  assert.equal(samePath(null, null), false);
  assert.equal(samePath("\\\\SRV\\Share\\x", "\\\\srv\\share\\X"), true);
  assert.equal(samePath("\\\\srv\\share\\a\\..", "\\\\srv\\share"), true);
});

test("4. ancestorPaths", () => {
  assert.deepEqual(ancestorPaths("/a/b/c"), ["/a/b/c", "/a/b", "/a", "/"]);
  assert.deepEqual(ancestorPaths("C:\\a\\b"), ["C:\\a\\b", "C:\\a", "C:\\"]);
  assert.deepEqual(ancestorPaths("/"), ["/"]);
  assert.deepEqual(ancestorPaths("\\\\srv\\share\\a"), ["\\\\srv\\share\\a", "\\\\srv\\share"]);
  assert.deepEqual(ancestorPaths("\\\\srv\\share"), ["\\\\srv\\share"]);
});

test("5. rootLabel", () => {
  assert.equal(rootLabel("/Users/x/wt/feature-a"), "…/wt/feature-a");
  assert.equal(rootLabel("C:\\work\\wt\\a"), "…/wt/a");
  assert.equal(rootLabel("/a/b"), "/a/b");
  assert.equal(rootLabel("/repo"), "/repo");
});

test("6. goalCommandTarget", () => {
  const at = (command, cwd = "/repo") => goalCommandTarget(command, cwd);
  assert.deepEqual(at("pota goal task --task a --status completed"), { dir: "/repo", explicitRoot: null });
  assert.deepEqual(at("cd wt/feat && node scripts/pota.mjs goal task --task a"), { dir: "/repo/wt/feat", explicitRoot: null });
  assert.deepEqual(at('cd "/abs/my wt" && pota goal start --plan p.md'), { dir: "/abs/my wt", explicitRoot: null });
  assert.deepEqual(at("cd a; cd ../b && pota goal finish"), { dir: "/repo/b", explicitRoot: null });
  assert.deepEqual(at("(cd sub && pota goal verify -- npm test)"), { dir: "/repo/sub", explicitRoot: null });
  assert.deepEqual(at("pushd wt && pota goal task --task a"), { dir: "/repo/wt", explicitRoot: null });
  assert.deepEqual(at("pota goal replan --root ../other", "/repo/main"), { dir: "/repo/main", explicitRoot: "/repo/other" });
  assert.deepEqual(at("cd pkg && pota goal task --root=. --task a"), { dir: "/repo/pkg", explicitRoot: "/repo/pkg" });
  assert.equal(at('pota goal assign --root "/a b/c"').explicitRoot, "/a b/c");
  assert.equal(at("HARNESS_REPO_ROOT=/elsewhere pota goal task --task a").explicitRoot, "/elsewhere");
  assert.equal(at("export HARNESS_REPO_ROOT=wt/x; pota goal start --plan p").explicitRoot, "/repo/wt/x");
  assert.equal(at("HARNESS_REPO_ROOT=/e pota goal task --root /r").explicitRoot, "/r");
  // W9: a --root outside the goal call is not the goal's root.
  assert.equal(at("pota toolcheck --root /tools && pota goal task --task a").explicitRoot, null);
  assert.equal(at("pota goal task --task a && git log --root /x").explicitRoot, null);
  assert.deepEqual(at("pota goal status --root /ro && cd wt && pota goal task --task a"), { dir: "/repo/wt", explicitRoot: null });
  assert.deepEqual(at("pota goal task --task a && cd /elsewhere"), { dir: "/repo", explicitRoot: null });
  assert.deepEqual(at('P=/x/pota.mjs; cd wt && node "$P" goal start --plan a.md'), { dir: "/repo/wt", explicitRoot: null });
  assert.deepEqual(at("cd wt\\a && pota goal task --task a", "C:\\repo"), { dir: "C:\\repo\\wt\\a", explicitRoot: null });
  // R3: a --root inside a quoted argument is not the call's.
  assert.deepEqual(at('pota goal task --task a --note "see --root /x"'), { dir: "/repo", explicitRoot: null });
  assert.equal(at('pota goal task --summary "a && b" --root /r').explicitRoot, "/r");
  assert.equal(at('pota goal task --summary "a; --root /x" --root /r').explicitRoot, "/r");
  // R4: HARNESS_REPO_ROOT counts in the goal call's own segment or when exported before it.
  assert.equal(at("HARNESS_REPO_ROOT=/a echo hi; pota goal task --task a").explicitRoot, null);
  assert.equal(at("HARNESS_REPO_ROOT=/a echo hi;pota goal task --task a").explicitRoot, null);
  assert.equal(at("cd wt && HARNESS_REPO_ROOT=/a pota goal task --task a").explicitRoot, "/a");
  assert.equal(at("env HARNESS_REPO_ROOT=/a pota goal task --task a").explicitRoot, "/a");
  assert.equal(at("cd wt;HARNESS_REPO_ROOT=/a pota goal task --task a").explicitRoot, "/a");
  assert.equal(at("export HARNESS_REPO_ROOT=/a && cd wt && pota goal task --task a").explicitRoot, "/a");
  assert.equal(at('echo "export HARNESS_REPO_ROOT=/a"; pota goal task --task a').explicitRoot, null);

  for (const command of [
    'cd "$WT" && pota goal task --task a',
    "cd ~/x && pota goal task --task a",
    "cd - && pota goal task --task a",
    "pota goal task --root $ROOT",
    "pota goal task --root ~/r",
    "cd my\\ dir && pota goal task --task a",
    // R3: a value with a stray quote cannot be read.
    "pota goal task --root /x\"y",
    "pota goal task --root=it's",
    // R4: an option of cd, not a directory.
    "cd -P wt && pota goal task --task a",
    "pushd -n wt && pota goal task --task a",
    "git status",
    "pota goal status",
  ]) assert.equal(at(command), null, command);
  assert.equal(at("pota goal task --task a", "repo"), null);
});

test("7. observeGoalCommand", () => {
  const observe = (extra) => observeGoalCommand({ pending: null, shown: "/repo", root: null, planned: false, isSubagent: false, ...extra });
  assert.deepEqual(observe({ root: "/wt", planned: true }), { root: "/wt", planned: true });
  // R1: an unknown directory is not the shown root; it carries no root of its own.
  assert.deepEqual(observe({ root: null, planned: true }), { root: null, planned: true });
  // W5: a subagent in another root does not move the pane.
  assert.equal(observe({ isSubagent: true, root: "/wt" }), null);
  const same = observe({ isSubagent: true, root: "/repo/", planned: true });
  assert.equal(same.planned, true);
  assert.ok(samePath(same.root, "/repo"));
  assert.deepEqual(observe({ isSubagent: true, root: null, planned: true }), { root: null, planned: false });
  assert.deepEqual(observe({ pending: { root: "/wt", planned: true }, root: null, planned: false }), { root: "/wt", planned: true });
  assert.deepEqual(observe({ pending: { root: "/wt", planned: false }, isSubagent: true, root: null, planned: true }), { root: "/wt", planned: false });
  assert.equal(observe({ pending: { root: "/repo", planned: true }, root: "/repo", planned: false }).planned, true);
  assert.deepEqual(observe({ pending: { root: "/a", planned: true }, root: "/b", planned: false }), { root: "/b", planned: false });
  assert.deepEqual(observe({ pending: { root: "/wt", planned: false }, isSubagent: true, root: "/wt", planned: true }), { root: "/wt", planned: true });
});

test("8. pickRoot", () => {
  const S = snapshot([task("a", "active", 1)]);
  const following = { root: "/wt", home: "/repo", snapshot: S, ended: null };
  const ended = { status: "completed", endedAt: 1 };
  assert.equal(pickRoot({ observed: null, prev: null, home: "/repo" }), "/repo");
  assert.equal(pickRoot({ observed: "/wt", prev: null, home: "/repo" }), "/wt");
  assert.equal(pickRoot({ observed: null, prev: following, home: "/repo" }), "/wt");
  // W1: the session moved, so its new root wins.
  assert.equal(pickRoot({ observed: null, prev: following, home: "/repo2" }), "/repo2");
  assert.equal(pickRoot({ observed: null, prev: { ...following, snapshot: null }, home: "/repo" }), "/repo");
  // R7: an ended goal at the followed root stays shown; shouldCheckHome decides whether home takes over.
  assert.equal(pickRoot({ observed: null, prev: { ...following, ended }, home: "/repo" }), "/wt");
  assert.equal(pickRoot({ observed: null, prev: { ...following, ended }, home: "/repo2" }), "/repo2");
  assert.equal(pickRoot({ observed: null, prev: { root: "/repo", home: "/repo", snapshot: S, ended }, home: "/repo" }), "/repo");
  // W2: a later command without --root replaces the root followed before.
  assert.equal(pickRoot({ observed: "/repo", prev: { ...following, root: "/abs" }, home: "/repo" }), "/repo");
  // R1: a goal command whose directory was unknown does not hold the pane at a root the session left.
  const seen = observeGoalCommand({ pending: null, shown: "/wt-old", root: null, planned: false, isSubagent: false });
  assert.equal(pickRoot({ observed: seen.root, prev: { ...following, root: "/wt-old" }, home: "/repo2" }), "/repo2");
});

test("8b. shouldCheckHome", () => {
  const S = snapshot([task("a", "completed", 1)]);
  const ended = { status: "completed", endedAt: 1 };
  const endedAway = { root: "/wt", home: "/repo", snapshot: S, ended };
  const check = (extra) => shouldCheckHome({ observed: null, prev: endedAway, root: "/wt", home: "/repo", ...extra });
  assert.equal(check({}), true);
  assert.equal(check({ prev: { ...endedAway, ended: null } }), false);
  assert.equal(check({ prev: { ...endedAway, snapshot: null } }), false);
  // A new observation wins, and a goal ended at home is home already.
  assert.equal(check({ observed: "/wt" }), false);
  assert.equal(check({ root: "/repo", prev: { ...endedAway, root: "/repo" } }), false);
  assert.equal(check({ prev: null }), false);
  assert.equal(check({ root: "/other" }), false);
});

test("9. rebaseDagState", () => {
  assert.equal(initialDagState().home, null);
  assert.deepEqual(rebaseDagState(null, { root: "/repo", home: "/repo" }), { ...initialDagState(), root: "/repo", home: "/repo" });

  const S = snapshot([task("a", "active", 100)]);
  const prev = reduceDagState({ ...initialDagState(), root: "/repo", home: "/repo" }, { snapshot: S, error: null, now: 500 });
  assert.equal(prev.timeline.a.activeAt, 100);
  const same = rebaseDagState(prev, { root: "/repo/", home: "/repo" });
  assert.equal(same.seq, prev.seq);
  assert.equal(same.snapshot, prev.snapshot);

  const unrooted = { ...prev, root: null };
  const kept = rebaseDagState(unrooted, { root: "/wt", home: "/repo" });
  assert.equal(kept.seq, prev.seq);
  assert.equal(kept.snapshot, prev.snapshot);
  assert.equal(kept.root, "/wt");

  const moved = rebaseDagState({ ...prev, error: "old", ended: { status: "unknown", endedAt: null } }, { root: "/wt", home: "/repo" });
  assert.deepEqual(moved, { ...initialDagState(), seq: prev.seq + 1, snapshot: null, ended: null, error: null, fetchedAt: 0, timeline: {}, root: "/wt", home: "/repo" });
  // W6: no goal in the new root reads as no goal, not as the old goal ended.
  assert.equal(reduceDagState(moved, { snapshot: null, error: null, now: 600 }).ended, null);
  // W3: a failure in the new root keeps no old snapshot.
  const failed = reduceDagState(moved, { snapshot: null, error: "boom", now: 600 });
  assert.equal(failed.snapshot, null);
  assert.equal(failed.error, "boom");
  const fresh = reduceDagState(moved, { snapshot: snapshot([task("a", "active", 900)]), error: null, now: 1000 });
  assert.equal(fresh.seq, prev.seq + 2);
  assert.equal(fresh.timeline.a.activeAt, 900);
});

test("10. dag-events.mjs keeps to the source constraints", () => {
  const source = readFileSync(join(resolve("claude-mod"), "hooks", "dag-events.mjs"), "utf8");
  for (const banned of ["node:", "process", "require(", "import(", "Date.now", "setTimeout", "Intl"]) {
    assert.equal(source.includes(banned), false, `dag-events.mjs contains ${banned}`);
  }
});
