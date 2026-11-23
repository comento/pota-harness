import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readmes = ["README.md", "README.ko.md", "README.ja.md", "README.zh.md", "README.es.md", "README.fr.md", "README.de.md", "README.pt.md"];
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("every readme documents the plugin install, update, and uninstall commands of the three hosts", async () => {
  for (const path of readmes) {
    const readme = await read(path);
    for (const command of [
      "claude plugin marketplace add comento/pota-harness",
      "claude plugin install pota@pota-harness",
      "claude plugin marketplace update pota-harness",
      "claude plugin update pota@pota-harness",
      "claude plugin uninstall pota@pota-harness",
      "codex plugin marketplace add comento/pota-harness",
      "codex plugin marketplace upgrade pota-harness",
      "agy plugin install https://github.com/comento/pota-harness",
      "agy plugin uninstall pota",
    ]) {
      assert.ok(readme.includes(command), `${path} ${command}`);
    }
    assert.match(readme, /^## Install$/m, `${path} install section (the CLI's removed commands link to #install)`);
    assert.ok(readme.includes("`/plugins`"), `${path} Codex /plugins`);
  }
});

test("every readme tells Codex users to approve the hooks in /hooks after install and after every update", async () => {
  for (const path of readmes) {
    const codex = section(await read(path), "### Codex");
    assert.ok((codex.match(/`\/hooks`/g) ?? []).length >= 3, `${path} /hooks approval at install and update`);
  }
});

test("every readme covers the move from the npm install", async () => {
  for (const path of readmes) {
    const readme = await read(path);
    for (const needle of [
      "claude plugin uninstall pota@pota --scope user",
      "POTA_LEGACY_MIGRATION=0",
      "~/.pota/projects/",
      "~/.pota/config.json",
      "symlinked-path",
      "host-unregister-failed",
      "migrate status",
      "migrate run --host claude --dry-run",
      "npx @comento/pota-harness@1.5.0 uninstall",
      "npm uninstall -g @comento/pota-harness",
      "`Pota CLI:`",
      "scripts/pota.mjs\" doctor",
      // The 1.x uninstall refuses once a host's part is gone; the per-host rerun replaces it.
      "Refusing to uninstall modified managed artifacts",
      "scripts/pota.mjs\" migrate run --host <host>`",
      // A host left on 1.x cannot upgrade after another host's part is removed.
      "Managed artifact was modified",
    ]) {
      assert.ok(readme.includes(needle), `${path} ${needle}`);
    }
    assert.match(section(readme, "### Coming from the npm install (1.x)"), /^2\. \*\*[^*]+\*\* /m, `${path} the every-host step stands out`);
    assert.match(readme, /1\.5\.0/, `${path} last npm version`);
    assert.match(readme, /deprecated/, `${path} npm package deprecated`);
  }
});

test("every readme has the host feature table and names the Antigravity IDE as unsupported", async () => {
  for (const path of readmes) {
    const readme = await read(path);
    const table = section(readme, "### What each host gets");
    for (const needle of ["`/pota:pota-plan`", "`$pota-plan`", "`/pota-plan`", "SubagentStop", "PreInvocation", "`explorer`", "DAG"]) {
      assert.ok(table.includes(needle), `${path} feature table ${needle}`);
    }
    assert.match(readme, /Antigravity[- ]IDE|IDE (?:de |do |d')?Antigravity/, `${path} Antigravity IDE scope`);
  }
});

test("no readme documents the removed npm installer", async () => {
  for (const path of readmes) {
    const readme = await read(path);
    for (const removed of ["pota install", "pota upgrade", "pota uninstall", "--hosts", "--allow-downgrade", "bunx @comento/pota-harness", "@comento/pota-harness@latest", "~/.pota/install/runtime", "POTA_AUTO_UPGRADE"]) {
      assert.equal(readme.includes(removed), false, `${path} still mentions ${removed}`);
    }
    assert.doesNotMatch(readme, /auto-upgrade/i, `${path} auto-upgrade`);
    // The only npx command left is the 1.5.0 uninstall that the refused-removal notice also prints.
    for (const match of readme.matchAll(/npx @comento\/pota-harness[^\s`]*(?: [^\s`]+)?/g)) {
      assert.equal(match[0], "npx @comento/pota-harness@1.5.0 uninstall", `${path} ${match[0]}`);
    }
  }
});

function section(text, heading) {
  const start = text.indexOf(`\n${heading}\n`);
  assert.ok(start >= 0, `missing ${heading}`);
  const rest = text.slice(start + heading.length + 2);
  const end = rest.search(/^#{2,3} /m);
  return end === -1 ? rest : rest.slice(0, end);
}
