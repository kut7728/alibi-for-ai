const assert = require("node:assert/strict");
const { execFile, execFileSync, spawnSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } = require("node:fs");
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
  assert.deepEqual(read(path).git, { branch: "feature", baseSha: base, headSha: head, dirty: true });
  assert.equal(read(path).agent, "Codex");
  assert.equal(git(cwd, "check-ignore", path), path);
  assert.deepEqual(run(nested, "step", "--action", "Tap sign in", "--before", "before image.png",
    "--after", "after image.png", "--note", "Uses a test account", "--result", "pass"), started);
  assert.deepEqual(run(nested, "step", "--action", "Open home", "--after", "after image.png"), started);
  assert.deepEqual(run(cwd, "check", "--run", id, "--target", "parseAge", "--input", '{"age":"1"}',
    "--before=-1", "--after", "1", "--expected", "1", "--error", "RangeError", "--result", "fail"), started);
  assert.deepEqual(run(cwd, "run", "end", "--verdict", "pass", "--summary", "Login verified."), started);

  const recorded = read(path);
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
