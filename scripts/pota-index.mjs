import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { parseRootArgs } from "./pota-paths.mjs";
import { assertNoSymlinkComponents, safeMkdir, safeWriteFile } from "./pota-safe-fs.mjs";
import { INDEX_TEMPLATES } from "./pota-state-init.mjs";

export const INDEX_SCHEMA_VERSION = 1;
export const INDEX_LIMITS = Object.freeze({
  summary: 120,
  line: 200,
  name: 64,
  rootLines: 120,
  rootBytes: 16_384,
  indexBytes: 262_144,
  completedKeep: 20,
  hookEntries: 64,
  noteHeadBytes: 4_096,
  noteHeadLines: 20,
});
export const INDEX_USAGE = Object.freeze({
  memory: "Usage: pota memory [check|index] [--root PATH] [--strict] [--dry-run]",
  plan: "Usage: pota plan [check|index] [--root PATH] [--strict] [--dry-run] [--archive]",
});

const KINDS = Object.freeze({
  memory: Object.freeze({ index: "MEMORY.md", directory: "docs/memory", noun: "notes" }),
  plan: Object.freeze({ index: "PLAN.md", directory: "docs/plan", noun: "plans" }),
});
const ARCHIVE_PATH = "docs/plan/ARCHIVE.md";
const ARCHIVE_HEADER = [
  "# Plan Archive",
  "",
  "Older completed plan entries moved from `PLAN.md` by `pota plan index --archive`. Newest first.",
];
const SECTIONS = Object.freeze({
  domain: "Domain Knowledge",
  active: "Active Plans",
  completed: "Completed Plans",
  rules: "Planning Rules",
  legacyRules: "Legacy Planning Rules",
});
// Exact placeholder list lines written by earlier Pota init templates (en and ko).
const PLACEHOLDERS = Object.freeze({
  memory: Object.freeze([
    "- Link detailed notes under `docs/memory/`.",
    "- 자세한 기록은 `docs/memory/` 아래에 연결합니다.",
  ]),
  plan: Object.freeze([
    "- Link detailed plans under `docs/plan/`.",
    "- Move completed topics here with evidence links.",
    "- 상세 계획은 `docs/plan/` 아래에 연결합니다.",
    "- 완료된 주제는 증거 링크와 함께 이곳으로 옮깁니다.",
  ]),
});

const NAME_CHARS = "[^\\s()[\\]<>`/\\u0000-\\u001f\\u007f-\\u009f]+?";
const REFERENCE = new RegExp(`(?<![\\w./-])(?:\\./)?docs/(memory|plan)/(${NAME_CHARS})\\.md(?![\\w./-])`);
const REFERENCES = new RegExp(REFERENCE.source, "g");
const ARCHIVE_REFERENCE = new RegExp(`\\]\\((?:\\./)?(${NAME_CHARS})\\.md\\)`);
const ARCHIVE_LINK_TARGET = new RegExp(`\\]\\((?:\\./)?docs/plan/(${NAME_CHARS}\\.md)\\)`, "g");
const UNSAFE_NAME = /[\s()[\]<>`\u0000-\u001f\u007f-\u009f\u{2028}\u{2029}]/u;
// C0, DEL, C1, and the Unicode line and paragraph separators.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f\u{2028}\u{2029}]/u;
const CONTROL_CHARACTERS = new RegExp(CONTROL_CHARACTER.source, "gu");
const LIST_LINE = /^\s*[-*+]\s+/;
const TOP_LIST_LINE = /^[-*+]\s+/;
const CHECKBOX = /^\s*[-*+]\s+\[([ xX])\]/;
const FENCE_MARK = /^\s*(`{3,}|~{3,})(.*)$/;
const HEADING2 = /^## +(.+?)\s*$/;
// PLAN.md index sections: Active, Completed, and any other "... Plans" section such as Superseded Plans.
const PLAN_SECTION = /(?:^| )Plans$/;
const SECTION_BREAK = /^#{1,2} /;
const SUMMARY_LINE = /^(?:[-*>]\s*)?(?:\*\*)?Summary:(?:\*\*)?\s*(.+?)\s*$/i;
const SUMMARY_SEPARATOR = /^\s*(?::|-(?=\s)|—)\s*/;
const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

export function parseIndexEntries(text, { kind = null, archive = false } = {}) {
  const entries = [];
  let section = null;
  const fences = fenceTracker();
  const lines = String(text ?? "").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = stripCarriageReturn(lines[index]);
    if (fences.skip(line)) continue;
    const heading = HEADING2.exec(line);
    if (heading) {
      section = heading[1];
      continue;
    }
    if (!LIST_LINE.test(line)) continue;
    // ARCHIVE.md relative links are entries only in its entry region, before the first ## heading.
    const reference = findReference(line, archive && section === null);
    if (!reference) continue;
    if (kind && reference.kind !== kind) continue;
    if (isExcludedName(reference.kind, reference.name)) continue;
    entries.push({
      kind: reference.kind,
      name: reference.name,
      path: `docs/${reference.kind}/${reference.name}.md`,
      line: index + 1,
      summary: line.slice(reference.end).replace(SUMMARY_SEPARATOR, "").trim(),
      section,
      text: line,
      end: reference.end,
      references: lineReferences(line),
    });
  }
  return entries;
}

// Entries are list lines in the index sections (## Domain Knowledge, or the PLAN.md "... Plans" sections); a file
// without such a section is legacy and every list line counts. References elsewhere, and later references on an entry
// line, are mentions: they mark a file as listed but are never rewritten or checked for duplicates and dead links.
function indexReferences(text, kind) {
  const parsed = parseIndexEntries(text, { kind });
  const managed = hasIndexSection(text, kind);
  return splitReferences(parsed, kind, (entry) => !managed || isIndexSection(kind, entry.section));
}

function archiveReferences(archiveText) {
  if (archiveText === null || archiveText === undefined) return { entries: [], mentions: new Set() };
  return splitReferences(parseIndexEntries(archiveText, { kind: "plan", archive: true }), "plan", (entry) => entry.section === null);
}

function splitReferences(parsed, kind, isEntry) {
  const entries = [];
  const mentions = new Set();
  for (const entry of parsed) {
    if (isEntry(entry)) entries.push(entry);
    else mentions.add(entry.name);
    entry.references.forEach((reference, position) => {
      const self = position === 0 && reference.kind === entry.kind && reference.name === entry.name;
      if (!self && reference.kind === kind) mentions.add(reference.name);
    });
  }
  return { entries, mentions };
}

function isIndexSection(kind, section) {
  if (typeof section !== "string") return false;
  return kind === "memory" ? section === SECTIONS.domain : PLAN_SECTION.test(section);
}

function hasIndexSection(text, kind) {
  const fences = fenceTracker();
  for (const raw of String(text ?? "").split("\n")) {
    const line = stripCarriageReturn(raw);
    if (fences.skip(line)) continue;
    const heading = HEADING2.exec(line);
    if (heading && isIndexSection(kind, heading[1])) return true;
  }
  return false;
}

function lineReferences(line) {
  return [...line.matchAll(REFERENCES)]
    .map((match) => ({ kind: match[1], name: match[2] }))
    .filter((reference) => !isExcludedName(reference.kind, reference.name));
}

export function extractNoteSummary(text, name = null) {
  const value = String(text ?? "");
  for (const line of noteHeadLines(value)) {
    const match = SUMMARY_LINE.exec(line);
    if (!match || isPlaceholderValue(match[1])) continue;
    return { summary: clip(match[1], INDEX_LIMITS.summary), source: "summary", raw: match[1], tooLong: length(match[1]) > INDEX_LIMITS.summary };
  }
  const lines = value.split("\n").map(stripCarriageReturn);
  const scope = scopeParagraphLine(lines);
  if (scope) return fallbackSummary(scope, "scope");
  const first = firstBodyLine(lines);
  if (first) return fallbackSummary(first, "line");
  const title = lines.find((line) => /^# +\S/.test(line));
  if (title) {
    const cleaned = title.replace(/^# +/, "").replace(/^Domain:\s*/i, "").trim();
    if (cleaned) return fallbackSummary(cleaned, "title");
  }
  return fallbackSummary(name ?? "", name ? "name" : null);
}

export async function checkIndex(root, kind, { strict = false } = {}) {
  const snapshot = await gather(root, kind);
  if (snapshot.blocked) return finishReport(snapshot, blockedAnalysis(snapshot), strict);
  return finishReport(snapshot, analyze(snapshot, snapshot.indexText, snapshot.archiveText), strict);
}

export async function updateIndex(root, kind, { dryRun = false, archive = false, ko = false, strict = false } = {}) {
  const snapshot = await gather(root, kind);
  const changes = { changed: false, dryRun, added: [], updated: [], removedPlaceholders: 0, archived: 0, movedSections: [], placed: {} };
  if (snapshot.blocked) return { ...finishReport(snapshot, blockedAnalysis(snapshot), strict), ...changes };

  let indexText = snapshot.indexText;
  if (indexText === null && snapshot.files.length > 0) indexText = INDEX_TEMPLATES[kind][ko ? "ko" : "en"];
  let archiveText = snapshot.archiveText;
  let fenceIssue = null;

  if (indexText !== null) {
    try {
      ({ indexText, archiveText } = await applyIndexChanges(snapshot, kind, indexText, archiveText, archive, changes));
    } catch (error) {
      if (!(error instanceof UnclosedFenceError)) throw error;
      // Nothing is written: inserting inside an unclosed fence would hide the lines and grow the file on every run.
      const path = error.path ?? KINDS[kind].index;
      fenceIssue = issue("unclosed-fence", path,
        `${path} has an unclosed code fence at the insertion point; close the fence, then rerun pota ${kind} index`);
      indexText = snapshot.indexText;
      archiveText = snapshot.archiveText;
      Object.assign(changes, { added: [], updated: [], removedPlaceholders: 0, archived: 0, movedSections: [], placed: {} });
    }
  }

  const indexChanged = indexText !== snapshot.indexText;
  const archiveChanged = archiveText !== snapshot.archiveText;
  changes.changed = indexChanged || archiveChanged;
  if (changes.changed && !dryRun) {
    // Write the archive first so an interruption duplicates entries instead of losing them.
    if (archiveChanged) {
      await safeMkdir(snapshot.root, KINDS.plan.directory);
      await atomicWrite(snapshot.root, ARCHIVE_PATH, archiveText);
    }
    if (indexChanged) await atomicWrite(snapshot.root, KINDS[kind].index, indexText);
  }
  const analysis = analyze(snapshot, indexText, archiveText);
  if (fenceIssue) analysis.errors.push(fenceIssue);
  return { ...finishReport(snapshot, analysis, strict), ...changes };
}

async function applyIndexChanges(snapshot, kind, indexText, archiveText, archive, changes) {
  const lines = indexText.split("\n");
  const eol = indexText.includes("\r\n") ? "\r\n" : "\n";
  changes.removedPlaceholders = removePlaceholders(lines, kind);

  if (kind === "memory") {
    for (const entry of indexReferences(lines.join("\n"), kind).entries) {
      // A line with several references is the user's prose; replacing its tail would drop the other references.
      if (entry.references.length > 1) continue;
      const expected = expectedMemorySummary(snapshot, entry.name);
      if (expected === null || entry.summary === expected) continue;
      // Only the summary after the reference changes; a label before it and the separator stay as written.
      const line = stripCarriageReturn(lines[entry.line - 1]);
      const separator = SUMMARY_SEPARATOR.exec(line.slice(entry.end))?.[0] || ": ";
      lines[entry.line - 1] = withEol(`${line.slice(0, entry.end)}${separator}${expected}`, lines[entry.line - 1]);
      if (!changes.updated.includes(entry.name)) changes.updated.push(entry.name);
    }
  }

  const current = indexReferences(lines.join("\n"), kind);
  const stored = archiveReferences(archiveText);
  const indexed = new Set([
    ...current.entries.map((entry) => entry.name),
    ...current.mentions,
    ...stored.entries.map((entry) => entry.name),
    ...stored.mentions,
  ]);
  const missing = snapshot.files.filter((file) => !indexed.has(file.name));
  if (kind === "memory" && missing.length > 0) {
    const added = [];
    for (const file of missing) {
      const summary = extractNoteSummary(await readCapped(file.absolute, INDEX_LIMITS.indexBytes), file.name).summary;
      added.push(entryLine(kind, file.name, clipEntrySummary(kind, file.name, summary)));
      changes.added.push(file.name);
    }
    insertIntoSection(lines, SECTIONS.domain, added, { eol });
  }
  if (kind === "plan" && missing.length > 0) {
    const active = [];
    const completed = [];
    for (const file of missing) {
      const plan = describePlan(await readCapped(file.absolute, INDEX_LIMITS.indexBytes), file.name);
      const line = entryLine(kind, file.name, clipEntrySummary(kind, file.name, plan.title));
      (plan.completed ? completed : active).push(line);
      changes.placed[file.name] = plan.completed ? "completed" : "active";
      changes.added.push(file.name);
    }
    if (active.length > 0) insertIntoSection(lines, SECTIONS.active, active, { eol });
    if (completed.length > 0) insertIntoSection(lines, SECTIONS.completed, completed, { eol, top: true });
  }

  if (kind === "plan" && archive) {
    const moved = moveToArchive(lines, archiveText, eol);
    if (moved) {
      archiveText = moved.archiveText;
      changes.archived = moved.archived;
      changes.movedSections = moved.movedSections;
    }
  }
  indexText = lines.join("\n");
  return { indexText, archiveText };
}

export async function hookIndexSnapshot({ root, memory = "none", plans = false } = {}) {
  const result = { memory: null, plans: null };
  if (memory === "list" || memory === "count") {
    try {
      result.memory = await memorySnapshot(root, memory);
    } catch {
      result.memory = null;
    }
  }
  if (plans === true) {
    try {
      result.plans = await planSnapshot(root);
    } catch {
      result.plans = null;
    }
  }
  return result;
}

export function parseIndexArgs(kind, args = []) {
  if (!KINDS[kind]) throw new Error(`unknown index kind: ${kind}`);
  const { args: rest, repoRoot } = parseRootArgs(args);
  if (rest.length === 0) return { action: "guidance", root: repoRoot };
  const help = rest.includes("--help");
  const version = rest.includes("--version");
  if (help && version) throw new Error("--help and --version cannot be used together");
  if (help) return { action: "help", root: repoRoot };
  if (version) return { action: "version", root: repoRoot };
  const [command, ...flags] = rest;
  if (command.startsWith("-")) throw new Error(`unknown option: ${command}`);
  if (command !== "check" && command !== "index") throw new Error(`unknown ${kind} command: ${command}`);
  const allowed = command === "check" ? ["--strict"] : kind === "plan" ? ["--dry-run", "--archive"] : ["--dry-run"];
  for (const flag of flags) {
    if (!allowed.includes(flag)) throw new Error(`unknown option: ${flag}`);
  }
  return {
    action: command,
    root: repoRoot,
    strict: flags.includes("--strict"),
    dryRun: flags.includes("--dry-run"),
    archive: flags.includes("--archive"),
  };
}

async function gather(root, kind) {
  const spec = KINDS[kind];
  if (!spec) throw new Error(`unknown index kind: ${kind}`);
  const workspaceRoot = resolve(root);
  const rootStat = await lstat(workspaceRoot);
  if (!rootStat.isDirectory()) throw new Error(`repository root is not a directory: ${workspaceRoot}`);
  const snapshot = {
    kind,
    root: workspaceRoot,
    blocked: false,
    errors: [],
    warnings: [],
    files: [],
    fileCount: 0,
    notes: new Map(),
    indexText: null,
    archiveText: null,
  };

  const directory = await inspectPath(workspaceRoot, spec.directory, "directory");
  if (directory === "unsafe") {
    snapshot.blocked = true;
    snapshot.errors.push(issue("unsafe-path", spec.directory,
      `${spec.directory} is not a regular directory inside the repository (symlink or special file); ${spec.noun} were not read`));
  }
  const index = await inspectPath(workspaceRoot, spec.index, "file");
  if (index === "unsafe") {
    snapshot.blocked = true;
    snapshot.errors.push(issue("unsafe-path", spec.index,
      `${spec.index} is not a regular file inside the repository (symlink, special file, or over 256 KiB); index was not read`));
  }
  if (kind === "plan" && directory === "ok") {
    const archive = await inspectPath(workspaceRoot, ARCHIVE_PATH, "file");
    if (archive === "unsafe") {
      snapshot.blocked = true;
      snapshot.errors.push(issue("unsafe-path", ARCHIVE_PATH,
        `${ARCHIVE_PATH} is not a regular file inside the repository (symlink, special file, or over 256 KiB); index was not read`));
    } else if (archive === "ok") {
      snapshot.archiveText = await readCapped(join(workspaceRoot, ARCHIVE_PATH), INDEX_LIMITS.indexBytes, { whole: true });
    }
  }
  if (snapshot.blocked) return snapshot;

  if (index === "ok") snapshot.indexText = await readCapped(join(workspaceRoot, spec.index), INDEX_LIMITS.indexBytes, { whole: true });
  if (directory === "ok") {
    const scan = await scanDirectory(workspaceRoot, kind);
    snapshot.files = scan.files;
    snapshot.fileCount = scan.fileCount;
    snapshot.errors.push(...scan.errors);
    snapshot.warnings.push(...scan.warnings);
  }
  if (kind === "memory") {
    for (const file of snapshot.files) {
      snapshot.notes.set(file.name, extractNoteSummary(await readCapped(file.absolute, INDEX_LIMITS.noteHeadBytes), file.name));
    }
  }
  return snapshot;
}

async function scanDirectory(root, kind) {
  const spec = KINDS[kind];
  const result = { files: [], fileCount: 0, errors: [], warnings: [] };
  const entries = (await readdir(join(root, spec.directory), { withFileTypes: true }))
    .sort((left, right) => compareNames(left.name, right.name));
  for (const entry of entries) {
    const path = `${spec.directory}/${entry.name}`;
    if (entry.isDirectory()) {
      result.warnings.push(issue("nested-ignored", `${path}/`, `${path}/ is a subdirectory; only top-level ${spec.directory}/*.md files are indexed`));
      continue;
    }
    if (!entry.name.endsWith(".md")) continue;
    const name = entry.name.slice(0, -3);
    if (isExcludedName(kind, name)) continue;
    if (!entry.isFile()) {
      result.warnings.push(issue("skipped-non-regular", path, `${path} is not a regular file and was skipped`));
      continue;
    }
    result.fileCount += 1;
    if (isUnsafeName(name)) {
      result.errors.push(issue("unsafe-name", path,
        `${path} cannot be indexed: rename it without spaces, brackets, or backticks (max 64 characters)`));
      continue;
    }
    result.files.push({ name, path, absolute: join(root, spec.directory, entry.name) });
  }
  return result;
}

function analyze(snapshot, indexText, archiveText) {
  const { kind } = snapshot;
  const spec = KINDS[kind];
  const errors = [...snapshot.errors];
  const warnings = [...snapshot.warnings];
  if (indexText === null) {
    if (snapshot.fileCount > 0) {
      errors.unshift(issue("index-missing", spec.index,
        `${spec.index} is missing but ${spec.directory} has ${snapshot.fileCount} ${spec.noun}; run pota ${kind} index`));
    }
    return { errors, warnings, entries: 0 };
  }

  const root = indexReferences(indexText, kind);
  const stored = kind === "plan" ? archiveReferences(archiveText) : archiveReferences(null);
  const rootEntries = root.entries;
  const storedEntries = stored.entries;
  const fileNames = new Set(snapshot.files.map((file) => file.name));
  const indexed = new Set([...rootEntries, ...storedEntries].map((entry) => entry.name));
  for (const name of [...root.mentions, ...stored.mentions]) indexed.add(name);

  for (const file of snapshot.files) {
    if (!indexed.has(file.name)) {
      errors.push(issue("unindexed", file.path, `${file.path} is not listed in ${spec.index}; run pota ${kind} index`));
    }
  }
  for (const [source, entries] of [[spec.index, rootEntries], [ARCHIVE_PATH, storedEntries]]) {
    for (const entry of entries) {
      if (fileNames.has(entry.name)) continue;
      errors.push(issue("dead-link", entry.path,
        `${source} line ${entry.line} links ${entry.path}, which does not exist; fix the path or delete the line`));
    }
  }
  for (const [source, entries] of [[spec.index, rootEntries], [ARCHIVE_PATH, storedEntries]]) {
    const lines = new Map();
    for (const entry of entries) lines.set(entry.path, [...(lines.get(entry.path) ?? []), entry.line]);
    for (const [path, numbers] of lines) {
      if (numbers.length < 2) continue;
      const suffix = source === spec.index ? "" : ` of ${source}`;
      errors.push(issue("duplicate", path, `${path} is listed on lines ${numbers.join(", ")}${suffix}`));
    }
  }
  if (kind === "memory") {
    for (const entry of rootEntries) {
      // index leaves lines with several references alone, so check does not ask for a refresh it cannot make.
      if (entry.references.length > 1) continue;
      const expected = expectedMemorySummary(snapshot, entry.name);
      if (expected === null || entry.summary === expected) continue;
      errors.push(issue("stale-summary", entry.path,
        `${spec.index} line ${entry.line} is older than the Summary line of ${entry.path}; run pota memory index`));
    }
    for (const file of snapshot.files) {
      const note = snapshot.notes.get(file.name);
      if (note?.source !== "summary") {
        warnings.push(issue("summary-missing", file.path,
          `${file.path} has no Summary: line in its first ${INDEX_LIMITS.noteHeadLines} lines; add one so the index summary stays current`));
      } else if (note.tooLong) {
        warnings.push(issue("summary-too-long", file.path,
          `${file.path} has a Summary: line over ${INDEX_LIMITS.summary} characters; the index keeps a clipped copy`));
      }
    }
  }
  // Hooks print index summaries into the session context, so a control character or line separator is an error.
  for (const entry of rootEntries) {
    if (!CONTROL_CHARACTER.test(entry.summary)) continue;
    errors.push(issue("control-character", spec.index,
      `${spec.index} line ${entry.line} has a control character or line separator in its summary; replace it with a space`));
  }
  for (const entry of rootEntries) {
    if (length(entry.summary) > INDEX_LIMITS.summary) {
      warnings.push(issue("summary-too-long", spec.index,
        `${spec.index} line ${entry.line} has a summary over ${INDEX_LIMITS.summary} characters`));
    }
    const lineLength = length(entry.text);
    if (lineLength > INDEX_LIMITS.line) {
      warnings.push(issue("entry-too-long", spec.index,
        `${spec.index} line ${entry.line} is ${lineLength} characters; keep index lines at most ${INDEX_LIMITS.line} characters`));
    }
  }
  const lineCount = indexText.split("\n").length - (indexText.endsWith("\n") ? 1 : 0);
  const byteCount = Buffer.byteLength(indexText);
  if (lineCount > INDEX_LIMITS.rootLines || byteCount > INDEX_LIMITS.rootBytes) {
    warnings.push(issue("root-too-long", spec.index,
      `${spec.index} has ${lineCount} lines and ${byteCount} bytes; keep it within ${INDEX_LIMITS.rootLines} lines and ${INDEX_LIMITS.rootBytes} bytes`));
  }
  if (kind === "plan") {
    const lines = indexText.split("\n");
    const completed = sectionRange(lines, SECTIONS.completed);
    const items = completed ? topListItems(lines, completed).length : 0;
    if (items > INDEX_LIMITS.completedKeep) {
      warnings.push(issue("completed-overflow", spec.index,
        `${spec.index} has ${items} completed entries (keep ${INDEX_LIMITS.completedKeep}); run pota plan index --archive`));
    }
    if (sectionRange(lines, SECTIONS.rules)) {
      warnings.push(issue("legacy-planning-rules", spec.index,
        `${spec.index} has a ## Planning Rules section; rules live in the pota-plan skill; pota plan index --archive moves this section to docs/plan/ARCHIVE.md`));
    }
  }
  return { errors, warnings, entries: rootEntries.length + storedEntries.length };
}

function blockedAnalysis(snapshot) {
  return { errors: [...snapshot.errors], warnings: [...snapshot.warnings], entries: 0 };
}

function finishReport(snapshot, analysis, strict) {
  const spec = KINDS[snapshot.kind];
  return {
    schemaVersion: INDEX_SCHEMA_VERSION,
    kind: snapshot.kind,
    index: spec.index,
    directory: spec.directory,
    ok: analysis.errors.length === 0 && (!strict || analysis.warnings.length === 0),
    files: snapshot.fileCount,
    entries: analysis.entries,
    errors: analysis.errors,
    warnings: analysis.warnings,
  };
}

function expectedMemorySummary(snapshot, name) {
  const note = snapshot.notes.get(name);
  if (note?.source !== "summary") return null;
  return clipEntrySummary("memory", name, note.raw);
}

function moveToArchive(lines, archiveText, eol) {
  const movedLines = [];
  const completed = sectionRange(lines, SECTIONS.completed);
  let archived = 0;
  if (completed) {
    const items = topListItems(lines, completed);
    const remove = [];
    for (let position = INDEX_LIMITS.completedKeep; position < items.length; position += 1) {
      const item = items[position];
      const previous = items[position - 1];
      // Blank lines between loose items move with the later item; the gap before the first moved item is dropped.
      const gapStart = lines.slice(previous.end + 1, item.start).every(isBlank) ? previous.end + 1 : item.start;
      archived += 1;
      for (let index = gapStart; index <= item.end; index += 1) {
        if (index >= item.start || position > INDEX_LIMITS.completedKeep) {
          movedLines.push(lines[index].replace(ARCHIVE_LINK_TARGET, "]($1)"));
        }
        remove.push(index);
      }
    }
    for (const index of remove.reverse()) lines.splice(index, 1);
  }

  let rulesBlock = null;
  const rules = sectionRange(lines, SECTIONS.rules);
  if (rules) {
    // Only the section body moves: the archive's ## Legacy Planning Rules heading replaces the original heading.
    let first = rules.start + 1;
    let last = rules.end - 1;
    while (last > rules.start && isBlank(lines[last])) last -= 1;
    while (first <= last && isBlank(lines[first])) first += 1;
    rulesBlock = lines.slice(first, last + 1);
    const atEnd = rules.end === lines.length;
    lines.splice(rules.start, rules.end - rules.start);
    if (atEnd) {
      while (lines.length > 0 && isBlank(lines[lines.length - 1])) lines.pop();
      lines.push("");
    }
  }
  if (movedLines.length === 0 && !rulesBlock) return null;

  const archiveLines = archiveText === null ? [...ARCHIVE_HEADER.map((line) => withEol(line, null, eol)), ""] : archiveText.split("\n");
  const archiveEol = archiveText === null ? eol : archiveText.includes("\r\n") ? "\r\n" : "\n";
  try {
    if (movedLines.length > 0) insertArchiveEntries(archiveLines, movedLines, archiveEol);
    if (rulesBlock?.length > 0) {
      const block = [];
      if (!sectionRange(archiveLines, SECTIONS.legacyRules)) block.push(`## ${SECTIONS.legacyRules}`, "");
      appendBlock(archiveLines, [...block.map((line) => withEol(line, null, archiveEol)), ...rulesBlock], archiveEol);
    }
  } catch (error) {
    if (error instanceof UnclosedFenceError) error.path = ARCHIVE_PATH;
    throw error;
  }
  const movedSections = rulesBlock ? [SECTIONS.rules] : [];
  return { archiveText: archiveLines.join("\n"), archived, movedSections };
}

function insertArchiveEntries(lines, moved, eol) {
  let regionEnd = lines.length;
  const fences = fenceTracker();
  for (let index = 0; index < lines.length; index += 1) {
    const line = stripCarriageReturn(lines[index]);
    if (fences.skip(line)) continue;
    if (HEADING2.test(line)) {
      regionEnd = index;
      break;
    }
  }
  const items = topListItems(lines, { start: -1, end: regionEnd });
  if (items.length > 0) {
    insertLines(lines, items[0].start, moved);
    return;
  }
  insertAfterContent(lines, { start: 0, end: regionEnd }, moved, eol);
}

function insertIntoSection(lines, title, newLines, { eol, top = false }) {
  const formatted = newLines.map((line) => withEol(line, null, eol));
  const range = sectionRange(lines, title);
  if (!range) {
    appendBlock(lines, [withEol(`## ${title}`, null, eol), withEol("", null, eol), ...formatted], eol);
    return;
  }
  const listLines = [];
  const fences = fenceTracker();
  for (let index = range.start + 1; index < range.end; index += 1) {
    const line = stripCarriageReturn(lines[index]);
    if (!fences.skip(line) && LIST_LINE.test(line)) listLines.push(index);
  }
  if (listLines.length > 0 && top) {
    insertLines(lines, listLines[0], formatted);
    return;
  }
  if (listLines.length > 0) {
    const last = itemEnd(lines, listLines[listLines.length - 1], range.end);
    if (last + 1 === lines.length) ensureTrailingNewline(lines, eol);
    insertLines(lines, last + 1, formatted);
    return;
  }
  insertAfterContent(lines, range, formatted, eol);
}

// Inserts a blank-separated block after the last non-blank line of a range that has no list yet.
function insertAfterContent(lines, range, block, eol) {
  let last = Math.max(range.start, 0);
  for (let index = range.end - 1; index >= Math.max(range.start, 0); index -= 1) {
    if (!isBlank(lines[index])) {
      last = index;
      break;
    }
  }
  if (last + 1 >= lines.length) ensureTrailingNewline(lines, eol);
  const insert = [withEol("", null, eol), ...block];
  if (last + 1 < lines.length && !isBlank(lines[last + 1])) insert.push(withEol("", null, eol));
  insertLines(lines, last + 1, insert);
}

function appendBlock(lines, block, eol) {
  ensureTrailingNewline(lines, eol);
  const at = lines.length - 1;
  const insert = at > 0 && !isBlank(lines[at - 1]) ? [withEol("", null, eol), ...block] : [...block];
  insertLines(lines, at, insert);
}

class UnclosedFenceError extends Error {
  constructor() {
    super("insertion point is inside an unclosed code fence");
    this.path = null;
  }
}

// Every generated line goes through here so nothing lands inside a code fence, where no parser would see it.
function insertLines(lines, at, items) {
  const fences = fenceTracker();
  for (let index = 0; index < at; index += 1) fences.skip(lines[index]);
  if (fences.open) throw new UnclosedFenceError();
  lines.splice(at, 0, ...items);
}

// CommonMark fences: a fence closes only on a line of the same character, at least as long, with nothing after it.
// A backtick opener whose info string contains a backtick is inline code, not a fence.
function nextFence(line, fence) {
  const match = FENCE_MARK.exec(line);
  if (!match) return fence;
  const [, marks, rest] = match;
  if (fence) return marks[0] === fence.char && marks.length >= fence.length && rest.trim() === "" ? null : fence;
  if (marks[0] === "`" && rest.includes("`")) return null;
  return { char: marks[0], length: marks.length };
}

function fenceTracker() {
  let fence = null;
  return {
    // True for fence delimiter lines and every line between them.
    skip(line) {
      const inside = fence !== null;
      fence = nextFence(stripCarriageReturn(line), fence);
      return inside || fence !== null;
    },
    get open() {
      return fence !== null;
    },
  };
}

function ensureTrailingNewline(lines, eol) {
  if (lines.length === 0) {
    lines.push("");
    return;
  }
  if (lines[lines.length - 1] === "") return;
  if (eol === "\r\n" && !lines[lines.length - 1].endsWith("\r")) lines[lines.length - 1] += "\r";
  lines.push("");
}

function sectionRange(lines, title) {
  const fences = fenceTracker();
  let start = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = stripCarriageReturn(lines[index]);
    if (fences.skip(line)) continue;
    if (start === -1) {
      const heading = HEADING2.exec(line);
      if (heading && heading[1] === title) start = index;
    } else if (SECTION_BREAK.test(line)) {
      return { start, end: index };
    }
  }
  return start === -1 ? null : { start, end: lines.length };
}

function topListItems(lines, range) {
  const items = [];
  const fences = fenceTracker();
  for (let index = range.start + 1; index < range.end; index += 1) {
    const line = stripCarriageReturn(lines[index]);
    if (fences.skip(line) || !TOP_LIST_LINE.test(line)) continue;
    const end = itemEnd(lines, index, range.end);
    for (let inner = index + 1; inner <= end; inner += 1) fences.skip(lines[inner]);
    items.push({ start: index, end });
    index = end;
  }
  return items;
}

// A list item runs through its indented continuation lines, including those after blank lines (loose lists);
// a top-level list item, a heading, or any other unindented line ends it. Trailing blank lines are not part of it.
function itemEnd(lines, start, rangeEnd) {
  let end = start;
  for (let index = start + 1; index < rangeEnd; index += 1) {
    if (isBlank(lines[index])) continue;
    if (!isContinuation(lines[index])) break;
    end = index;
  }
  return end;
}

// Placeholders are removed only from the index sections, so prose sections such as ## Policy stay byte-for-byte.
function removePlaceholders(lines, kind) {
  const managed = hasIndexSection(lines.join("\n"), kind);
  let removed = 0;
  let section = null;
  const fences = fenceTracker();
  for (let index = 0; index < lines.length; index += 1) {
    const line = stripCarriageReturn(lines[index]);
    if (fences.skip(line)) continue;
    const heading = HEADING2.exec(line);
    if (heading) {
      section = heading[1];
      continue;
    }
    if (!PLACEHOLDERS[kind].includes(line) || (managed && !isIndexSection(kind, section))) continue;
    lines.splice(index, 1);
    index -= 1;
    removed += 1;
  }
  return removed;
}

function describePlan(text, name) {
  let checked = 0;
  let unchecked = 0;
  let title = null;
  const fences = fenceTracker();
  for (const raw of text.split("\n")) {
    const line = stripCarriageReturn(raw);
    if (fences.skip(line)) continue;
    if (title === null && /^# +\S/.test(line)) title = line.replace(/^# +/, "").replace(/^\S+:\s*/, "").trim();
    const box = CHECKBOX.exec(line);
    if (box) {
      if (box[1] === " ") unchecked += 1;
      else checked += 1;
    }
  }
  return { completed: checked > 0 && unchecked === 0, title: clip(title || name, INDEX_LIMITS.summary) };
}

async function memorySnapshot(root, mode) {
  const workspaceRoot = resolve(root);
  if (await inspectPath(workspaceRoot, KINDS.memory.directory, "directory") !== "ok") return null;
  const names = await hookFileNames(workspaceRoot, "memory");
  if (names.length === 0) return null;
  if (mode === "count") return { count: names.length, entries: [], drift: false };

  const index = await inspectPath(workspaceRoot, KINDS.memory.index, "file");
  if (index === "unsafe") return null;
  const fileNames = new Set(names);
  const seen = new Set();
  const entries = [];
  let drift = false;
  let mentions = new Set();
  if (index === "ok") {
    const text = await readCapped(join(workspaceRoot, KINDS.memory.index), INDEX_LIMITS.indexBytes, { whole: true });
    const references = indexReferences(text, "memory");
    mentions = references.mentions;
    for (const entry of references.entries) {
      if (!fileNames.has(entry.name)) {
        drift = true;
        continue;
      }
      if (seen.has(entry.name)) continue;
      seen.add(entry.name);
      entries.push({ name: entry.name, summary: entry.summary || null });
    }
  }
  for (const name of names) {
    if (seen.has(name)) continue;
    // A note mentioned outside ## Domain Knowledge is listed, as in pota memory check, but has no summary.
    if (!mentions.has(name)) drift = true;
    entries.push({ name, summary: null });
  }
  return { count: names.length, entries: entries.slice(0, INDEX_LIMITS.hookEntries), drift };
}

async function planSnapshot(root) {
  const workspaceRoot = resolve(root);
  const directory = await inspectPath(workspaceRoot, KINDS.plan.directory, "directory");
  if (directory === "unsafe") return null;
  const files = directory === "ok" ? (await hookFileNames(workspaceRoot, "plan")).length : 0;
  let entries = [];
  if (await inspectPath(workspaceRoot, KINDS.plan.index, "file") === "ok") {
    try {
      entries = parseIndexEntries(await readCapped(join(workspaceRoot, KINDS.plan.index), INDEX_LIMITS.indexBytes, { whole: true }), { kind: "plan" });
    } catch {
      entries = [];
    }
  }
  if (files === 0 && entries.length === 0) return null;
  const namesIn = (section) => [...new Set(entries.filter((entry) => entry.section === section).map((entry) => entry.name))];
  const archive = directory === "ok" && await inspectPath(workspaceRoot, ARCHIVE_PATH, "file") === "ok";
  return { files, active: namesIn(SECTIONS.active), latest: namesIn(SECTIONS.completed).slice(0, 3), archive };
}

async function hookFileNames(root, kind) {
  const names = [];
  for (const entry of await readdir(join(root, KINDS[kind].directory), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const name = entry.name.slice(0, -3);
    if (isExcludedName(kind, name) || isUnsafeName(name)) continue;
    names.push(name);
  }
  return names.sort(compareNames);
}

// Returns "missing", "ok", or "unsafe" without following symlinks or opening special files.
async function inspectPath(root, relativePath, type) {
  const target = join(root, relativePath);
  try {
    await assertNoSymlinkComponents(root, target);
  } catch (error) {
    if (error?.code === "POTA_SYMLINK" || error?.code === "ENOTDIR") return "unsafe";
    throw error;
  }
  let stat;
  try {
    stat = await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return "missing";
    if (error?.code === "ENOTDIR") return "unsafe";
    throw error;
  }
  if (type === "directory") return stat.isDirectory() ? "ok" : "unsafe";
  return stat.isFile() && stat.size <= INDEX_LIMITS.indexBytes ? "ok" : "unsafe";
}

async function readCapped(path, maxBytes, { whole = false } = {}) {
  const handle = await open(path, READ_FLAGS);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error(`not a regular file: ${path}`);
    if (whole && stat.size > maxBytes) throw new Error(`file is larger than ${maxBytes} bytes: ${path}`);
    const buffer = Buffer.alloc(Math.min(stat.size, maxBytes));
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    let text = buffer.subarray(0, offset).toString("utf8");
    if (!whole && stat.size > maxBytes) {
      const lastNewline = text.lastIndexOf("\n");
      text = lastNewline === -1 ? "" : text.slice(0, lastNewline + 1);
    }
    return text;
  } finally {
    await handle.close();
  }
}

async function atomicWrite(root, relativePath, text) {
  const target = join(root, relativePath);
  const temporary = join(dirname(target), `.${basename(target)}.pota-${randomUUID()}.tmp`);
  await safeWriteFile(root, temporary, text, { encoding: "utf8", flag: "wx" });
  try {
    if (await inspectPath(root, relativePath, "file") === "unsafe") {
      throw new Error(`${relativePath} is not a regular file inside the repository; index was not written`);
    }
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function findReference(line, archive) {
  const match = REFERENCE.exec(line);
  if (match) {
    const start = match.index;
    let end = start + match[0].length;
    if (line.slice(0, start).endsWith("](") && line[end] === ")") end += 1;
    else if (line[start - 1] === "`" && line[end] === "`") end += 1;
    return { kind: match[1], name: match[2], end };
  }
  if (!archive) return null;
  const relative = ARCHIVE_REFERENCE.exec(line);
  if (!relative) return null;
  return { kind: "plan", name: relative[1], end: relative.index + relative[0].length };
}

function noteHeadLines(text) {
  let head = text;
  if (Buffer.byteLength(head) > INDEX_LIMITS.noteHeadBytes) {
    head = Buffer.from(head).subarray(0, INDEX_LIMITS.noteHeadBytes).toString("utf8");
    const lastNewline = head.lastIndexOf("\n");
    head = lastNewline === -1 ? "" : head.slice(0, lastNewline + 1);
  }
  return head.split("\n").slice(0, INDEX_LIMITS.noteHeadLines).map(stripCarriageReturn);
}

function scopeParagraphLine(lines) {
  const fences = fenceTracker();
  let inScope = false;
  for (const line of lines) {
    if (fences.skip(line)) continue;
    if (/^#{1,6} /.test(line)) {
      if (inScope) return null;
      inScope = /^## +Scope\s*$/i.test(line);
      continue;
    }
    if (inScope && line.trim()) return cleanBodyLine(line);
  }
  return null;
}

function firstBodyLine(lines) {
  const fences = fenceTracker();
  for (const line of lines) {
    if (fences.skip(line) || !line.trim() || /^#{1,6} /.test(line) || SUMMARY_LINE.test(line)) continue;
    const cleaned = cleanBodyLine(line);
    if (cleaned) return cleaned;
  }
  return null;
}

function cleanBodyLine(line) {
  return line.trim().replace(/^(?:[-*+>]\s+)+/, "").trim();
}

function fallbackSummary(value, source) {
  return { summary: clip(value, INDEX_LIMITS.summary), source, raw: null, tooLong: false };
}

function entryLine(kind, name, summary) {
  return `- [${name}](docs/${kind}/${name}.md): ${summary}`;
}

// Keeps generated lines within the line limit so check and index agree on the same clipped summary.
// Control characters become spaces so generated lines never fail the control-character check.
function clipEntrySummary(kind, name, summary) {
  const budget = INDEX_LIMITS.line - length(entryLine(kind, name, ""));
  return clip(String(summary ?? "").replace(CONTROL_CHARACTERS, " ").trim(), Math.max(1, Math.min(INDEX_LIMITS.summary, budget)));
}

function clip(value, limit) {
  const characters = Array.from(String(value ?? "").trim());
  if (characters.length <= limit) return characters.join("");
  return `${characters.slice(0, limit - 1).join("")}…`;
}

function length(value) {
  return Array.from(String(value ?? "")).length;
}

function isPlaceholderValue(value) {
  return /^<.*>$/.test(value.trim());
}

function isUnsafeName(name) {
  return name.length === 0 || length(name) > INDEX_LIMITS.name || UNSAFE_NAME.test(name);
}

function isExcludedName(kind, name) {
  return name === "README" || (kind === "plan" && name === "ARCHIVE");
}

function isBlank(line) {
  return stripCarriageReturn(line).trim() === "";
}

function isContinuation(line) {
  const value = stripCarriageReturn(line);
  return value.trim() !== "" && /^\s/.test(value) && !TOP_LIST_LINE.test(value);
}

function stripCarriageReturn(line) {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

// Appends the carriage return of a CRLF file; `previous` supplies the style when `eol` is not given.
function withEol(line, previous, eol = previous?.endsWith("\r") ? "\r\n" : "\n") {
  return eol === "\r\n" ? `${line}\r` : line;
}

function compareNames(left, right) {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

function issue(code, path, message) {
  return { code, path, message };
}
