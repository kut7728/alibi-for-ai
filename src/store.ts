import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { assertRun, parseJson, runId, type Run } from "./report";

function hasCode(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code;
}

async function requireDirectory(path: string): Promise<void> {
  if (!(await lstat(path)).isDirectory()) throw new Error(`Expected a directory at ${path}.`);
}

async function createDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (!hasCode(error, "EEXIST")) throw error;
    await requireDirectory(path);
  }
}

async function save(directory: string, run: Run): Promise<void> {
  const path = join(directory, "run.json");
  assertRun(run, path);
  const temporary = join(directory, `.run-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(run, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

type StoredRun = { path: string; run: Run };
export type InvalidRun = { id: string; path: string; error: string };

export class RunStore {
  private readonly home: string;
  private readonly runs: string;

  constructor(root: string) {
    this.home = join(root, ".alibai");
    this.runs = join(this.home, "runs");
  }

  async start(run: Run): Promise<StoredRun> {
    await createDirectory(this.home);
    await writeFile(join(this.home, ".gitignore"), "*\n", { flag: "wx" }).catch((error: unknown) => {
      if (!hasCode(error, "EEXIST")) throw error;
    });
    await createDirectory(this.runs);
    const staging = await mkdtemp(join(this.runs, ".start-"));
    const directory = join(this.runs, run.id);
    try {
      await mkdir(join(staging, "screenshots"));
      await save(staging, run);
      await rename(staging, directory);
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    return { path: join(directory, "run.json"), run };
  }

  private async read(directory: string, id: string): Promise<StoredRun> {
    const path = join(directory, "run.json");
    if (!(await lstat(path)).isFile()) throw new Error(`Expected a regular file at ${path}.`);
    const run = parseJson(await readFile(path, "utf8"), path);
    assertRun(run, path);
    if (run.id !== id) throw new Error(`Run id in ${path} does not match its directory.`);
    return { path, run };
  }

  async list(): Promise<{ runs: StoredRun[]; invalidRuns: InvalidRun[] }> {
    try {
      await requireDirectory(this.home);
      await requireDirectory(this.runs);
    } catch (error) {
      if (hasCode(error, "ENOENT")) return { runs: [], invalidRuns: [] };
      throw error;
    }
    const entries = await readdir(this.runs, { withFileTypes: true });
    const discovered = await Promise.all(entries
      .filter((entry) => entry.isDirectory() && runId.test(entry.name))
      .map(async ({ name: id }) => {
        const directory = join(this.runs, id);
        try {
          return await this.read(directory, id);
        } catch (error) {
          return { id, path: join(directory, "run.json"), error: (error as Error).message };
        }
      }));
    const runs = discovered.filter((entry) => "run" in entry);
    const invalidRuns = discovered.filter((entry) => "error" in entry);
    runs.sort((a, b) => b.run.createdAt.localeCompare(a.run.createdAt) || b.run.id.localeCompare(a.run.id));
    invalidRuns.sort((a, b) => a.id.localeCompare(b.id));
    return { runs, invalidRuns };
  }

  async mutate(
    id: string,
    edit: (run: Run, screenshot: (source: string, name: string) => Promise<string>) => Promise<void>,
  ): Promise<StoredRun> {
    if (!runId.test(id)) throw new Error("--run must be a run UUID.");

    const directory = join(this.runs, id);
    try {
      await requireDirectory(this.home);
      await requireDirectory(this.runs);
      await requireDirectory(directory);
    } catch (error) {
      if (hasCode(error, "ENOENT")) throw new Error(`Run ${id} was not found.`);
      throw error;
    }
    const lock = join(directory, ".lock");
    const deadline = Date.now() + 5000;
    // shortcut: recover interrupted writers manually as lock age cannot prove that a writer has exited.
    for (;;) {
      try {
        await mkdir(lock);
        break;
      } catch (error) {
        if (!hasCode(error, "EEXIST")) throw error;
        if (Date.now() >= deadline) {
          const quotedLock = "'" + lock.replaceAll("'", "'\\''") + "'";
          throw new Error(
            `Run ${id} is locked. Wait for active or pending writers to finish. ` +
            `If all writers for this run have exited, remove the empty lock with rmdir -- ${quotedLock} and retry.`,
          );
        }
        await delay(25);
      }
    }

    const copied: string[] = [];
    try {
      const stored = await this.read(directory, id);
      if (stored.run.verdict !== undefined) throw new Error(`Run ${id} is already completed.`);
      await edit(stored.run, async (source, name) => {
        const sourceStat = await stat(source).catch((error: unknown) => {
          if (!hasCode(error, "ENOENT")) throw error;
          throw new Error(`Screenshot was not found: ${source}`);
        });
        if (!sourceStat.isFile()) throw new Error(`Screenshot must be a regular file: ${source}`);
        await requireDirectory(join(directory, "screenshots"));
        const relative = `screenshots/${name}${extname(source).toLowerCase()}`;
        const destination = join(directory, relative);
        await copyFile(source, destination, constants.COPYFILE_EXCL);
        copied.push(destination);
        return relative;
      });
      await save(directory, stored.run);
      return stored;
    } catch (error) {
      await Promise.allSettled(copied.map((path) => rm(path, { force: true })));
      throw error;
    } finally {
      await rmdir(lock).catch(() => {});
    }
  }
}
