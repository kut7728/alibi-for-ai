"use strict";

const app = document.getElementById("app");
const breadcrumb = document.getElementById("breadcrumb");
const theme = document.getElementById("theme");
const themes = ["System", "Light", "Dark"];
let themeIndex = Math.max(0, themes.indexOf(localStorage.getItem("alibai-theme")));
let files;
let query = "";
let filter = "all";

const verdicts = {
  pass: "Alibi holds",
  fail: "Alibi broken",
  info: "Informational",
  open: "Open",
};

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

function badge(result, text) {
  return el("span", `badge ${result}`, text);
}

function link(text, href, className) {
  const node = el("a", className, text);
  node.href = href;
  return node;
}

function timestamp(value, compact = false) {
  if (!value) return el("span", "muted", "Not recorded");
  const text = value.replace("T", " ").slice(0, compact ? 16 : 23);
  const node = el("time", "mono", `${text} UTC`);
  node.dateTime = value;
  return node;
}

function applyTheme() {
  const name = themes[themeIndex];
  document.documentElement.dataset.theme = name.toLowerCase();
  theme.textContent = `Theme: ${name}`;
}

theme.addEventListener("click", () => {
  themeIndex = (themeIndex + 1) % themes.length;
  localStorage.setItem("alibai-theme", themes[themeIndex]);
  applyTheme();
});
applyTheme();

function showList() {
  const controls = el("div", "filters");
  const search = el("input", "search");
  search.type = "search";
  search.value = query;
  search.placeholder = "Search title or branch";
  search.setAttribute("aria-label", search.placeholder);
  const table = el("table", "");
  table.setAttribute("aria-label", "Case files");
  table.setAttribute("role", "table");
  const header = el("tr", "");
  header.setAttribute("role", "row");
  for (const title of ["Case", "Title", "Branch", "Exhibits", "Started (UTC)", "Verdict"]) {
    const cell = el("th", "", title);
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
  const buttons = Object.entries({ all: "All", fail: "Broken", pass: "Holds" }).map(([key, label]) => {
    const count = files.runs.filter((run) => key === "all" || run.verdict === key).length;
    const button = el("button", "chip", `${label} ${count}`);
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
      const row = el("tr", "",
        el("td", "case-no mono", run.id.slice(0, 8)),
        el("td", "case-title", link(run.title, `#case/${run.id}`)),
        el("td", "branch-cell", el("span", "branch", run.git.branch ?? "—")),
        el("td", "exhibit-cell", marks, el("span", "mono", String(exhibits.length))),
        el("td", "time-cell", timestamp(run.createdAt, true)),
        el("td", "result-cell", badge(result, verdicts[result])));
      row.setAttribute("role", "row");
      for (const cell of row.cells) cell.setAttribute("role", "cell");
      return row;
    }));
    tableBox.hidden = matching.length === 0;
    status.hidden = matching.length > 0;
    status.textContent = files.runs.length ? "No cases match your filters." : "No cases recorded.";
  }

  search.addEventListener("input", () => {
    query = search.value;
    updateRows();
  });
  const title = heading("Case files");
  app.append(title);
  if (files.invalidRuns.length) {
    const count = files.invalidRuns.length;
    const warning = el("details", "warning",
      el("summary", "", `${count} invalid ${count === 1 ? "run" : "runs"} skipped`),
      el("ul", "", ...files.invalidRuns.map(({ path, error }) =>
        el("li", "", el("code", "", path), el("p", "", error)))));
    app.append(warning);
  }
  if (files.runs.length) app.append(controls);
  app.append(tableBox, status);
  updateRows();
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

function showCase(run) {
  const title = heading(run.title);
  const exhibits = timeline(run);
  const result = run.verdict ?? "open";
  const count = (result) => exhibits.filter(({ item }) => item.result === result).length;
  const counts = el("div", "counts");
  for (const [label, number, tone] of [
    ["Passed", count("pass"), "pass"], ["Failed", count("fail"), "fail"], ["Exhibits", exhibits.length, ""],
  ]) {
    counts.append(el("div", `count ${tone}`, el("b", "", String(number)), el("span", "label", label)));
  }
  const meta = el("dl", "meta");
  const sha = (value) => {
    const code = el("code", "", value?.slice(0, 12) ?? "—");
    if (value) code.title = value;
    return code;
  };
  for (const [label, value] of [
    ["Branch", el("span", "branch", run.git.branch ?? "—")],
    ["Commit", sha(run.git.headSha)],
    ["Base", sha(run.git.baseSha)],
    ["Worktree", run.git.dirty === undefined ? "Not recorded" : run.git.dirty ? "Dirty" : "Clean"],
    ["Platform", run.platform],
    ...(run.agent ? [["Agent", run.agent]] : []),
    ["Started", timestamp(run.createdAt)],
    ...(run.verdict ? [["Ended", timestamp(run.endedAt)]] : []),
  ]) {
    meta.append(el("div", "", el("dt", "", label), el("dd", "", value)));
  }
  const verdict = el("div", "verdict",
    result === "pass" || result === "fail"
      ? el("span", `stamp ${result}`, verdicts[result])
      : badge(result, verdicts[result]));
  if (run.summary) verdict.append(el("p", "note", run.summary));
  app.append(el("section", "summary",
    el("div", "", el("p", "label case-label", `Case ${run.id.slice(0, 8)}`), title, meta, counts), verdict));
  app.append(el("section", "evidence",
    el("h2", "", "Evidence timeline"),
    exhibits.length ? el("ol", "timeline", ...exhibits.map((exhibit, index) => renderExhibit(run, exhibit, index)))
      : el("p", "empty", "No exhibits recorded.")));
  return title;
}

function renderExhibit(run, { kind, item }, index) {
  const isStep = kind === "ui";
  const title = isStep ? item.action : item.target;
  const number = index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
  const header = el("header", "exhibit-head", el("span", "tag", `Exhibit ${number}`),
    el("span", "kind mono", isStep ? "UI step" : "Logic check"), el("h3", "", title));
  if (item.createdAt) {
    const seconds = (Date.parse(item.createdAt) - Date.parse(run.createdAt)) / 1000;
    const time = el("time", "exhibit-time mono", `${seconds >= 0 ? "+" : ""}${seconds.toFixed(3)}s`);
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
      return el("div", "missing", failed.has(side) ? "Screenshot could not load" : "No screenshot recorded");
    }
    const img = el("img", "shot");
    img.alt = `${label} — ${step.action}`;
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
      const comparison = el("div", "comparison", picture("before", "Before"), picture("after", "After"));
      comparison.children[1].classList.add("after");
      const handle = el("span", "handle");
      handle.setAttribute("aria-hidden", "true");
      const slider = el("input", "");
      slider.type = "range";
      slider.min = "0";
      slider.max = "100";
      slider.value = "50";
      slider.setAttribute("aria-label", `Before and after comparison for ${step.action}`);
      const update = () => {
        comparison.style.setProperty("--position", `${slider.value}%`);
        slider.setAttribute("aria-valuetext", `${slider.value}% before, ${100 - Number(slider.value)}% after`);
      };
      slider.addEventListener("input", update);
      update();
      comparison.append(handle, el("span", "cap left", "Before"), el("span", "cap right", "After"), slider);
      screenshots.replaceChildren(comparison);
    } else {
      screenshots.replaceChildren(el("div", "single", ...sides.map((side) => {
        const label = side === "before" ? "Before" : "After";
        return el("figure", "", el("figcaption", "label", label), el("div", "thumb", picture(side, label)));
      })));
    }
  }

  screenshots.tabIndex = -1;
  screenshots.setAttribute("role", "group");
  screenshots.setAttribute("aria-label", "Screenshots");
  draw();
  const content = el("div", "exhibit-body", screenshots);
  if (step.note) content.append(el("p", "note", step.note));
  return content;
}

function renderCheck(check) {
  const display = (value) => JSON.stringify(value, null, 2);
  const columns = [["Before", "before"], ["After", "after"], ["Expected", "expected"]];
  const changed = Object.hasOwn(check, "after") && display(check.before) !== display(check.after);
  const tones = { before: changed ? "removed" : "", after: check.result === "fail" ? "mismatch" : changed ? "added" : "" };
  const diff = el("dl", "diff", ...columns.map(([label, key]) => {
    const present = Object.hasOwn(check, key);
    return el("div", present ? tones[key] : "", el("dt", "label", label),
      el("dd", "", present ? el("pre", "", display(check[key])) : el("span", "muted", "Not recorded")));
  }));
  const input = el("dl", "input",
    el("dt", "label", "Input"), el("dd", "", el("pre", "", JSON.stringify(check.input))));
  const content = el("div", "exhibit-body", input, diff);
  if (check.error) content.append(el("p", "error", el("span", "label", "Error"), el("code", "", check.error)));
  return content;
}

function render(moveFocus = false) {
  if (!files) return;
  const id = location.hash.startsWith("#case/") ? location.hash.slice(6) : "";
  const run = files.runs.find((item) => item.id === id);
  breadcrumb.hidden = !id;
  breadcrumb.textContent = id ? ` / ${run ? run.id.slice(0, 8) : "Case unavailable"}` : "";
  document.title = `${run?.title ?? "Case files"} · alibai`;
  app.replaceChildren();
  let title;
  if (run) title = showCase(run);
  else if (id) {
    title = heading("Case unavailable");
    app.append(title, link("Back to case files", "#"));
  } else title = showList();
  if (moveFocus) {
    title.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
}

window.addEventListener("hashchange", () => render(true));
fetch("/api/runs")
  .then((response) => {
    if (!response.ok) throw new Error("Could not load case files.");
    return response.json();
  })
  .then((data) => {
    files = data;
    document.getElementById("project").textContent = data.project;
    render();
  })
  .catch(() => {
    app.replaceChildren(heading("Case files"), el("p", "error", "Could not load case files. Reload to try again."));
  })
  .finally(() => app.removeAttribute("aria-busy"));
