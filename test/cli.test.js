const assert = require("node:assert/strict");
const { execFile, execFileSync, spawnSync } = require("node:child_process");
const { createHash, randomUUID } = require("node:crypto");
const { mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, truncateSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { dirname, join } = require("node:path");
const { test } = require("node:test");
const { promisify } = require("node:util");

const cli = join(__dirname, "../dist/cli.js");
const exec = promisify(execFile);

function repo(t) {
  const cwd = mkdtempSync(join(tmpdir(), "alibai-test-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  git(cwd, "init", "--initial-branch=main");
  return cwd;
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function commit(cwd, message) {
  git(cwd, "-c", "user.email=test@example.com", "-c", "user.name=Test",
    "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

function run(cwd, ...args) {
  return JSON.parse(execFileSync(process.execPath, [cli, ...args, "--json"], { cwd, encoding: "utf8" }));
}

function fail(cwd, args, message, env = process.env) {
  const child = spawnSync(process.execPath, [cli, "--json", ...args], { cwd, env, encoding: "utf8" });
  assert.equal(child.status, 1);
  assert.equal(child.stdout, "");
  assert.match(JSON.parse(child.stderr).error, message);
}

function read(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assertTimestamp(value) {
  assert.equal(new Date(value).toISOString(), value);
}

function addUntrackedToHash(hash, path, bytes, kind = "f") {
  return hash.update(`${kind}${Buffer.byteLength(path)}\n`).update(path)
    .update(createHash("sha256").update(bytes).digest());
}

test("CLI validates the viewer language option", (t) => {
  const cwd = repo(t);
  fail(cwd, ["open", "--lang", "ja-JP"], /--lang must be one of en, ko, ja/);
  fail(cwd, ["open", "--lang", "KO"], /--lang must be one of en, ko, ja/);
  fail(cwd, ["open", "--lang"], /--lang requires a value/);
  fail(cwd, ["list", "--lang", "ko"], /Unknown option '--lang'/);
  assert.match(run(cwd, "open", "--help").usage, /alibai open \[--lang <en\|ko\|ja>\]/);
});

test("CLI records evidence from a subdirectory and completes the run", (t) => {
  const cwd = repo(t);
  const base = commit(cwd, "base");
  git(cwd, "switch", "-c", "feature");
  const head = commit(cwd, "head");
  const nested = join(cwd, "nested");
  mkdirSync(nested);
  const before = Buffer.from([0, 1, 2]);
  const after = Buffer.from([3, 4, 5]);
  writeFileSync(join(nested, "before image.png"), before);
  writeFileSync(join(nested, "after image.png"), after);

  assert.deepEqual(run(nested, "list"), { runs: [], invalidRuns: [] });
  const started = run(nested, "run", "start", "--title", "Login", "--platform", "flutter", "--agent", "Codex");
  const { id, path } = started;
  assert.equal(path, join(git(cwd, "rev-parse", "--show-toplevel"), ".alibai", "runs", id, "run.json"));
  const paths = ["nested/after image.png", "nested/before image.png"];
  const hash = createHash("sha256").update("0\n0\n");
  addUntrackedToHash(hash, paths[0], after);
  addUntrackedToHash(hash, paths[1], before);
  const changes = { paths, diffSha256: hash.digest("hex") };
  assert.deepEqual(read(path).git, { branch: "feature", baseSha: base, headSha: head, dirty: true, startChanges: changes });
  assert.equal(read(path).agent, "Codex");
  assert.equal(git(cwd, "check-ignore", path), path);
  assert.deepEqual(run(nested, "step", "--action", "Tap sign in", "--before", "before image.png",
    "--after", "after image.png", "--note", "Uses a test account", "--result", "pass"), started);
  assert.deepEqual(run(nested, "step", "--action", "Open home", "--after", "after image.png"), started);
  assert.deepEqual(run(cwd, "check", "--run", id, "--target", "parseAge", "--input", '{"age":"1"}',
    "--before=-1", "--after", "1", "--expected", "1", "--error", "RangeError", "--result", "fail"), started);
  assert.deepEqual(run(cwd, "run", "end", "--verdict", "pass", "--summary", "Login verified."), started);

  const recorded = read(path);
  assert.deepEqual(recorded.git.endChanges, changes);
  assert.equal(recorded.formatVersion, 1);
  assert.equal(recorded.platform, "flutter");
  assert.deepEqual(recorded.steps.map((step) => step.order), [1, 2]);
  assert.equal(recorded.steps[0].note, "Uses a test account");
  assert.equal(recorded.steps[0].result, "pass");
  assert.equal(recorded.steps[1].note, "");
  assert.equal(recorded.steps[1].result, "info");
  assert.equal(recorded.steps[1].before, undefined);
  assertTimestamp(recorded.steps[0].createdAt);
  assert.deepEqual(readFileSync(join(dirname(path), recorded.steps[0].before)), before);
  assert.deepEqual(readFileSync(join(dirname(path), recorded.steps[0].after)), after);
  assert.notEqual(recorded.steps[0].after, recorded.steps[1].after);
  const { createdAt: checkedAt, ...check } = recorded.checks[0];
  assertTimestamp(checkedAt);
  assert.deepEqual(check, {
    id: check.id, target: "parseAge", input: { age: "1" },
    before: -1, after: 1, expected: 1, error: "RangeError", result: "fail",
  });
  assert.equal(recorded.verdict, "pass");
  assert.equal(recorded.summary, "Login verified.");
  assertTimestamp(recorded.endedAt);
  assert.deepEqual(run(cwd, "list"), {
    runs: [{ id, path, title: "Login", createdAt: recorded.createdAt, platform: "flutter", verdict: "pass" }],
    invalidRuns: [],
  });
  fail(cwd, ["run", "end", "--run", id, "--verdict", "pass"], /already completed/);
});

test("dirty snapshots hash staged and worktree patches independently from a linked worktree", (t) => {
  const cwd = repo(t);
  mkdirSync(join(cwd, ".alibai"));
  writeFileSync(join(cwd, ".alibai", "hidden.txt"), "old evidence");
  writeFileSync(join(cwd, ".gitignore"), "*.ignored\n");
  writeFileSync(join(cwd, "tracked.bin"), Buffer.from([0, 1]));
  writeFileSync(join(cwd, "staged.txt"), "committed");
  git(cwd, "add", ".");
  const head = commit(cwd, "project");
  const worktree = join(cwd, "linked");
  git(cwd, "worktree", "add", "-b", "linked", worktree);
  const nested = join(worktree, "nested");
  mkdirSync(nested);
  writeFileSync(join(cwd, "only-in-main.txt"), "not part of the linked worktree");

  const untracked = process.platform === "win32" ? "untracked.txt" : "new\tline\n.jp.txt";
  writeFileSync(join(nested, untracked), "untracked contents");
  writeFileSync(join(nested, "local.ignored"), "ignored");
  writeFileSync(join(worktree, ".alibai", "hidden.txt"), "private evidence");
  writeFileSync(join(worktree, "tracked.bin"), Buffer.from([0, 2]));
  writeFileSync(join(worktree, "staged.txt"), "staged payload");
  git(worktree, "add", "staged.txt");
  // The worktree cancels the index change, so a single diff against HEAD would omit staged.txt.
  writeFileSync(join(worktree, "staged.txt"), "committed");

  const expectedHash = (...paths) => {
    const patch = (...args) => execFileSync("git", ["diff", "--binary", "--full-index", "--no-ext-diff", "--no-textconv",
      "--no-color", "--no-renames", "--no-relative", "--submodule=short", "--src-prefix=a/", "--dst-prefix=b/",
      ...args, "--", ...paths], { cwd: worktree });
    const staged = patch("--cached", head);
    const unstaged = patch();
    const hash = createHash("sha256").update(`${staged.length}\n${unstaged.length}\n`).update(staged).update(unstaged);
    return addUntrackedToHash(hash, `nested/${untracked}`, "untracked contents").digest("hex");
  };
  const expectedStart = expectedHash("staged.txt", "tracked.bin");
  const { id, path } = run(nested, "run", "start", "--title", "Linked worktree");
  const start = read(path).git;
  assert.equal(start.branch, "linked");
  assert.equal(start.headSha, head);
  assert.deepEqual(start.startChanges, {
    paths: [`nested/${untracked}`, "staged.txt", "tracked.bin"], diffSha256: expectedStart,
  });
  assert.equal(Object.hasOwn(start, "endChanges"), false);

  writeFileSync(join(worktree, "tracked.bin"), Buffer.from([0, 3]));
  writeFileSync(join(worktree, "added.txt"), "new");
  git(worktree, "add", "added.txt");
  const expectedEnd = expectedHash("added.txt", "staged.txt", "tracked.bin");
  run(nested, "run", "end", "--run", id, "--verdict", "pass");
  const end = read(path).git;
  assert.deepEqual(end.startChanges, start.startChanges);
  assert.deepEqual(end.endChanges.paths, ["added.txt", `nested/${untracked}`, "staged.txt", "tracked.bin"]);
  assert.equal(end.endChanges.diffSha256, expectedEnd);
  assert.notEqual(end.endChanges.diffSha256, expectedStart);
  assert.doesNotMatch(readFileSync(path, "utf8"), /staged payload|untracked contents|private evidence|GIT binary patch/);
});

test("dirty snapshots include untracked binary bytes and paths, with a per-file limit", (t) => {
  const cwd = repo(t);
  writeFileSync(join(cwd, ".gitignore"), "*.ignored\n");
  git(cwd, "add", ".gitignore");
  commit(cwd, "initial");
  const small = Buffer.from([0, 0xff, 1]);
  writeFileSync(join(cwd, "new.bin"), small);
  const { id, path } = run(cwd, "run", "start", "--title", "Untracked binary");
  const first = read(path).git.startChanges.diffSha256;
  assert.match(first, /^[0-9a-f]{64}$/);
  const expected = addUntrackedToHash(createHash("sha256").update("0\n0\n"), "new.bin", small).digest("hex");
  assert.equal(first, expected);

  writeFileSync(join(cwd, "new.bin"), Buffer.from([0, 0xff, 2]));
  run(cwd, "run", "end", "--run", id, "--verdict", "pass");
  const last = read(path).git.endChanges;
  assert.deepEqual(last.paths, ["new.bin"]);
  assert.match(last.diffSha256, /^[0-9a-f]{64}$/);
  assert.notEqual(last.diffSha256, first);

  const snapshot = () => read(run(cwd, "run", "start", "--title", "Snapshot").path).git.startChanges;
  renameSync(join(cwd, "new.bin"), join(cwd, "renamed.bin"));
  const renamed = snapshot();
  assert.match(renamed.diffSha256, /^[0-9a-f]{64}$/);
  assert.notEqual(renamed.diffSha256, last.diffSha256);
  for (const file of ["large.ignored", ".alibai/large.bin"]) {
    const excluded = join(cwd, file);
    writeFileSync(excluded, "");
    truncateSync(excluded, 32 * 1024 * 1024 + 1);
  }
  assert.deepEqual(snapshot(), renamed);
  truncateSync(join(cwd, "renamed.bin"), 32 * 1024 * 1024);
  assert.match(snapshot().diffSha256, /^[0-9a-f]{64}$/);
  truncateSync(join(cwd, "renamed.bin"), 32 * 1024 * 1024 + 1);
  writeFileSync(join(cwd, "other.txt"), "also changed");
  assert.deepEqual(snapshot(), { paths: ["other.txt", "renamed.bin"], diffSha256: null });
});

test("untracked symlinks hash link text without reading external targets", { skip: process.platform === "win32" }, (t) => {
  const cwd = repo(t);
  const external = repo(t);
  commit(cwd, "initial");
  const target = join(external, "outside");
  const link = join(cwd, "link");
  writeFileSync(target, "external");
  truncateSync(target, 32 * 1024 * 1024 + 1);
  symlinkSync(target, link);
  const { path, id } = run(cwd, "run", "start", "--title", "Symlink");
  const digest = (text) => addUntrackedToHash(createHash("sha256").update("0\n0\n"), "link", text, "l").digest("hex");
  assert.deepEqual(read(path).git.startChanges, { paths: ["link"], diffSha256: digest(target) });
  const replacement = `${external}/./outside`;
  rmSync(link);
  symlinkSync(replacement, link);
  run(cwd, "run", "end", "--run", id, "--verdict", "pass");
  assert.deepEqual(read(path).git.endChanges, { paths: ["link"], diffSha256: digest(replacement) });
});

test("staged and worktree patches hash consistently across Git diff settings", (t) => {
  const cwd = repo(t);
  const files = ["a.txt", "z-é.txt"];
  const original = Array.from({ length: 20 }, (_, index) => index % 4 === 2 ? "" : `row ${index}`);
  const write = (lines) => files.forEach((file) => writeFileSync(join(cwd, file), lines.join("\n") + "\n"));
  write(original);
  git(cwd, "add", ".");
  commit(cwd, "initial");
  const staged = original.with(1, "staged").with(10, "also staged");
  write(staged);
  git(cwd, "add", ".");
  write(staged.with(3, "unstaged").with(16, "also unstaged"));
  const { path, id } = run(cwd, "run", "start", "--title", "Git configuration");
  const before = read(path).git.startChanges;
  assert.match(before.diffSha256, /^[0-9a-f]{64}$/);
  const preConfig = [git(cwd, "diff"), git(cwd, "diff", "--cached")];
  writeFileSync(join(cwd, ".git", "test-diff-order"), "z-*\na.txt\n");
  for (const [key, value] of Object.entries({
    "diff.orderFile": ".git/test-diff-order", "diff.noprefix": "true", "diff.mnemonicPrefix": "true",
    "color.diff": "always", "diff.context": "1", "diff.interHunkContext": "10", "diff.indentHeuristic": "false",
    "diff.algorithm": "histogram", "diff.renames": "copies", "diff.suppressBlankEmpty": "true",
    "core.quotePath": "false", "core.abbrev": "5", "core.bigFileThreshold": "1",
  })) git(cwd, "config", key, value);
  assert.notEqual(git(cwd, "diff"), preConfig[0]);
  assert.notEqual(git(cwd, "diff", "--cached"), preConfig[1]);
  execFileSync(process.execPath, [cli, "run", "end", "--run", id, "--verdict", "pass", "--json"], {
    cwd, env: { ...process.env, GIT_DIFF_OPTS: "--unified=0" },
  });
  assert.deepEqual(read(path).git.endChanges, before);
});

test("the start and end snapshots independently handle clean and unborn states", (t) => {
  const cwd = repo(t);
  const { id, path } = run(cwd, "run", "start", "--title", "Clean start");
  assert.equal(Object.hasOwn(read(path).git, "startChanges"), false);
  writeFileSync(join(cwd, "staged.txt"), "first edit");
  git(cwd, "add", "staged.txt");
  const dirty = run(cwd, "run", "start", "--title", "Unborn dirty");
  assert.deepEqual(read(dirty.path).git.startChanges, { paths: ["staged.txt"], diffSha256: null });
  run(cwd, "run", "end", "--run", id, "--verdict", "pass");
  assert.equal(read(path).git.dirty, false);
  assert.deepEqual(read(path).git.endChanges, { paths: ["staged.txt"], diffSha256: null });
  commit(cwd, "initial");
  run(cwd, "run", "end", "--run", dirty.id, "--verdict", "pass");
  assert.equal(Object.hasOwn(read(dirty.path).git, "endChanges"), false);
});

test("Git read errors preserve run evidence and retain any readable paths", { skip: process.platform === "win32" }, (t) => {
  const cwd = repo(t);
  const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const bin = mkdtempSync(join(tmpdir(), "alibai-git-shim-"));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  writeFileSync(join(bin, "git"), [
    "#!/bin/sh",
    "for arg do",
    '  if [ "$arg" = "$ALIBAI_FAIL_GIT_COMMAND" ]; then printf "partial output"; exit 1; fi',
    "done",
    'exec "$ALIBAI_REAL_GIT" "$@"',
  ].join("\n"), { mode: 0o700 });
  const invoke = (command, ...args) => JSON.parse(execFileSync(process.execPath, [cli, ...args, "--json"], {
    cwd, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`,
      ALIBAI_REAL_GIT: realGit, ALIBAI_FAIL_GIT_COMMAND: command },
  }));
  const head = commit(cwd, "initial");
  writeFileSync(join(cwd, "staged.txt"), "content");
  git(cwd, "add", "staged.txt");
  const { id, path } = invoke("diff", "run", "start", "--title", "Unavailable diff");
  assert.deepEqual(read(path).git.startChanges, { paths: ["staged.txt"], diffSha256: null });
  invoke("status", "run", "end", "--run", id, "--verdict", "pass");
  assert.equal(read(path).git.endChanges, null);
  assert.equal(read(path).verdict, "pass");
  const missingStatus = invoke("status", "run", "start", "--title", "Unavailable status");
  assert.deepEqual(read(missingStatus.path).git, { branch: "main", baseSha: null, headSha: head, startChanges: null });
});

test("CLI handles an unborn branch, detached HEAD, and explicit run or base", (t) => {
  const cwd = repo(t);
  const first = run(cwd, "run", "start", "--title", "Unborn");
  assert.deepEqual(read(first.path).git, { branch: "main", baseSha: null, headSha: null, dirty: false });
  assert.equal(read(first.path).platform, "web");
  assert.equal(read(first.path).agent, undefined);

  const head = commit(cwd, "only commit");
  git(cwd, "checkout", "--quiet", "--detach");
  const second = run(cwd, "run", "start", "--title", "Detached");
  assert.deepEqual(read(second.path).git, { branch: null, baseSha: null, headSha: head, dirty: false });
  const third = run(cwd, "run", "start", "--title", "Explicit base", "--base", "main");
  assert.deepEqual(read(third.path).git, { branch: null, baseSha: head, headSha: head, dirty: false });
  assert.deepEqual(run(cwd, "list").runs.map((entry) => entry.id), [third.id, second.id, first.id]);
  run(cwd, "run", "end", "--run", first.id, "--verdict", "info");
  assert.equal(read(first.path).summary, "Verdict recorded as info.");
  assert.equal(read(second.path).verdict, undefined);
  fail(cwd, ["run", "start", "--title", "Bad base", "--base", "missing"], /does not resolve/);
});

test("check records exceptions without after and preserves explicit JSON null", (t) => {
  const cwd = repo(t);
  const { path } = run(cwd, "run", "start", "--title", "Exceptions");
  const args = ["check", "--target", "parse", "--input", "null", "--before", "false"];
  fail(cwd, args, /Provide --after with a JSON value or --error for an exception/);
  run(cwd, ...args, "--error", "TypeError");
  run(cwd, ...args, "--after", "null");
  const [exception, ordinary] = read(path).checks;
  assert.equal(exception.error, "TypeError");
  assert.equal(Object.hasOwn(exception, "after"), false);
  assert.equal(ordinary.after, null);
});

test("discovery reports invalid runs and keeps implicit recording usable", (t) => {
  const cwd = repo(t);
  const started = run(cwd, "run", "start", "--title", "Healthy");
  const invalid = [randomUUID(), randomUUID(), randomUUID()].sort();
  const [missing, malformed, nonFile] = invalid.map((id) => {
    const directory = join(dirname(dirname(started.path)), id);
    mkdirSync(directory);
    return join(directory, "run.json");
  });
  writeFileSync(malformed, "not JSON");
  mkdirSync(nonFile);
  const listed = spawnSync(process.execPath, [cli, "list", "--json"], { cwd, encoding: "utf8" });
  assert.equal(listed.status, 0);
  assert.equal(listed.stderr, "");
  const { runs, invalidRuns } = JSON.parse(listed.stdout);
  assert.deepEqual(runs.map(({ id }) => id), [started.id]);
  assert.deepEqual(invalidRuns.map(({ id, path }) => ({ id, path })),
    invalid.map((id, index) => ({ id, path: [missing, malformed, nonFile][index] })));
  assert.match(invalidRuns[0].error, /ENOENT/);
  assert.match(invalidRuns[1].error, /invalid JSON/);
  assert.match(invalidRuns[2].error, /Expected a regular file/);

  writeFileSync(join(cwd, "after.png"), "test image");
  const step = spawnSync(process.execPath, [cli, "step", "--action", "Tap", "--after", "after.png"], {
    cwd, encoding: "utf8",
  });
  assert.equal(step.status, 0);
  assert.match(step.stdout, new RegExp(started.id));
  assert.match(step.stderr, /Skipping invalid run/);
  assert.deepEqual(run(cwd, "check", "--target", "parse", "--input", "null", "--before", "false", "--after", "true"), started);
  assert.deepEqual(run(cwd, "run", "end", "--verdict", "pass"), started);
  assert.equal(read(started.path).verdict, "pass");
  const human = spawnSync(process.execPath, [cli, "list"], { cwd, encoding: "utf8" });
  assert.equal(human.status, 0);
  assert.match(human.stdout, /Healthy/);
  assert.match(human.stderr, /Skipping invalid run/);
});

test("JSON mutations warn when implicit selection skips a newer damaged run", (t) => {
  const cwd = repo(t);
  const older = run(cwd, "run", "start", "--title", "Older");
  const newer = run(cwd, "run", "start", "--title", "Newer");
  writeFileSync(newer.path, "not JSON");
  writeFileSync(join(cwd, "after.png"), "test image");
  const stepArgs = ["step", "--action", "Tap", "--after", "after.png"];
  const checkArgs = ["check", "--target", "parse", "--input", "null", "--before", "null", "--after", "true"];
  const invoke = (args) => spawnSync(process.execPath, [cli, "--json", ...args], { cwd, encoding: "utf8" });

  const explicit = invoke([...checkArgs, "--run", older.id]);
  assert.equal(explicit.status, 0);
  assert.deepEqual(JSON.parse(explicit.stdout), older);
  assert.equal(explicit.stderr, "");

  for (const args of [stepArgs, checkArgs, ["run", "end", "--verdict", "pass"]]) {
    const implicit = invoke(args);
    assert.equal(implicit.status, 0);
    assert.deepEqual(JSON.parse(implicit.stdout), older);
    assert.match(implicit.stderr, /Skipping invalid run/);
    assert.ok(implicit.stderr.includes(newer.path));
  }
  assert.equal(read(older.path).verdict, "pass");
  assert.equal(readFileSync(newer.path, "utf8"), "not JSON");
});

test("a timed-out writer leaves the lock untouched and reports manual recovery", (t) => {
  const cwd = repo(t);
  const { path } = run(cwd, "run", "start", "--title", "Locked");
  const lock = join(dirname(path), ".lock");
  mkdirSync(lock);
  const preload = join(cwd, "advance-clock.cjs");
  writeFileSync(preload, "let now = Date.now(); Date.now = () => (now += 6000);");
  fail(cwd, ["run", "end", "--verdict", "info"],
    /If all writers for this run have exited, remove the empty lock with rmdir -- '/,
    { ...process.env, NODE_OPTIONS: `--require="${preload}"` });
  assert.deepEqual(readdirSync(lock), []);
  assert.equal(read(path).verdict, undefined);
});

test("global flags are recognized only in option positions", (t) => {
  const cwd = repo(t);
  const started = run(cwd, "run", "start", "--title=--json", "--agent", "--help");
  assert.equal(read(started.path).title, "--json");
  assert.equal(read(started.path).agent, "--help");
  const help = run(cwd, "step", "-h");
  assert.match(help.usage, /^Usage/);
  const literal = spawnSync(process.execPath, [cli, "run", "start", "--title", "--json"], {
    cwd, encoding: "utf8",
  });
  assert.equal(literal.status, 0);
  assert.equal(read(literal.stdout.trim().split("\t")[1]).title, "--json");
  fail(cwd, ["list", "--", "--help", "--json"], /Unexpected argument "--help"/);
});

test("bad flags and copy or write failures leave the existing record intact", (t) => {
  const cwd = repo(t);
  const { path } = run(cwd, "run", "start", "--title", "Failure cases");
  const previous = readFileSync(path);
  const screenshots = join(dirname(path), "screenshots");
  writeFileSync(join(cwd, "ok.png"), "test image");
  fail(cwd, ["step", "--action", "Tap"], /at least one screenshot/);
  fail(cwd, ["step", "--action", "Tap", "--before", "ok.png", "--after", "unsupported.svg"],
    /Screenshot must use a PNG, JPG, JPEG, or WebP extension/);
  fail(cwd, ["step", "--action", "Tap", "--before", "ok.png", "--after", "absent.png"], /Screenshot was not found/);
  fail(cwd, ["check", "--target", "T", "--input", "nope", "--before", "null", "--after", "null"], /--input: invalid JSON/);
  fail(cwd, ["run", "end", "--verdict", "pass", "--summary", "two\nlines"], /one non-empty line/);
  fail(cwd, ["run", "end", "--verdict", "pass", "--run", "../outside"], /run UUID/);
  fail(cwd, ["list", "--title", "unexpected"], /Unknown option/);

  const preload = join(cwd, "fail-write.cjs");
  writeFileSync(preload, `
    const fs = require("node:fs/promises");
    const rename = fs.rename;
    fs.rename = (source, destination) => destination.endsWith("run.json")
      ? Promise.reject(Object.assign(new Error("simulated write failure"), { code: "EIO" }))
      : rename(source, destination);
  `);
  fail(cwd, ["step", "--action", "Tap", "--before", "ok.png"], /simulated write failure/,
    { ...process.env, NODE_OPTIONS: `--require="${preload}"` });
  assert.deepEqual(readFileSync(path), previous);
  assert.deepEqual(readdirSync(screenshots), []);
  assert.deepEqual(readdirSync(dirname(path)).sort(), ["run.json", "screenshots"]);

  writeFileSync(preload, `
    const fs = require("node:fs/promises");
    fs.rmdir = () => Promise.reject(new Error("simulated cleanup failure"));
  `);
  fail(cwd, ["step", "--action", "Tap", "--after", "absent.png"], /Screenshot was not found/,
    { ...process.env, NODE_OPTIONS: `--require="${preload}"` });
});

test("parallel CLI writers preserve every check and keep step order consecutive", async (t) => {
  const cwd = repo(t);
  const { id, path } = run(cwd, "run", "start", "--title", "Concurrent");
  writeFileSync(join(cwd, "after.png"), "test image");
  await Promise.all(Array.from({ length: 12 }, (_, index) => {
    const args = index % 2 === 0
      ? ["step", "--action", String(index), "--after", "after.png"]
      : ["check", "--target", String(index), "--input", "null", "--before", "null", "--after", "[]"];
    return exec(process.execPath, [cli, ...args, "--run", id], { cwd });
  }));
  const recorded = read(path);
  assert.deepEqual(recorded.steps.map((step) => step.order), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(recorded.steps.map((step) => Number(step.action)).sort((a, b) => a - b), [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(recorded.checks.map((check) => Number(check.target)).sort((a, b) => a - b), [1, 3, 5, 7, 9, 11]);
  assert.equal(readdirSync(join(dirname(path), "screenshots")).length, 6);
});
