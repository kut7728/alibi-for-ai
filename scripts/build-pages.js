const { lstat, mkdir, readFile, realpath, rm, writeFile } = require("node:fs/promises");
const { dirname, join } = require("node:path");
const { assertRun, parseJson } = require("../dist/report");

const example = "examples/cart-rounding";
const assets = [
  "index.html", "favicon.svg", "tokens.css", "viewer.css", "messages.js", "viewer.js",
  "fonts/OFL.txt",
  ...["Sans-Regular", "Sans-SemiBold", "SansCondensed-Bold", "Mono-Regular", "Mono-SemiBold", "Mono-Bold"]
    .map((font) => `fonts/IBMPlex${font}-Latin1.woff2`),
];

async function buildPages(directory) {
  const root = await realpath(directory);
  const output = join(root, "_site");
  async function readSource(name) {
    const path = join(root, name);
    if (await realpath(path) !== path || !(await lstat(path)).isFile()) {
      throw new Error(`Expected a regular source file without symlinks: ${name}`);
    }
    return readFile(path);
  }

  const report = `${example}/run.json`;
  const run = parseJson((await readSource(report)).toString("utf8"), report);
  assertRun(run, report);
  const files = new Map();
  for (const name of assets) files.set(name, await readSource(`viewer/${name}`));
  for (const name of new Set(run.steps.flatMap(({ before, after }) => [before, after]).filter(Boolean))) {
    if (!name.endsWith(".png")) throw new Error(`Expected a PNG demo screenshot: ${name}`);
    files.set(`screenshots/${run.id}/${name.split("/")[1]}`, await readSource(`${example}/${name}`));
  }
  const index = files.get("index.html").toString("utf8");
  const staticIndex = index.replace('<html lang="en">', '<html lang="en" data-runs-url="./runs.json">');
  if (staticIndex === index) throw new Error('Expected <html lang="en"> in viewer/index.html');
  files.set("index.html", staticIndex);
  files.set("runs.json", JSON.stringify({ project: "Field Supply (demo)", runs: [run], invalidRuns: [] }, null, 2) + "\n");

  await rm(output, { recursive: true, force: true });
  for (const [name, content] of files) {
    const path = join(output, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  return output;
}

module.exports = { buildPages };

if (require.main === module) {
  buildPages(join(__dirname, "..")).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
