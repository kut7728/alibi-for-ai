const assert = require("node:assert/strict");
const { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, relative } = require("node:path");
const { test } = require("node:test");
const { buildPages } = require("../scripts/build-pages");
const run = require("../examples/cart-rounding/run.json");

test("Pages builds the public run and only its referenced evidence", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "alibai-pages-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ["viewer", "examples/cart-rounding"]) {
    await cp(join(__dirname, "..", name), join(root, name), { recursive: true });
  }
  for (const path of [".alibai", "_site"]) await mkdir(join(root, path));
  for (const name of [".alibai/private.json", "_site/stale.png", "examples/cart-rounding/screenshots/unreferenced.png", "viewer/extra.js"]) {
    await writeFile(join(root, name), "excluded");
  }

  const output = await buildPages(root);
  const html = await readFile(join(output, "index.html"), "utf8");
  assert.match(html, /data-runs-url="\.\/runs\.json"/);
  const data = JSON.parse(await readFile(join(output, "runs.json"), "utf8"));
  assert.deepEqual(data, { project: "Field Supply (demo)", runs: [run], invalidRuns: [] });
  assert.equal(run.steps.length, 3);
  assert.ok(run.steps.every(({ before, after }) => before && after));
  assert.deepEqual(run.checks.map(({ result }) => result), ["pass", "fail", "info"]);
  const expected = ["before", "after", "cart", "coupon"].map((name) => join("screenshots", run.id, `${name}.png`));
  const outputFiles = (await readdir(output, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => relative(output, join(entry.parentPath, entry.name)));
  assert.deepEqual(outputFiles.filter((name) => name.startsWith("screenshots")).sort(), expected.sort());
  assert.equal(outputFiles.length, 18);

  if (process.platform !== "win32") {
    const source = join(root, "examples/cart-rounding/screenshots");
    await rm(source, { recursive: true });
    await symlink(join(output, "screenshots", run.id), source, "dir");
    await assert.rejects(buildPages(root), /without symlinks/);
  }
});
