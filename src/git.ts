import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readlinkSync, readSync, realpathSync } from "node:fs";
import { sep } from "node:path";
import type { GitChanges, GitMetadata } from "./report";

const readLimit = 32 * 1024 * 1024;

function gitCommand(cwd: string, ...args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_NO_LAZY_FETCH: "1", LC_ALL: "C" };
  // Git gives this environment variable precedence over --unified.
  delete env.GIT_DIFF_OPTS;
  return spawnSync("git", args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    // shortcut: cap each Git read at 32 MiB, stream patches if larger snapshots are needed.
    maxBuffer: readLimit,
  });
}

function gitBytes(result: ReturnType<typeof gitCommand>): Buffer | null {
  return !result.error && result.status === 0 ? result.stdout : null;
}

function gitText(result: ReturnType<typeof gitCommand>): string | null {
  return gitBytes(result)?.toString("utf8").replace(/\r?\n$/, "") ?? null;
}

export function gitRoot(): string {
  const result = gitCommand(process.cwd(), "rev-parse", "--show-toplevel");
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
    throw new Error("Git must be installed to use alibai.");
  }
  if (result.error) throw result.error;
  const root = gitText(result);
  if (!root) throw new Error("Run alibai from a Git working tree.");
  return root;
}

function untrackedDigest(file: Buffer, rootPrefix: Buffer) {
  const entry = lstatSync(file);
  if (entry.isSymbolicLink()) {
    return { kind: "l", digest: createHash("sha256").update(readlinkSync(file, { encoding: "buffer" })).digest() };
  }
  // Git lists paths below the root. Check that parent links haven't redirected a file outside it.
  if (!entry.isFile()) return null;
  const resolved = realpathSync.native(file, { encoding: "buffer" });
  if (!resolved.subarray(0, rootPrefix.length).equals(rootPrefix)) return null;
  const fd = openSync(resolved, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.dev !== entry.dev || stat.ino !== entry.ino || stat.size > readLimit) return null;
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let total = 0;
    for (;;) {
      const size = readSync(fd, buffer, 0, Math.min(buffer.length, readLimit - total + 1), null);
      if (size === 0) return { kind: "f", digest: hash.digest() };
      total += size;
      if (total > readLimit) return null;
      hash.update(buffer.subarray(0, size));
    }
  } finally {
    closeSync(fd);
  }
}

function snapshotDigest(root: string, headSha: string, untracked: Buffer[]): string | null {
  const diff = (...revisions: string[]) => gitBytes(gitCommand(root, "--no-optional-locks",
    "-c", "core.quotePath=true", "-c", "core.bigFileThreshold=512m", "-c", "diff.suppressBlankEmpty=false",
    "-c", "diff.mnemonicPrefix=false", "-c", "diff.noprefix=false",
    "diff", "--binary", "--full-index", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--no-relative",
    "--submodule=short", "--src-prefix=a/", "--dst-prefix=b/", "-O/dev/null",
    "--diff-algorithm=myers", "--unified=3", "--inter-hunk-context=0", "--indent-heuristic", ...revisions,
    "--", ":(top,exclude,literal).alibai"));
  const staged = diff("--cached", headSha);
  const unstaged = diff();
  if (!staged || !unstaged || !(staged.length || unstaged.length || untracked.length)) return null;

  // Lengths distinguish the two patches and each path. File digests are always 32 bytes.
  const hash = createHash("sha256").update(`${staged.length}\n${unstaged.length}\n`).update(staged).update(unstaged);
  try {
    if (untracked.length) {
      const realRoot = realpathSync(root);
      const rootPrefix = Buffer.from(realRoot.endsWith(sep) ? realRoot : realRoot + sep);
      for (const path of untracked.sort(Buffer.compare)) {
        const file = untrackedDigest(Buffer.concat([rootPrefix, path]), rootPrefix);
        if (!file) return null;
        hash.update(`${file.kind}${path.length}\n`).update(path).update(file.digest);
      }
    }
    return hash.digest("hex");
  } catch {
    return null;
  }
}

export function gitChanges(root: string, headSha = gitText(gitCommand(root, "rev-parse", "--verify", "HEAD^{commit}"))):
  { dirty?: boolean; changes?: GitChanges | null } {
  const status = gitBytes(gitCommand(root, "--no-optional-locks", "status",
    "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"));
  if (!status) return { changes: null };
  const dirty = status.length > 0;
  const paths = new Set<string>();
  const untracked: Buffer[] = [];
  for (let offset = 0; offset < status.length;) {
    const end = status.indexOf(0, offset);
    if (end < offset + 4) return { changes: null };
    const path = status.subarray(offset + 3, end);
    const name = path.toString("utf8");
    if (name !== ".alibai" && !name.startsWith(".alibai/")) {
      paths.add(name);
      if (status.toString("ascii", offset, offset + 2) === "??") untracked.push(path);
    }
    offset = end + 1;
  }
  if (paths.size === 0) return { dirty };
  const diffSha256 = headSha ? snapshotDigest(root, headSha, untracked) : null;
  return { dirty, changes: { paths: [...paths].sort(), diffSha256 } };
}

export function gitMetadata(root: string, base?: string): GitMetadata {
  const git = (...args: string[]) => gitText(gitCommand(root, ...args));
  const branch = git("symbolic-ref", "--quiet", "HEAD")?.replace(/^refs\/heads\//, "") ?? null;
  const headSha = git("rev-parse", "--verify", "HEAD^{commit}");
  const { dirty, changes: startChanges } = gitChanges(root, headSha);
  const metadata = { branch, headSha, dirty, startChanges };
  if (base !== undefined) {
    const baseSha = git("rev-parse", "--verify", "--end-of-options", `${base}^{commit}`);
    if (!baseSha) throw new Error(`--base does not resolve to a local commit: ${base}`);
    return { ...metadata, baseSha };
  }

  if (headSha) {
    for (const ref of [
      "refs/remotes/origin/HEAD", "refs/remotes/origin/main", "refs/heads/main",
      "refs/remotes/origin/master", "refs/heads/master",
    ]) {
      const baseSha = git("merge-base", headSha, ref);
      if (baseSha && baseSha !== headSha) return { ...metadata, baseSha };
    }
    return { ...metadata, baseSha: git("rev-parse", "--verify", `${headSha}^1`) };
  }

  return { ...metadata, baseSha: null };
}
