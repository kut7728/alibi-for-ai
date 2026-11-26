#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import { gitMetadata, gitRoot } from "./git";
import { parseJson, type Platform, type Result, type Step } from "./report";
import { RunStore } from "./store";

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

Provide at least one screenshot for step.
Provide --after for check unless recording --error. Results and verdicts are pass, fail, or info.
Add --json to any command for machine-readable output.`;

const platforms: readonly Platform[] = ["flutter", "ios", "android", "web"];
const results: readonly Result[] = ["pass", "fail", "info"];

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

async function main(args: string[]): Promise<void> {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(json ? JSON.stringify({ usage }) : usage);
    return;
  }

  const first = args.shift();
  const command = first === "run" ? `run ${args.shift() ?? ""}` : first;
  if (!command || !Object.hasOwn(flagNames, command)) {
    throw new Error(`Unknown command "${command?.trim()}". See alibai --help.`);
  }
  const options: ParseArgsOptionsConfig = Object.fromEntries(
    flagNames[command as keyof typeof flagNames].map((flag) => [flag, { type: "string" }]),
  );
  const { values } = parseArgs({ args, options });
  const flags = values as Record<string, string | undefined>;
  const store = new RunStore(gitRoot());
  const printMutation = ({ path, run }: { path: string; run: { id: string } }) => {
    console.log(json ? JSON.stringify({ id: run.id, path }) : `${run.id}\t${path}`);
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
      printMutation(await store.mutate(flags.run, async (run, screenshot) => {
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
      printMutation(await store.mutate(flags.run, async (run) => {
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
      printMutation(await store.mutate(flags.run, async (run) => {
        run.verdict = verdict;
        run.summary = summary.trim();
        run.endedAt = new Date().toISOString();
      }));
      break;
    }
    case "list": {
      const runs = (await store.list()).map(({ path, run }) => ({
        id: run.id,
        path,
        title: run.title,
        createdAt: run.createdAt,
        platform: run.platform,
        verdict: run.verdict ?? null,
      }));
      if (json) console.log(JSON.stringify({ runs }));
      else if (runs.length === 0) console.log("No runs recorded.");
      else for (const run of runs) console.log(`${run.id}\t${run.verdict ?? "open"}\t${run.title}\t${run.path}`);
      break;
    }
  }
}

const args = process.argv.slice(2);
const json = args.includes("--json");
main(args.filter((arg) => arg !== "--json")).catch((error: Error) => {
  console.error(json ? JSON.stringify({ error: error.message }) : `alibai: ${error.message}`);
  process.exitCode = 1;
});
