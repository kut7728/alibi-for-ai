#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import { gitMetadata, gitRoot } from "./git";
import { parseJson, type Platform, type Result, type Step } from "./report";
import { RunStore, type InvalidRun } from "./store";

const flagNames = {
  "run start": ["title", "platform", "agent", "base"],
  step: ["run", "action", "before", "after", "note", "result"],
  check: ["run", "target", "input", "before", "after", "expected", "error", "result"],
  "run end": ["run", "verdict", "summary"],
  list: [],
} as const;
const usage = `Usage
  alibai run start --title <title> [--platform <platform>] [--agent <name>] [--base <ref>]
  alibai step --action <action> [--before <file>] [--after <file>] [--note <text>] [--result <result>] [--run <id>]
  alibai check --target <target> --input <json> --before <json> [--after <json>]
               [--expected <json>] [--error <text>] [--result <result>] [--run <id>]
  alibai run end --verdict <result> [--summary <text>] [--run <id>]
  alibai list

Provide at least one PNG, JPG, JPEG, or WebP screenshot for step.
Provide --after for check unless recording --error. Results and verdicts are pass, fail, or info.
Add --json to any command for machine-readable output.`;

const platforms: readonly Platform[] = ["flutter", "ios", "android", "web"];
const results: readonly Result[] = ["pass", "fail", "info"];
const options: ParseArgsOptionsConfig = {
  ...Object.fromEntries(Object.values(flagNames).flat().map((flag) => [flag, { type: "string" }])),
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
};

function textFlag(value: string | undefined, flag: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`--${flag} requires a non-empty value.`);
  return trimmed;
}

function choice<T extends string>(value: string | undefined, flag: string, allowed: readonly T[]): T {
  const selected = allowed.find((option) => option === value);
  if (!selected) throw new Error(`--${flag} must be one of ${allowed.join(", ")}.`);
  return selected;
}

const args = process.argv.slice(2);
const terminator = args.indexOf("--");
const trailing = terminator === -1 ? [] : args.slice(terminator + 1);
const { values, positionals } = parseArgs({
  args: terminator === -1 ? args : args.slice(0, terminator),
  options,
  strict: false,
  allowPositionals: true,
});
const json = values.json === true;

async function main(): Promise<void> {
  for (const flag of ["json", "help"]) {
    if (typeof values[flag] === "string") throw new Error(`--${flag} does not take a value.`);
  }
  const optionNames = Object.keys(values).filter((flag) => flag !== "json" && flag !== "help");
  if (values.help === true || (positionals.length === 0 && trailing.length === 0 && optionNames.length === 0)) {
    console.log(json ? JSON.stringify({ usage }) : usage);
    return;
  }

  const [first, second] = positionals;
  const command = first === "run" ? `run ${second ?? ""}` : first;
  if (!command || !Object.hasOwn(flagNames, command)) {
    throw new Error(`Unknown command "${command?.trim()}". See alibai --help.`);
  }
  const allowed: readonly string[] = flagNames[command as keyof typeof flagNames];
  for (const flag of optionNames) {
    if (!allowed.includes(flag)) throw new Error(`Unknown option '--${flag}'.`);
    if (typeof values[flag] !== "string") throw new Error(`--${flag} requires a value.`);
  }
  const unexpected = positionals[first === "run" ? 2 : 1] ?? trailing[0];
  if (unexpected !== undefined) throw new Error(`Unexpected argument "${unexpected}".`);
  const flags = values as Record<string, string | undefined>;
  const store = new RunStore(gitRoot());
  const printMutation = ({ path, run }: { path: string; run: { id: string } }) => {
    console.log(json ? JSON.stringify({ id: run.id, path }) : `${run.id}\t${path}`);
  };
  const warnInvalid = (invalidRuns: InvalidRun[]) => {
    for (const { path, error } of invalidRuns) console.error(`alibai: Skipping invalid run at ${path} (${error}).`);
  };
  const selectRun = async () => {
    if (flags.run !== undefined) return flags.run;
    const { runs, invalidRuns } = await store.list();
    warnInvalid(invalidRuns);
    const selected = runs.find(({ run }) => run.verdict === undefined);
    if (!selected) throw new Error("No open run. Start one with alibai run start.");
    return selected.run.id;
  };

  switch (command) {
    case "run start": {
      const title = textFlag(flags.title, "title");
      const platform = choice(flags.platform ?? "web", "platform", platforms);
      const agent = flags.agent === undefined ? undefined : textFlag(flags.agent, "agent");
      const base = flags.base === undefined ? undefined : textFlag(flags.base, "base");
      printMutation(await store.start({
        formatVersion: 1,
        id: randomUUID(),
        title,
        createdAt: new Date().toISOString(),
        platform,
        git: gitMetadata(base),
        agent,
        steps: [],
        checks: [],
      }));
      break;
    }
    case "step": {
      const action = textFlag(flags.action, "action");
      const result = choice(flags.result ?? "info", "result", results);
      if (flags.before === undefined && flags.after === undefined) {
        throw new Error("Provide at least one screenshot with --before or --after.");
      }
      for (const source of [flags.before, flags.after]) {
        if (source !== undefined && !/^\.(?:png|jpe?g|webp)$/i.test(extname(source))) {
          throw new Error(`Screenshot must use a PNG, JPG, JPEG, or WebP extension: ${source}`);
        }
      }
      printMutation(await store.mutate(await selectRun(), async (run, screenshot) => {
        const step: Step = {
          id: randomUUID(), order: run.steps.length + 1, action, createdAt: new Date().toISOString(),
          note: flags.note ?? "", result,
        };
        if (flags.before !== undefined) step.before = await screenshot(flags.before, `${step.id}-before`);
        if (flags.after !== undefined) step.after = await screenshot(flags.after, `${step.id}-after`);
        run.steps.push(step);
      }));
      break;
    }
    case "check": {
      const target = textFlag(flags.target, "target");
      const input = parseJson(textFlag(flags.input, "input"), "--input");
      const before = parseJson(textFlag(flags.before, "before"), "--before");
      const expected = flags.expected === undefined ? undefined : parseJson(flags.expected, "--expected");
      const error = flags.error === undefined ? undefined : textFlag(flags.error, "error");
      const outcome = flags.after === undefined && error !== undefined
        ? { error }
        : { after: parseJson(textFlag(flags.after, "after"), "--after"), error };
      const result = choice(flags.result ?? "info", "result", results);
      printMutation(await store.mutate(await selectRun(), async (run) => {
        run.checks.push({ id: randomUUID(), target, createdAt: new Date().toISOString(), input, before, expected, result, ...outcome });
      }));
      break;
    }
    case "run end": {
      const verdict = choice(flags.verdict, "verdict", results);
      const summary = flags.summary ?? `Verdict recorded as ${verdict}.`;
      if (!summary.trim() || /[\r\n\u2028\u2029]/u.test(summary)) {
        throw new Error("--summary requires one non-empty line.");
      }
      printMutation(await store.mutate(await selectRun(), async (run) => {
        run.verdict = verdict;
        run.summary = summary.trim();
        run.endedAt = new Date().toISOString();
      }));
      break;
    }
    case "list": {
      const { runs: stored, invalidRuns } = await store.list();
      const runs = stored.map(({ path, run }) => ({
        id: run.id,
        path,
        title: run.title,
        createdAt: run.createdAt,
        platform: run.platform,
        verdict: run.verdict ?? null,
      }));
      if (json) console.log(JSON.stringify({ runs, invalidRuns }));
      else {
        warnInvalid(invalidRuns);
        if (runs.length === 0) console.log("No runs recorded.");
        else for (const run of runs) console.log(`${run.id}\t${run.verdict ?? "open"}\t${run.title}\t${run.path}`);
      }
      break;
    }
  }
}

main().catch((error: Error) => {
  console.error(json ? JSON.stringify({ error: error.message }) : `alibai: ${error.message}`);
  process.exitCode = 1;
});
