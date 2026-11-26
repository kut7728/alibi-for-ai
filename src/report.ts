import Ajv from "ajv/dist/2020";
import schema from "./run.schema.json";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Result = "pass" | "fail" | "info";
export type Platform = "flutter" | "ios" | "android" | "web";
export type GitMetadata = { branch: string | null; baseSha: string | null; headSha: string | null };
export type Step = {
  id: string;
  order: number;
  action: string;
  before?: string;
  after?: string;
  note: string;
  result: Result;
};
export type Check = {
  id: string;
  target: string;
  input: Json;
  before: Json;
  after: Json;
  expected?: Json;
  error?: string;
  result: Result;
};
export type Run = {
  formatVersion: 1;
  id: string;
  title: string;
  createdAt: string;
  git: GitMetadata;
  agent?: string;
  platform: Platform;
  steps: Step[];
  checks: Check[];
} & ({ verdict?: never; summary?: never } | { verdict: Result; summary: string });

export const runId = new RegExp(schema.$defs.id.pattern);
let validate: ReturnType<Ajv["compile"]> | undefined;

export function assertRun(value: unknown, label: string): asserts value is Run {
  validate ??= new Ajv({ strictRequired: false })
    .addFormat("date-time", (value: string) => {
      const time = Date.parse(value);
      return Number.isFinite(time) && new Date(time).toISOString() === value;
    })
    .compile(schema);
  if (!validate(value)) {
    const error = validate.errors?.[0];
    throw new Error(`${label}: invalid run format at ${error?.instancePath || "/"} (${error?.message}).`);
  }
}

export function parseJson(value: string, label: string): Json {
  try {
    return JSON.parse(value, (_key, parsed: unknown) => {
      if (typeof parsed === "number" && !Number.isFinite(parsed)) {
        throw new Error("number is outside the supported range");
      }
      return parsed;
    });
  } catch (error) {
    throw new Error(`${label}: invalid JSON (${(error as Error).message}).`);
  }
}
