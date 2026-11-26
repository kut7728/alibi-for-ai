const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { test } = require("node:test");
const { assertRun } = require("../dist/report");

test("v1 accepts optional evidence and arbitrary JSON, and rejects invalid records", () => {
  const id = randomUUID();
  const run = {
    formatVersion: 1,
    id,
    title: "Sample",
    createdAt: new Date().toISOString(),
    git: { branch: null, baseSha: null, headSha: "a".repeat(64) },
    platform: "ios",
    steps: [{ id, order: 1, action: "Tap", after: "screenshots/after.png", note: "", result: "pass" }],
    checks: [{ id, target: "validate", input: null, before: [false], after: {}, expected: 42, result: "pass" }],
    verdict: "pass",
    summary: "Verified.",
  };
  assert.doesNotThrow(() => assertRun(run, "test"));
  assert.doesNotThrow(() => assertRun({
    ...run,
    endedAt: run.createdAt,
    git: { ...run.git, dirty: false },
    steps: [{ ...run.steps[0], createdAt: run.createdAt }],
    checks: [{ ...run.checks[0], createdAt: run.createdAt, after: undefined, error: "TypeError" }],
  }, "test"));
  const [step] = run.steps;
  for (const invalid of [
    { ...run, formatVersion: 2 },
    { ...run, createdAt: "yesterday" },
    { ...run, createdAt: "2026-02-31T00:00:00.000Z" },
    { ...run, git: { ...run.git, headSha: "short" } },
    { ...run, git: { ...run.git, dirty: "false" } },
    { ...run, verdict: undefined },
    { ...run, endedAt: "yesterday" },
    { ...run, summary: "two\nlines" },
    { ...run, summary: "trailing newline\n" },
    { ...run, steps: [{ ...step, after: undefined }] },
    { ...run, steps: [{ ...step, after: "../outside.png" }] },
    { ...run, steps: [{ ...step, createdAt: "yesterday" }] },
    { ...run, checks: [{ ...run.checks[0], before: undefined }] },
    { ...run, checks: [{ ...run.checks[0], after: undefined }] },
  ]) {
    assert.throws(() => assertRun(invalid, "test"), /invalid run format/);
  }
});
