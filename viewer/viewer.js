"use strict";

const app = document.getElementById("app");
const breadcrumb = document.getElementById("breadcrumb");
const theme = document.getElementById("theme");
const languages = document.getElementById("languages");
const languageButtons = languages.querySelectorAll("button");
const copyStatus = el("p", "copy-status");
copyStatus.setAttribute("role", "status");
document.body.append(copyStatus);
let copying = false;
let copyTimeout;
const themes = ["System", "Light", "Dark"];
let themeIndex = Math.max(0, themes.indexOf(readPreference("alibai-theme")));
const url = new URL(location.href);
let locale = resolveLocale(url.searchParams.get("lang"), readPreference("alibai-lang"), navigator.languages);
let formats;
let files;
let loadFailed = false;
let query = "";
let filter = "all";

const verdicts = { pass: "holdsVerdict", fail: "brokenVerdict", info: "informational", open: "inProgress" };
const t = (key, values) => translate(locale, key, values);

function readPreference(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function savePreference(key, value) {
  try { localStorage.setItem(key, value); } catch { /* The current page still works. */ }
}

function el(tag, className, ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children);
  return node;
}

function heading(text) {
  const node = el("h1", "", text);
  node.tabIndex = -1;
  return node;
}

function badge(result, key) {
  const node = el("span", `badge ${result}`, t(key));
  if (key === "holdsVerdict" || key === "brokenVerdict") node.lang = "en";
  return node;
}

function link(text, href, className) {
  const node = el("a", className, text);
  node.href = href;
  return node;
}

function iconControl(control, label, path) {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const stroke = document.createElementNS(namespace, "path");
  stroke.setAttribute("d", path);
  svg.append(stroke);
  control.append(svg);
  control.setAttribute("aria-label", label);
  control.title = label;
  return control;
}

function timestamp(value, compact = false) {
  if (!value) return el("span", "muted", t("notRecorded"));
  const node = el("time", "mono", (compact ? formats.compact : formats.timestamp).format(new Date(value)));
  node.title = value;
  node.dateTime = value;
  return node;
}

function branchChip(value) {
  const chip = el("span", "branch", value ?? "—");
  if (value) chip.title = value;
  return chip;
}

function applyTheme() {
  const name = themes[themeIndex].toLowerCase();
  document.documentElement.dataset.theme = name;
  theme.textContent = t("theme", { name: t(name) });
}

theme.addEventListener("click", () => {
  themeIndex = (themeIndex + 1) % themes.length;
  savePreference("alibai-theme", themes[themeIndex]);
  applyTheme();
});

function applyLocale() {
  const date = {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: "UTC",
  };
  formats = {
    compact: new Intl.DateTimeFormat(locale, date),
    timestamp: new Intl.DateTimeFormat(locale, { ...date, timeZoneName: "short" }),
    count: new Intl.NumberFormat(locale),
    percent: new Intl.NumberFormat(locale, { style: "percent" }),
  };
  document.documentElement.lang = locale;
  document.querySelector(".logo").setAttribute("aria-label", t("homeLabel"));
  document.querySelector(".appbar nav").setAttribute("aria-label", t("breadcrumbLabel"));
  document.getElementById("case-files").textContent = t("caseFiles");
  languages.setAttribute("aria-label", t("languageLabel"));
  for (const button of languageButtons) {
    button.setAttribute("aria-label", translate(button.dataset.lang, "languageName"));
    button.setAttribute("aria-pressed", String(button.dataset.lang === locale));
  }
  applyTheme();
  render();
}

for (const button of languageButtons) {
  button.addEventListener("click", () => {
    locale = button.dataset.lang;
    savePreference("alibai-lang", locale);
    const current = new URL(location.href);
    current.searchParams.set("lang", locale);
    history.replaceState(history.state, "", current);
    applyLocale();
  });
}
applyLocale();

function visibleRuns() {
  const term = query.trim().toLowerCase();
  return files.runs.filter((run) =>
    (filter === "all" || run.verdict === filter) &&
    [run.title, run.git.branch ?? ""].some((value) => value.toLowerCase().includes(term)));
}

function showList() {
  const controls = el("div", "filters");
  const search = el("input", "search");
  search.type = "search";
  search.value = query;
  search.placeholder = t("search");
  search.setAttribute("aria-label", search.placeholder);
  const table = el("table", "");
  table.setAttribute("aria-label", t("caseFiles"));
  table.setAttribute("role", "table");
  const header = el("tr", "");
  header.setAttribute("role", "row");
  for (const key of ["case", "title", "branch", "exhibits", "started", "verdict"]) {
    const cell = el("th", "", t(key));
    cell.scope = "col";
    cell.setAttribute("role", "columnheader");
    header.append(cell);
  }
  const thead = el("thead", "", header);
  thead.setAttribute("role", "rowgroup");
  const rows = el("tbody", "");
  rows.setAttribute("role", "rowgroup");
  table.append(thead, rows);
  const tableBox = el("div", "table-box", table);
  const status = el("p", "empty");
  status.setAttribute("role", "status");
  const buttons = Object.entries({ all: "all", fail: "broken", pass: "holds" }).map(([key, label]) => {
    const count = files.runs.filter((run) => key === "all" || run.verdict === key).length;
    const button = el("button", "chip", t("filterCount", { label: t(label), count: formats.count.format(count) }));
    button.type = "button";
    button.addEventListener("click", () => {
      filter = key;
      updateRows();
    });
    controls.append(button);
    return { key, button };
  });
  controls.append(search);

  function updateRows() {
    for (const { key, button } of buttons) button.setAttribute("aria-pressed", String(key === filter));
    const matching = visibleRuns();
    rows.replaceChildren(...matching.map((run) => {
      const result = run.verdict ?? "open";
      const exhibits = [...run.steps, ...run.checks];
      const marks = el("span", "ex-bar", ...exhibits.slice(0, 8).map(({ result }) => el("i", result)));
      marks.setAttribute("aria-hidden", "true");
      const caseLink = link(run.title, `#case/${run.id}`);
      const row = el("tr", "",
        el("td", "case-no mono", run.id.slice(0, 8)),
        el("td", "case-title", caseLink),
        el("td", "branch-cell", branchChip(run.git.branch)),
        el("td", "exhibit-cell", marks, el("span", "mono", formats.count.format(exhibits.length))),
        el("td", "time-cell", timestamp(run.createdAt, true)),
        el("td", "result-cell", badge(result, verdicts[result])));
      row.setAttribute("role", "row");
      for (const cell of row.cells) cell.setAttribute("role", "cell");
      row.addEventListener("click", (event) => {
        if (!event.target.closest("a") && !window.getSelection()?.toString()) caseLink.click();
      });
      return row;
    }));
    tableBox.hidden = matching.length === 0;
    status.hidden = matching.length > 0;
    status.textContent = t("noMatchingCases");
  }

  search.addEventListener("input", () => {
    query = search.value;
    updateRows();
  });
  const title = heading(t("caseFiles"));
  app.append(title);
  if (files.invalidRuns.length) {
    const count = files.invalidRuns.length;
    const warning = el("details", "warning",
      el("summary", "", t(count === 1 ? "invalidRun" : "invalidRuns", { count: formats.count.format(count) })),
      el("ul", "", ...files.invalidRuns.map(({ path, error }) =>
        el("li", "", el("code", "", path), el("p", "", error)))));
    app.append(warning);
  }
  if (files.runs.length) {
    app.append(controls, tableBox, status);
    updateRows();
  } else {
    app.append(el("section", "empty-state",
      el("h2", "", t("noCases")),
      el("p", "", t("startCase")),
      el("pre", "", el("code", "", 'alibai run start --title "..."')),
      link(t("readme"), "https://github.com/kut7728/alibi-for-ai#readme")));
  }
  return title;
}

// V1 keeps two sequences. Merge their next entries by timestamp when both have one.
function timeline({ steps, checks }) {
  const orderedSteps = steps.toSorted((a, b) => a.order - b.order);
  const exhibits = [];
  let ui = 0;
  let logic = 0;
  while (ui < orderedSteps.length || logic < checks.length) {
    const step = orderedSteps[ui];
    const check = checks[logic];
    if (!step || (step.createdAt && check?.createdAt && check.createdAt < step.createdAt)) {
      exhibits.push({ kind: "logic", item: check });
      logic++;
    } else {
      exhibits.push({ kind: "ui", item: step });
      ui++;
    }
  }
  return exhibits;
}

function appendGitChanges(meta, git) {
  for (const [label, changes] of [["started", git.startChanges], ["ended", git.endChanges]]) {
    if (changes === undefined) continue;
    const value = el("dd", "");
    if (changes === null) {
      value.append(t("gitChangesUnavailable"));
    } else {
      const { paths, diffSha256 } = changes;
      const files = t(paths.length === 1 ? "changedFile" : "changedFiles", { count: formats.count.format(paths.length) });
      const summary = el("summary", "", t("gitChanges", {
        files, hash: diffSha256?.slice(0, 12) ?? t("hashUnavailable"),
      }));
      if (diffSha256) summary.title = diffSha256;
      const list = el("ul", "");
      for (const path of paths) list.append(el("li", "", el("code", "", path)));
      value.append(el("details", "", summary, list));
    }
    meta.append(el("div", "git-changes", el("dt", "", t(label)), value));
  }
}

function showCase(run) {
  const title = heading(run.title);
  const exhibits = timeline(run);
  const result = run.verdict ?? "open";
  const count = (result) => exhibits.filter(({ item }) => item.result === result).length;
  const counts = el("div", "counts");
  for (const [label, number, tone] of [
    ["passed", count("pass"), "pass"], ["failed", count("fail"), "fail"], ["exhibits", exhibits.length, ""],
  ]) {
    counts.append(el("div", tone && number ? `count ${tone}` : "count",
      el("b", "", formats.count.format(number)), el("span", "", t(label))));
  }
  const meta = el("dl", "meta");
  const sha = (value) => {
    const code = el("code", "", value?.slice(0, 12) ?? "—");
    if (value) code.title = value;
    return code;
  };
  for (const [label, value] of [
    ["branch", branchChip(run.git.branch)],
    ["commit", sha(run.git.headSha)],
    ["base", sha(run.git.baseSha)],
    ["worktree", t(run.git.dirty === undefined ? "notRecorded" : run.git.dirty ? "dirty" : "clean")],
    ["platform", run.platform],
    ...(run.agent ? [["agent", run.agent]] : []),
    ["started", timestamp(run.createdAt)],
    ...(run.verdict ? [["ended", timestamp(run.endedAt)]] : []),
  ]) {
    meta.append(el("div", "", el("dt", "", t(label)), el("dd", "", value)));
  }
  appendGitChanges(meta, run.git);
  const caseHeader = el("div", "case-header",
    el("p", "label", t("caseNumber", { id: run.id.slice(0, 8) })), badge(result, verdicts[result]));
  const cases = visibleRuns();
  const position = cases.indexOf(run);
  const arrow = (offset, label, path) => {
    const neighbor = position < 0 ? undefined : cases[position + offset];
    const control = neighbor ? link("", `#case/${neighbor.id}`, "icon-control") : el("button", "icon-control");
    if (!neighbor) {
      control.type = "button";
      control.disabled = true;
    }
    return iconControl(control, t(label), path);
  };
  const navigation = el("nav", "case-navigation",
    arrow(-1, "previousCase", "m15 5-7 7 7 7"),
    link(t("back"), "#", "case-back"),
    arrow(1, "nextCase", "m9 5 7 7-7 7"));
  navigation.setAttribute("aria-label", t("caseNavigation"));
  const summary = el("section", "summary", navigation, caseHeader, title);
  if (run.summary) summary.append(el("p", "note", run.summary));
  summary.append(counts, meta);
  app.append(summary);
  app.append(el("section", "evidence",
    el("h2", "", t("timeline")),
    exhibits.length ? el("ol", "timeline", ...exhibits.map((exhibit, index) => renderExhibit(run, exhibit, index)))
      : el("p", "empty", t("noExhibits"))));
  return title;
}

function renderExhibit(run, { kind, item }, index) {
  const isStep = kind === "ui";
  const name = isStep ? item.action : item.target.split("(")[0].trim();
  const title = isStep ? name : name.split(/[./\\:#›\s]+/).filter(Boolean).at(-1) ?? t("logicCheck");
  const titleNode = el("h3", isStep ? "" : "logic-title", title);
  const number = index < 26 ? String.fromCharCode(65 + index) : formats.count.format(index + 1);
  const header = el("header", "exhibit-head", el("span", "tag", t("exhibitNumber", { number })),
    el("span", "kind mono", t(isStep ? "uiStep" : "logicCheck")), titleNode);
  header.append(badge(item.result, item.result));
  const content = isStep ? renderScreenshots(run.id, item) : renderCheck(item);
  return el("li", `exhibit ${item.result}`, header, content);
}

async function screenshotPng(image) {
  await image.decode();
  if (new URL(image.src).pathname.toLowerCase().endsWith(".png")) {
    const response = await fetch(image.src);
    if (!response.ok) throw new Error("Screenshot unavailable");
    return response.blob();
  }
  const canvas = el("canvas", "");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext("2d").drawImage(image, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG encoding failed")), "image/png");
  });
}

function showCopyStatus(button, message, label) {
  clearTimeout(copyTimeout);
  copyStatus.textContent = t(message, { label });
  const anchor = button.getBoundingClientRect();
  const { width, height } = copyStatus.getBoundingClientRect();
  const viewport = document.documentElement;
  const gap = 8;
  const below = anchor.bottom + gap;
  const bottom = viewport.clientHeight - gap - height;
  const top = below <= bottom ? below : anchor.top - gap - height;
  copyStatus.style.top = `${Math.max(gap, Math.min(top, bottom))}px`;
  copyStatus.style.left = `${Math.max(gap, Math.min(anchor.right, viewport.clientWidth - gap) - width)}px`;
}

async function copyScreenshot(image, button, label) {
  if (copying) {
    showCopyStatus(button, "screenshotCopyBusy");
    return;
  }
  copying = true;
  showCopyStatus(button, "screenshotCopyPending", label);
  let png;
  let message;
  try {
    // Start the clipboard write within the gesture, even when PNG data is still pending.
    if (!navigator.clipboard?.write || !window.ClipboardItem) throw new Error("Image clipboard unavailable");
    png = screenshotPng(image);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    message = "screenshotCopied";
  } catch {
    png?.catch(() => {});
    message = "screenshotCopyFailed";
  } finally {
    copying = false;
  }
  if (button.isConnected) showCopyStatus(button, message, label);
  else copyStatus.textContent = "";
  copyTimeout = setTimeout(() => { copyStatus.textContent = ""; }, 4000);
}

function renderScreenshots(runId, step) {
  const screenshots = el("div", "screenshots");
  const pair = el("div", "screenshot-pair");
  let toggle;
  let comparison;
  const pictures = ["before", "after"].map((side) => {
    const label = t(side);
    const thumb = el("div", "thumb");
    pair.append(el("figure", "", el("figcaption", "label", label), thumb));
    if (!step[side]) {
      thumb.append(el("div", "missing", t("noScreenshot")));
      return null;
    }

    let preview;
    const unavailable = () => {
      if (!enlarge.isConnected) return;
      const focus = document.activeElement;
      const restoreFocus = thumb.contains(focus) || focus === toggle || preview?.open || comparison?.open;
      preview?.close();
      comparison?.close();
      comparison?.remove();
      toggle?.remove();
      thumb.replaceChildren(el("div", "missing", t("screenshotError")));
      if (restoreFocus) screenshots.focus({ preventScroll: true });
    };
    const picture = () => {
      const img = el("img", "shot");
      img.alt = t("screenshotAlt", { label, action: step.action });
      img.addEventListener("error", unavailable, { once: true });
      img.src = `./screenshots/${runId}/${encodeURIComponent(step[side].split("/")[1])}`;
      return img;
    };
    const image = picture();
    const enlarge = el("button", "shot-open", image);
    enlarge.type = "button";
    enlarge.setAttribute("aria-label", t("enlargeScreenshot", { label, action: step.action }));
    enlarge.setAttribute("aria-haspopup", "dialog");
    enlarge.addEventListener("click", () => {
      const dialog = screenshotDialog(image.alt, image.alt, "closeScreenshot",
        el("div", "image-viewport", picture()));
      preview = dialog;
      dialog.addEventListener("close", () => dialog.remove(), { once: true });
      showScreenshotDialog(screenshots, dialog, enlarge);
    });
    const copy = iconControl(el("button", "icon-control shot-copy"), t("copyScreenshot", { label, action: step.action }),
      "M8 8h12v12H8z M16 8V4H4v12h4");
    copy.type = "button";
    copy.addEventListener("click", () => copyScreenshot(image, copy, label));
    thumb.append(enlarge, copy);
    return picture;
  });

  screenshots.tabIndex = -1;
  screenshots.setAttribute("role", "group");
  screenshots.setAttribute("aria-label", t("screenshots"));
  screenshots.append(pair);
  if (pictures.every(Boolean)) {
    toggle = iconControl(el("button", "icon-control compare-toggle"), t("showSlider"),
      "M9 4H4v5m11-5h5v5m0 6v5h-5m-6 0H4v-5m8-11v16");
    toggle.type = "button";
    toggle.setAttribute("aria-haspopup", "dialog");
    toggle.addEventListener("click", () => showScreenshotDialog(screenshots,
      comparison ??= renderComparison(step.action, pictures.map((picture) => picture())), toggle));
    screenshots.append(toggle);
  } else pair.classList.add("single");
  const content = el("div", "exhibit-body", screenshots);
  if (step.note) content.append(el("p", "note", step.note));
  return content;
}

function showScreenshotDialog(container, dialog, trigger) {
  if (!dialog.isConnected) {
    dialog.addEventListener("close", () => {
      // A close event can arrive after the comparison has reopened.
      if (!dialog.open && trigger.isConnected) trigger.focus({ preventScroll: true });
    });
    container.append(dialog);
  }
  dialog.showModal();
}

function screenshotDialog(label, title, closeLabel, ...content) {
  const close = el("button", "dialog-close", t(closeLabel));
  close.type = "button";
  close.autofocus = true;
  const dialog = el("dialog", "screenshot-dialog",
    el("header", "compare-head", el("h2", "", title), close), ...content);
  dialog.setAttribute("aria-label", label);
  close.addEventListener("click", () => dialog.close());
  return dialog;
}

function renderComparison(action, images) {
  const label = t("comparison", { action });
  const handle = el("span", "handle");
  handle.setAttribute("aria-hidden", "true");
  const slider = el("input", "");
  slider.type = "range";
  slider.min = "0";
  slider.max = "100";
  slider.value = "50";
  slider.setAttribute("aria-label", label);
  const [before, after] = images;
  after.classList.add("after");
  const comparison = el("div", "comparison", ...images, handle, slider);
  const dialog = screenshotDialog(label, action, "closeComparison",
    el("div", "compare-captions label", el("span", "", t("before")), el("span", "", t("after"))),
    el("div", "compare-viewport", comparison));
  dialog.classList.add("compare-dialog");
  const update = () => {
    comparison.style.setProperty("--position", `${slider.value}%`);
    const position = Number(slider.value) / 100;
    slider.setAttribute("aria-valuetext", t("position", {
      before: formats.percent.format(position), after: formats.percent.format(1 - position),
    }));
  };
  const sizeFrame = () => {
    const width = Math.max(before.naturalWidth, after.naturalWidth);
    const height = Math.max(before.naturalHeight, after.naturalHeight);
    if (width && height) comparison.style.setProperty("--capture-ratio", width / height);
  };
  for (const image of images) image.addEventListener("load", sizeFrame);
  sizeFrame();
  slider.addEventListener("input", update);
  update();
  return dialog;
}

function renderCheck(check) {
  const display = (value) => JSON.stringify(value, null, 2);
  const columns = ["before", "after", "expected"];
  const hasAfter = Object.hasOwn(check, "after");
  const changed = hasAfter && display(check.before) !== display(check.after);
  const exception = !hasAfter && check.error;
  const exceptionLabels = { after: "threw", expected: "noExpectation" };
  const tones = { before: changed ? "removed" : "", after: check.result === "fail" ? "mismatch" : changed ? "added" : "" };
  const diff = el("dl", "diff", ...columns.map((key) => {
    const present = Object.hasOwn(check, key);
    const absent = t((exception && exceptionLabels[key]) || "notRecorded");
    return el("div", present ? tones[key] ?? "" : "", el("dt", "label", t(key)),
      el("dd", "", present ? el("pre", "", display(check[key])) : el("span", "muted", absent)));
  }));
  const input = el("dl", "input",
    el("dt", "label", t("target")), el("dd", "", el("code", "target", check.target)),
    el("dt", "label", t("input")), el("dd", "", el("pre", "", JSON.stringify(check.input))));
  const content = el("div", "exhibit-body", input, diff);
  if (check.error) content.append(el("p", check.result === "info" ? "error neutral" : "error",
    el("span", "label", t("error")), el("code", "", check.error)));
  return content;
}

function render(moveFocus = false) {
  copyStatus.textContent = "";
  document.title = `${t("caseFiles")} · alibai`;
  if (loadFailed) {
    app.replaceChildren(heading(t("caseFiles")), el("p", "error", t("loadError")));
    return;
  }
  if (!files) {
    app.firstElementChild.textContent = t("loading");
    return;
  }
  const id = location.hash.startsWith("#case/") ? location.hash.slice(6) : "";
  const run = files.runs.find((item) => item.id === id);
  breadcrumb.hidden = !id;
  breadcrumb.textContent = id ? ` / ${run ? run.id.slice(0, 8) : t("unavailable")}` : "";
  if (run) document.title = `${run.title} · alibai`;
  app.replaceChildren();
  let title;
  if (run) title = showCase(run);
  else if (id) {
    title = heading(t("unavailable"));
    app.append(title, link(t("back"), "#"));
  } else title = showList();
  if (moveFocus) {
    title.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
}

window.addEventListener("hashchange", () => render(true));
fetch(document.documentElement.dataset.runsUrl ?? "./api/runs")
  .then((response) => {
    if (!response.ok) throw new Error(String(response.status));
    return response.json();
  })
  .then((data) => {
    files = data;
    document.getElementById("project").textContent = data.project;
    render();
  })
  .catch(() => {
    loadFailed = true;
    render();
  })
  .finally(() => app.removeAttribute("aria-busy"));
