const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { cp, mkdir, mkdtemp, rm, symlink, writeFile } = require("node:fs/promises");
const { get } = require("node:http");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");
const { promisify } = require("node:util");
const { startViewer } = require("../dist/viewer");
const sample = require("../examples/cart-rounding/run.json");

const invalidId = "10000000-0000-0000-0000-000000000000";
const otherId = "20000000-0000-0000-0000-000000000000";
const hostileTitle = "<img src=x onerror=alert(1)> Basket";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "alibai-viewer-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runs = join(root, ".alibai", "runs");
  const directory = join(runs, sample.id);
  await cp(join(__dirname, "../examples/cart-rounding"), directory, { recursive: true });
  const run = { ...sample, title: hostileTitle };
  await writeFile(join(directory, "run.json"), JSON.stringify(run));
  await mkdir(join(runs, invalidId));
  await writeFile(join(runs, invalidId, "run.json"), "invalid JSON");
  const { server, url } = await startViewer(root);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { url, root, runs, directory, server, run };
}

test("viewer serves v1 evidence and invalid runs over loopback", async (t) => {
  const { url, server, run } = await fixture(t);
  assert.equal(server.address().address, "127.0.0.1");
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy"), /script-src 'self'/);
  assert.match(await response.text(), /<main id="app"/);
  for (const asset of ["tokens.css", "viewer.css", "viewer.js"]) {
    assert.equal((await fetch(url + asset)).status, 200);
  }
  const list = await (await fetch(url + "api/runs")).json();
  assert.deepEqual(list.runs, [run]);
  assert.deepEqual(list.invalidRuns.map(({ id }) => id), [invalidId]);
  assert.match(list.invalidRuns[0].error, /invalid JSON/);
  for (const headers of [{ Host: "example.com" }, { "Sec-Fetch-Site": "cross-site" }]) {
    const status = await new Promise((resolve, reject) => {
      get(url + "api/runs", { headers }, (response) => {
        response.resume();
        resolve(response.statusCode);
      }).on("error", reject);
    });
    assert.equal(status, 403);
  }
  assert.equal((await fetch(url + "api/runs", { method: "POST" })).status, 405);
});

test("viewer serves only supported referenced images inside their owning run", async (t) => {
  const { url, runs, directory, root, run } = await fixture(t);
  const shots = join(directory, "screenshots");
  await writeFile(join(shots, "unreferenced.png"), "private");
  await writeFile(join(shots, "file.svg"), "<svg></svg>");
  run.steps.push({ ...run.steps[0], before: "screenshots/file.svg", after: "screenshots/link.png" });
  await writeFile(join(directory, "run.json"), JSON.stringify(run));
  await mkdir(join(runs, otherId, "screenshots"), { recursive: true });
  await writeFile(join(runs, otherId, "run.json"), JSON.stringify({ ...run, id: otherId, steps: [] }));
  await writeFile(join(runs, otherId, "screenshots", "after.png"), "private");
  if (process.platform !== "win32") {
    await writeFile(join(root, "outside.png"), "private");
    await symlink(join(root, "outside.png"), join(shots, "link.png"));
  }
  const response = await fetch(url + `screenshots/${run.id}/after.png`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(Buffer.from(await response.arrayBuffer()).subarray(1, 4).toString(), "PNG");
  for (const path of [
    "package.json", "run.json", "src/viewer.ts",
    `screenshots/${run.id}/unreferenced.png`, `screenshots/${run.id}/file.svg`,
    `screenshots/${run.id}/link.png`, `screenshots/${otherId}/after.png`,
    `screenshots/${run.id}/%2E%2E%2Foutside.png`,
  ]) {
    assert.equal((await fetch(url + path)).status, 404, path);
  }
  if (process.platform !== "win32") {
    await rm(shots, { recursive: true });
    await symlink(join(runs, otherId, "screenshots"), shots, "dir");
    assert.equal((await fetch(url + `screenshots/${run.id}/after.png`)).status, 404);
  }
});

const chromium = process.env.ALIBAI_TEST_CHROMIUM;
test("viewer renders case files and exhibits in Chromium", { skip: !chromium, timeout: 25000 }, async (t) => {
  const { url, root } = await fixture(t);
  const dump = async (path, profile) => (await promisify(execFile)(chromium, [
    "--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--virtual-time-budget=3000", "--dump-dom", `--user-data-dir=${join(root, profile)}`, url + path,
  ], { timeout: 10000 })).stdout;
  const list = await dump("", "list-profile");
  assert.match(list, /1 invalid run skipped/);
  assert.match(list, /&lt;img src=x onerror=alert\(1\)&gt; Basket/);
  assert.doesNotMatch(list, /<img\b/);
  assert.match(list, /Alibi broken/);
  const detail = await dump(`#case/${sample.id}`, "detail-profile");
  assert.match(detail, /type="range"/);
  assert.match(detail, /No screenshot recorded/);
  assert.match(detail, /<pre>null<\/pre>/);
  assert.match(detail, /Not recorded/);
  assert.match(detail, /ASSERT_EQ_FAILED/);
  assert.match(detail, /Add Grid Linen.*calcTotal\(items\).*applyCoupon\(code, total\).*Open the basket drawer/s);
});
