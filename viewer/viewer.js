"use strict";

const app = document.getElementById("app");
const breadcrumb = document.getElementById("breadcrumb");
const theme = document.getElementById("theme");
const languages = document.getElementById("languages");
const languageButtons = languages.querySelectorAll("button");
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
    seconds: new Intl.NumberFormat(locale, {
      style: "unit", unit: "second", minimumFractionDigits: 3, maximumFractionDigits: 3, signDisplay: "always",
    }),
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
    const term = query.trim().toLowerCase();
    const matching = files.runs.filter((run) =>
      (filter === "all" || run.verdict === filter) &&
      [run.title, run.git.branch ?? ""].some((value) => value.toLowerCase().includes(term)));
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
    counts.append(el("div", `count ${number === 0 ? "zero" : tone}`, el("b", "", formats.count.format(number)), el("span", "label", t(label))));
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
  const stamp = result === "info" ? badge(result, verdicts[result]) : el("span", `stamp ${result}`, t(verdicts[result]));
  if (result === "pass" || result === "fail") stamp.lang = "en";
  const verdict = el("div", "verdict", stamp);
  if (run.summary) verdict.append(el("p", "note", run.summary));
  app.append(el("section", "summary",
    el("div", "", el("p", "label case-label", t("caseNumber", { id: run.id.slice(0, 8) })), title, meta, counts), verdict));
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
  if (item.createdAt) {
    const seconds = (Date.parse(item.createdAt) - Date.parse(run.createdAt)) / 1000;
    const time = el("time", "exhibit-time mono", formats.seconds.format(seconds));
    time.dateTime = item.createdAt;
    time.title = item.createdAt;
    header.append(time);
  }
  header.append(badge(item.result, item.result));
  const content = isStep ? renderScreenshots(run.id, item) : renderCheck(item);
  return el("li", `exhibit ${item.result}`, header, content);
}

function renderScreenshots(runId, step) {
  const screenshots = el("div", "");
  const failed = new Set();
  const sides = ["before", "after"];

  function picture(side, label) {
    if (!step[side] || failed.has(side)) {
      return el("div", "missing", t(failed.has(side) ? "screenshotError" : "noScreenshot"));
    }
    const img = el("img", "shot");
    img.alt = t("screenshotAlt", { label, action: step.action });
    img.addEventListener("error", () => {
      if (failed.has(side)) return;
      failed.add(side);
      const hadFocus = screenshots.contains(document.activeElement);
      draw();
      if (hadFocus) screenshots.focus();
    }, { once: true });
    img.src = `/screenshots/${runId}/${encodeURIComponent(step[side].split("/")[1])}`;
    return img;
  }

  function draw() {
    if (step.before && step.after && failed.size === 0) {
      const comparison = el("div", "comparison", picture("before", t("before")), picture("after", t("after")));
      comparison.children[1].classList.add("after");
      const handle = el("span", "handle");
      handle.setAttribute("aria-hidden", "true");
      const slider = el("input", "");
      slider.type = "range";
      slider.min = "0";
      slider.max = "100";
      slider.value = "50";
      slider.setAttribute("aria-label", t("comparison", { action: step.action }));
      const update = () => {
        comparison.style.setProperty("--position", `${slider.value}%`);
        const position = Number(slider.value) / 100;
        slider.setAttribute("aria-valuetext", t("position", {
          before: formats.percent.format(position), after: formats.percent.format(1 - position),
        }));
      };
      slider.addEventListener("input", update);
      update();
      const captions = el("figcaption", "compare-captions",
        el("span", "cap", t("before")), el("span", "cap", t("after")));
      captions.setAttribute("aria-hidden", "true");
      comparison.append(handle, slider);
      screenshots.replaceChildren(el("figure", "comparison-figure", captions, comparison));
    } else {
      screenshots.replaceChildren(el("div", "single", ...sides.map((side) => {
        const label = t(side);
        return el("figure", "", el("figcaption", "label", label), el("div", "thumb", picture(side, label)));
      })));
    }
  }

  screenshots.tabIndex = -1;
  screenshots.setAttribute("role", "group");
  screenshots.setAttribute("aria-label", t("screenshots"));
  draw();
  const content = el("div", "exhibit-body", screenshots);
  if (step.note) content.append(el("p", "note", step.note));
  return content;
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
fetch("/api/runs")
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
