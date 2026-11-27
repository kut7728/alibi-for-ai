const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } = require("node:fs/promises");
const { get } = require("node:http");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");
const { pathToFileURL } = require("node:url");
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
const dumpChromium = async (url, profile) => (await promisify(execFile)(chromium, [
  "--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--virtual-time-budget=3000", "--dump-dom", `--user-data-dir=${profile}`, url,
], { timeout: 10000 })).stdout;

test("viewer renders case files and exhibits in Chromium", { skip: !chromium, timeout: 25000 }, async (t) => {
  const { url, root, runs, run, directory } = await fixture(t);
  delete run.steps[1].before;
  run.checks.push({ ...run.checks.at(-1), id: otherId, target: "parseOptionalCoupon(code)", expected: null });
  await writeFile(join(directory, "run.json"), JSON.stringify(run));
  const localhostUrl = url.replace("127.0.0.1", "localhost");
  const dump = (path, profile) => dumpChromium(localhostUrl + path, join(root, profile));
  const list = await dump("?lang=en", "list-profile");
  assert.match(list, /1 invalid run skipped/);
  assert.match(list, /&lt;img src=x onerror=alert\(1\)&gt; Basket/);
  assert.doesNotMatch(list, /<img\b/);
  assert.match(list, /Alibi broken/);
  const detail = await dump(`?lang=en#case/${sample.id}`, "detail-profile");
  assert.match(detail, /class="summary"><nav class="case-navigation"[^>]*>.*?<button[^>]*disabled[^>]*aria-label="Previous case".*?<a class="case-back" href="#">Back to case files<\/a>.*?<button[^>]*disabled[^>]*aria-label="Next case"/s);
  assert.match(detail, /class="icon-control compare-toggle" aria-label="Open full-screen slider"[^>]*aria-haspopup="dialog"><svg/);
  assert.match(detail, /class="screenshot-pair"[^>]*><figure><figcaption class="label">Before<\/figcaption>.*?<figcaption class="label">After<\/figcaption>/s);
  assert.match(detail, /class="shot-open"[^>]*aria-label="Enlarge Before screenshot — [^"]*"[^>]*><img[^>]*><\/button><button class="icon-control shot-copy" aria-label="Copy Before screenshot — /);
  assert.doesNotMatch(detail, /type="range"|<dialog/);
  assert.doesNotMatch(detail, /exhibit-time/);
  assert.match(detail, /class="screenshot-pair single"/);
  assert.equal((detail.match(/class="icon-control compare-toggle"/g) ?? []).length, 2);
  assert.equal((detail.match(/class="shot-open"/g) ?? []).length, 5);
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
  assert.match(ko, /aria-label="전체 화면에서 슬라이더 열기"/);
  assert.match(ko, /사건 기록으로 돌아가기<\/a>/);
  assert.match(ko, /증거 타임라인/);
  assert.match(ko, /기댓값이 설정되지 않음/);
  assert.match(ja, /<html lang="ja"/);
  assert.match(ja, /日本語" aria-pressed="true"/);
  assert.match(ja, /aria-label="全画面でスライダーを開く"/);
  assert.match(ja, /事件記録に戻る<\/a>/);
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
  assert.match(changed, new RegExp(`href="#case/${sample.id}" aria-label="Previous case"`));
  assert.match(changed, /<button[^>]*disabled[^>]*aria-label="Next case"/);
});

async function probeViewports(t, probe, viewports, locales) {
  const root = await mkdtemp(join(tmpdir(), "alibai-comparison-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const script = join(root, "measure.js");
  await writeFile(script, `(${probe})().catch((error) => parent.postMessage({ error: String(error) }, "*"));`);
  const index = await readFile(join(viewer, "index.html"), "utf8");
  await writeFile(join(root, "probe.html"), index
    .replace("<head>", `<head><base href="${pathToFileURL(viewer + "/")}">`)
    .replace("</head>", `<script defer src="${pathToFileURL(script)}"></script></head>`));
  const frames = viewports.flatMap(([width, height]) => locales.map((locale) =>
    `<iframe width="${width}" height="${height}" src="./probe.html?lang=${locale}"></iframe>`));
  const page = join(root, "viewports.html");
  await writeFile(page, `<!doctype html><script>
    addEventListener("message", ({ data }) => {
      document.body.appendChild(document.createElement("output")).textContent = JSON.stringify(data);
    });
    </script><body>${frames.join("")}</body>`);
  const html = await dumpChromium(pathToFileURL(page).href, join(root, "profile"));
  return [...html.matchAll(/<output>(.*?)<\/output>/g)].map(([, result]) => JSON.parse(result));
}

test("full-screen screenshot dialogs fit extreme images and survive rapid reopen", { skip: !chromium, timeout: 15000 }, async (t) => {
  async function measure() {
    const canvas = document.createElement("canvas");
    canvas.width = 390;
    canvas.height = 5000;
    const images = [new Image(), new Image()];
    const src = canvas.toDataURL("image/png");
    for (const image of images) {
      image.className = "shot";
      image.src = src;
    }
    await Promise.all(images.map((image) => image.decode()));
    const dialog = renderComparison("Tall captures", images);
    const trigger = el("button", "", "Open comparison");
    document.body.append(trigger);
    showScreenshotDialog(document.body, dialog, trigger);
    const captions = dialog.querySelector(".compare-captions").getBoundingClientRect();
    const { width, height, top, bottom } = dialog.querySelector(".comparison").getBoundingClientRect();
    const scrollHeight = dialog.scrollHeight;
    const slider = dialog.querySelector("input");
    slider.value = "70";
    dialog.close();
    showScreenshotDialog(document.body, dialog, trigger);
    dialog.dispatchEvent(new Event("close"));
    const reopened = dialog.open && dialog.isConnected && slider.value === "70";
    dialog.close();
    const previews = [];
    for (const dimensions of [[390, 5000], [5000, 100]]) {
      [canvas.width, canvas.height] = dimensions;
      const image = new Image();
      image.className = "shot";
      image.src = canvas.toDataURL("image/png");
      await image.decode();
      const preview = screenshotDialog("Capture", "Capture", "closeScreenshot", el("div", "image-viewport", image));
      document.body.append(preview);
      preview.showModal();
      previews.push({
        fit: getComputedStyle(image).objectFit,
        image: image.getBoundingClientRect().toJSON(),
        area: preview.querySelector(".image-viewport").getBoundingClientRect().toJSON(),
        scrollHeight: preview.scrollHeight,
        focused: document.activeElement === preview.querySelector("button"),
      });
      preview.close();
    }
    parent.postMessage({
      locale: document.documentElement.lang, viewport: [innerWidth, innerHeight],
      width, height, top, bottom, captionsBottom: captions.bottom, scrollHeight, previews, reopened,
    }, "*");
  }
  const viewports = [[320, 740], [667, 230]];
  const locales = ["en", "ko", "ja"];
  const results = await probeViewports(t, measure, viewports, locales);
  assert.equal(results.length, viewports.length * locales.length);
  for (const viewport of viewports) {
    for (const locale of locales) {
      const result = results.find((item) => item.locale === locale && String(item.viewport) === String(viewport));
      assert.ok(result, `Missing result for ${locale} at ${viewport}`);
      const { width, height, top, bottom, captionsBottom, scrollHeight, previews, reopened } = result;
      assert.ok(Math.abs(width / height - 390 / 5000) < .002, JSON.stringify(result));
      assert.ok(top >= captionsBottom && bottom <= viewport[1] && scrollHeight <= viewport[1], JSON.stringify(result));
      assert.equal(reopened, true);
      assert.equal(previews.length, 2);
      for (const preview of previews) {
        assert.equal(preview.fit, "contain");
        assert.deepEqual(preview.image, preview.area);
        assert.ok(preview.focused && preview.image.height > 0 && preview.scrollHeight <= viewport[1], JSON.stringify(preview));
      }
    }
  }
});

test("screenshot copy feedback stays visible at the control and an unrelated failed image leaves preview open", { skip: !chromium, timeout: 15000 }, async (t) => {
  async function measure() {
    const canvas = document.createElement("canvas");
    canvas.width = 390;
    canvas.height = 5000;
    const tall = canvas.toDataURL();
    canvas.height = 244;
    const short = canvas.toDataURL();
    const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      ...src, set(value) { src.set.call(this, value.endsWith("/tall.png") ? tall : short); },
    });

    const screenshots = () => renderScreenshots("probe", {
      action: "Sample evidence", before: "screenshots/tall.png", after: "screenshots/short.png",
    });
    const gallery = screenshots();
    document.body.append(gallery);
    const copy = gallery.querySelector(".shot-copy");
    await copy.parentNode.querySelector("img").decode();
    copy.scrollIntoView({ block: "center" });
    copy.focus({ preventScroll: true });
    const status = document.querySelector(".copy-status");
    const prepare = screenshotPng;
    const payload = new Blob([], { type: "image/png" });
    screenshotPng = () => Promise.resolve(payload);
    const feedback = [];
    for (const rejected of [false, true]) {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
        async write([item]) {
          if (rejected) throw new DOMException("Denied", "NotAllowedError");
          await item.getType("image/png");
        },
      } });
      const updated = new Promise((resolve) => {
        const observer = new MutationObserver(() => {
          if (!/copied\.|Could not copy/.test(status.textContent)) return;
          observer.disconnect();
          resolve();
        });
        observer.observe(status, { childList: true });
      });
      const scroll = scrollY;
      copy.click();
      await updated;
      const { left, top, right, bottom } = status.getBoundingClientRect();
      const anchor = copy.getBoundingClientRect();
      feedback.push({
        text: status.textContent, live: status.getAttribute("role"),
        visible: left >= 0 && right <= innerWidth && top >= 0 && bottom <= innerHeight && bottom > top,
        near: Math.min(Math.abs(top - anchor.bottom), Math.abs(bottom - anchor.top)) < 24,
        stable: scrollY === scroll && document.activeElement === copy,
      });
    }
    let release;
    const hold = new Promise((resolve) => { release = resolve; });
    const heldImage = copy.parentNode.querySelector("img");
    screenshotPng = (image) => image === heldImage ? hold : Promise.resolve(payload);
    const writes = [];
    const copied = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      write([item]) {
        const order = writes.length + 1;
        const write = item.getType("image/png").then(() => { copied.push(order); });
        writes.push(write.catch(() => {}));
        return write;
      },
    } });
    const otherCopy = gallery.querySelectorAll(".shot-copy")[1];
    copy.click();
    const pending = status.textContent;
    otherCopy.click();
    const busy = status.textContent;
    await Promise.all(writes.slice(1));
    release(payload);
    await Promise.all(writes);
    const beforeRetry = { writes: writes.length, copied: [...copied], text: status.textContent };
    otherCopy.click();
    await Promise.all(writes);
    screenshotPng = prepare;
    const latestCopy = { pending, busy, beforeRetry, copied, text: status.textContent };
    gallery.remove();

    const isolated = [];
    for (const healthyIndex of [0, 1]) {
      const pair = screenshots();
      document.body.append(pair);
      const buttons = pair.querySelectorAll(".shot-open");
      const trigger = buttons[healthyIndex];
      const failed = buttons[1 - healthyIndex];
      await trigger.firstElementChild.decode();
      trigger.focus();
      trigger.click();
      const dialog = pair.querySelector("dialog");
      await dialog.querySelector("img").decode();
      failed.firstElementChild.dispatchEvent(new Event("error"));
      const survived = dialog.open && trigger.isConnected;
      const fallback = pair.querySelector(".missing")?.textContent;
      const canCompare = Boolean(pair.querySelector(".compare-toggle:not(:disabled)"));
      if (dialog.open) dialog.querySelector("button").click();
      dialog.dispatchEvent(new Event("close"));
      isolated.push({ survived, fallback, canCompare, focused: document.activeElement === trigger });
      pair.remove();
    }
    parent.postMessage({ feedback, isolated, latestCopy }, "*");
  }
  const results = await probeViewports(t, measure, [[320, 740]], ["en"]);
  assert.equal(results.length, 1);
  assert.deepEqual(results[0], {
    feedback: ["Before screenshot copied.", "Could not copy Before screenshot."].map((text) => ({
      text, live: "status", visible: true, near: true, stable: true,
    })),
    isolated: Array.from({ length: 2 }, () => ({
      survived: true, fallback: "Screenshot could not load", canCompare: false, focused: true,
    })),
    latestCopy: {
      pending: "Copying Before screenshot…",
      busy: "Copy in progress. Try again shortly.",
      beforeRetry: { writes: 1, copied: [1], text: "Before screenshot copied." },
      copied: [1, 2], text: "After screenshot copied.",
    },
  });
});
