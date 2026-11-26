const assert = require("node:assert/strict");
const { execFile, execFileSync, spawnSync } = require("node:child_process");
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

  assert.deepEqual(run(nested, "list"), { runs: [] });
  const started = run(nested, "run", "start", "--title", "Login", "--platform", "flutter", "--agent", "Codex");
  const { id, path } = started;
  assert.equal(path, join(git(cwd, "rev-parse", "--show-toplevel"), ".alibai", "runs", id, "run.json"));
  assert.deepEqual(read(path).git, { branch: "feature", baseSha: base, headSha: head });
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
  assert.deepEqual(readFileSync(join(dirname(path), recorded.steps[0].before)), before);
  assert.deepEqual(readFileSync(join(dirname(path), recorded.steps[0].after)), after);
  assert.notEqual(recorded.steps[0].after, recorded.steps[1].after);
  assert.deepEqual(recorded.checks[0], {
    id: recorded.checks[0].id, target: "parseAge", input: { age: "1" },
    before: -1, after: 1, expected: 1, error: "RangeError", result: "fail",
  });
  assert.equal(recorded.verdict, "pass");
  assert.equal(recorded.summary, "Login verified.");
  assert.deepEqual(run(cwd, "list"), {
    runs: [{ id, path, title: "Login", createdAt: recorded.createdAt, platform: "flutter", verdict: "pass" }],
  });
  fail(cwd, ["run", "end", "--run", id, "--verdict", "pass"], /already completed/);
});

test("CLI handles an unborn branch, detached HEAD, and explicit run or base", (t) => {
  const cwd = repo(t);
  const first = run(cwd, "run", "start", "--title", "Unborn");
  assert.deepEqual(read(first.path).git, { branch: "main", baseSha: null, headSha: null });
  assert.equal(read(first.path).platform, "web");
  assert.equal(read(first.path).agent, undefined);

  const head = commit(cwd, "only commit");
  git(cwd, "checkout", "--quiet", "--detach");
  const second = run(cwd, "run", "start", "--title", "Detached");
  assert.deepEqual(read(second.path).git, { branch: null, baseSha: null, headSha: head });
  const third = run(cwd, "run", "start", "--title", "Explicit base", "--base", "main");
  assert.deepEqual(read(third.path).git, { branch: null, baseSha: head, headSha: head });
  assert.deepEqual(run(cwd, "list").runs.map((entry) => entry.id), [third.id, second.id, first.id]);
  run(cwd, "run", "end", "--run", first.id, "--verdict", "info");
  assert.equal(read(first.path).summary, "Verdict recorded as info.");
  assert.equal(read(second.path).verdict, undefined);
  fail(cwd, ["run", "start", "--title", "Bad base", "--base", "missing"], /does not resolve/);
});

test("bad flags and copy or write failures leave the existing record intact", (t) => {
  const cwd = repo(t);
  const { path } = run(cwd, "run", "start", "--title", "Failure cases");
  const previous = readFileSync(path);
  const screenshots = join(dirname(path), "screenshots");
  writeFileSync(join(cwd, "ok.png"), "test image");
  fail(cwd, ["step", "--action", "Tap"], /at least one screenshot/);
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
