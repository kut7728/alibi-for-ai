const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } = require("node:fs/promises");
const { get } = require("node:http");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");
const { promisify } = require("node:util");
const { runInNewContext } = require("node:vm");
const { startViewer } = require("../dist/viewer");
const sample = require("../examples/cart-rounding/run.json");

const invalidId = "10000000-0000-0000-0000-000000000000";
const otherId = "20000000-0000-0000-0000-000000000000";
const hostileTitle = "<img src=x onerror=alert(1)> Basket";
const viewer = join(__dirname, "../viewer");

test("viewer dictionaries share keys and interpolation parameters", async () => {
  const source = await readFile(join(viewer, "messages.js"), "utf8");
  const { messages, translate } = runInNewContext(source + "\n({ messages, translate })");
  const keys = Object.keys(messages.en).sort();
  const parameters = (text) => text.match(/\{\w+\}/g)?.sort() ?? [];
  for (const locale of ["ko", "ja"]) {
    assert.deepEqual(Object.keys(messages[locale]).sort(), keys);
    for (const key of keys) assert.deepEqual(parameters(messages[locale][key]), parameters(messages.en[key]), key);
  }
  assert.equal(translate("ko", "caseFiles"), messages.ko.caseFiles);
  delete messages.ko.caseFiles;
  assert.equal(translate("ko", "caseFiles"), "Case files");
  delete messages.en.caseFiles;
  assert.equal(translate("ko", "caseFiles"), "caseFiles");
  assert.equal(translate("ko", "constructor"), "constructor");
});

test("viewer resolves locale from URL, storage and supported browser language in order", async () => {
  const source = await readFile(join(viewer, "messages.js"), "utf8");
  const resolve = runInNewContext(source + "\nresolveLocale");
  assert.equal(resolve("ja", "ko", ["en-US"]), "ja");
  assert.equal(resolve("KO", "ja", ["en-US"]), "ko");
  assert.equal(resolve("kO-Kr", "ja", ["en-US"]), "ko");
  assert.equal(resolve("ja-JP", "ko", ["en-US"]), "ja");
  assert.equal(resolve("ko-", "ja", ["en-US"]), "ja");
  assert.equal(resolve("fr-FR", "ko", ["ja-JP"]), "ko");
  assert.equal(resolve("zz", "xx", ["fr-FR", "ko-KR", "en-US"]), "ko");
  assert.equal(resolve(null, null, ["de", "ja-JP"]), "ja");
  assert.equal(resolve(null, null, ["en-GB", "ja-JP"]), "en");
  assert.equal(resolve("__proto__", "constructor", ["de"]), "en");
});

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
  assert.match(response.headers.get("content-security-policy"), /font-src 'self'/);
  assert.match(response.headers.get("content-security-policy"), /img-src 'self'/);
  const html = await response.text();
  assert.match(html, /<main id="app"/);
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\.\/favicon\.svg">/);
  for (const asset of ["tokens.css", "viewer.css", "viewer.js", "messages.js"]) {
    assert.equal((await fetch(url + asset)).status, 200);
  }
  const icon = await fetch(url + "favicon.svg");
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get("content-type"), "image/svg+xml");
  assert.equal(await icon.text(), await readFile(join(viewer, "favicon.svg"), "utf8"));
  assert.equal((await fetch(url + "other.svg")).status, 404);
  const fonts = ["Sans-Regular", "Sans-SemiBold", "SansCondensed-Bold", "Mono-Regular", "Mono-SemiBold", "Mono-Bold"];
  for (const font of fonts) {
    const asset = await fetch(url + `fonts/IBMPlex${font}-Latin1.woff2`);
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get("content-type"), "font/woff2");
    assert.equal(Buffer.from(await asset.arrayBuffer()).subarray(0, 4).toString(), "wOF2");
  }
  assert.equal((await fetch(url + "fonts/OFL.txt")).status, 404);
  const list = await (await fetch(url + "api/runs")).json();
  assert.deepEqual(list.runs, [run]);
  assert.deepEqual(list.invalidRuns.map(({ id }) => id), [invalidId]);
  assert.match(list.invalidRuns[0].error, /invalid JSON/);
  const { port } = server.address();
  for (const [headers, expected] of [
    ...["127.0.0.1", "localhost", "[::1]"].map((host) => [{ Host: `${host}:${port}` }, 200]),
    [{ Host: `example.com:${port}` }, 403],
    [{ Host: "localhost:0" }, 403],
    [{ "Sec-Fetch-Site": "cross-site" }, 403],
  ]) {
    const { status, body } = await new Promise((resolve, reject) => {
      get(url + "api/runs", { headers }, (response) => {
        let body = "";
        response.setEncoding("utf8").on("data", (chunk) => { body += chunk; });
        response.on("end", () => resolve({ status: response.statusCode, body }));
      }).on("error", reject);
    });
    assert.equal(status, expected, JSON.stringify(headers));
    if (expected === 403 && headers.Host) assert.match(body, /127\.0\.0\.1 URL printed by alibai open/);
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
  const { url, root, runs, run, directory } = await fixture(t);
  delete run.steps[1].before;
  run.checks.push({ ...run.checks.at(-1), id: otherId, target: "parseOptionalCoupon(code)", expected: null });
  await writeFile(join(directory, "run.json"), JSON.stringify(run));
  const localhostUrl = url.replace("127.0.0.1", "localhost");
  const dump = async (path, profile) => (await promisify(execFile)(chromium, [
    "--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--virtual-time-budget=3000", "--dump-dom", `--user-data-dir=${join(root, profile)}`, localhostUrl + path,
  ], { timeout: 10000 })).stdout;
  const list = await dump("?lang=en", "list-profile");
  assert.match(list, /1 invalid run skipped/);
  assert.match(list, /&lt;img src=x onerror=alert\(1\)&gt; Basket/);
  assert.doesNotMatch(list, /<img\b/);
  assert.match(list, /Alibi broken/);
  const detail = await dump(`?lang=en#case/${sample.id}`, "detail-profile");
  assert.match(detail, /<button class="compare-toggle" type="button" aria-haspopup="dialog">Open full-screen slider<\/button>/);
  assert.match(detail, /class="screenshot-pair"[^>]*><figure><figcaption class="label">Before<\/figcaption>.*?<figcaption class="label">After<\/figcaption>/s);
  assert.doesNotMatch(detail, /type="range"|<dialog/);
  assert.match(detail, /class="screenshot-pair single"/);
  assert.equal((detail.match(/class="compare-toggle"/g) ?? []).length, 2);
  assert.match(detail, /No screenshot recorded/);
  assert.doesNotMatch(detail, /class="git-changes"/);
  assert.match(detail, /<pre>null<\/pre>/);
  assert.match(detail, /<dt class="label">After<\/dt><dd><span class="muted">Threw: see error<\/span><\/dd>/);
  assert.match(detail, /<dt class="label">Expected<\/dt><dd><span class="muted">No expectation set<\/span><\/dd>/);
  assert.match(detail, /<dt class="label">Expected<\/dt><dd><pre>null<\/pre><\/dd>/);
  assert.doesNotMatch(detail, /class="undefined"/);
  assert.match(detail, /class="error neutral"/);
  assert.match(detail, /ASSERT_EQ_FAILED/);
  assert.match(detail, /Add Grid Linen.*calcTotal\(items\).*Open the basket drawer.*Apply the SAVE10 coupon.*applyCoupon\(code, total\)/s);
  const [ko, ja] = await Promise.all([
    dump("?lang=KO-kr#case/" + sample.id, "korean-profile"),
    dump("?lang=ja-JP#case/" + sample.id, "japanese-profile"),
  ]);
  assert.match(ko, /<html lang="ko"/);
  assert.match(ko, /한국어" aria-pressed="true"/);
  assert.match(ko, />전체 화면에서 슬라이더 열기<\/button>/);
  assert.match(ko, /증거 타임라인/);
  assert.match(ko, /기댓값이 설정되지 않음/);
  assert.match(ja, /<html lang="ja"/);
  assert.match(ja, /日本語" aria-pressed="true"/);
  assert.match(ja, />全画面でスライダーを開く<\/button>/);
  assert.match(ja, /証拠のタイムライン/);
  assert.match(ja, /期待値が設定されていません/);
  for (const localized of [ko, ja]) {
    assert.match(localized, /lang="en">Alibi broken/);
    assert.match(localized, /ASSERT_EQ_FAILED/);
    assert.match(localized, new RegExp('title="' + sample.createdAt + '"'));
  }
  const dirty = {
    ...sample, id: otherId, steps: [], checks: [],
    git: {
      ...sample.git, dirty: true,
      startChanges: { paths: ["src/cart.js", "<img src=x onerror=alert(1)>"], diffSha256: "a".repeat(64) },
      endChanges: { paths: ["src/cart.js"], diffSha256: null },
    },
  };
  await mkdir(join(runs, dirty.id));
  await writeFile(join(runs, dirty.id, "run.json"), JSON.stringify(dirty));
  const changedCase = (locale) => dump(`?lang=${locale}#case/${dirty.id}`, `${locale}-dirty-profile`);
  const [changed, changedKo, changedJa] = await Promise.all(["en", "ko", "ja"].map(changedCase));
  assert.match(changed, /<dt>Started<\/dt><dd><details><summary title="a{64}">Uncommitted changes \(2 files, hash a{12}\)<\/summary>/);
  assert.match(changed, /<dt>Ended<\/dt><dd><details><summary>Uncommitted changes \(1 file, hash unavailable\)<\/summary>/);
  assert.match(changed, /<ul><li><code>src\/cart\.js<\/code><\/li><li><code>&lt;img src=x onerror=alert\(1\)&gt;<\/code><\/li><\/ul>/);
  assert.doesNotMatch(changed, /<details open|<img\b/);
  assert.match(changedKo, /커밋되지 않은 변경 사항 \(파일 2개, 해시 a{12}\)/);
  assert.match(changedJa, /未コミットの変更（2 ファイル、ハッシュ a{12}）/);
});
