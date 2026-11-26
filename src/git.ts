import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { GitChanges, GitMetadata } from "./report";

function gitCommand(cwd: string, ...args: string[]) {
  return spawnSync("git", args, {
    cwd,
    env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    // shortcut: cap each Git read at 32 MiB, stream patches if larger snapshots are needed.
    maxBuffer: 32 * 1024 * 1024,
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

export function gitChanges(root: string, headSha = gitText(gitCommand(root, "rev-parse", "--verify", "HEAD^{commit}"))):
  { dirty?: boolean; changes?: GitChanges | null } {
  const status = gitBytes(gitCommand(root, "--no-optional-locks", "status",
    "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"))?.toString("utf8");
  if (status === undefined) return { changes: null };
  const dirty = status.length > 0;
  const paths = [...new Set(status.split("\0").filter(Boolean).map((entry) => entry.slice(3))
    .filter((path) => path !== ".alibai" && !path.startsWith(".alibai/")))].sort();
  if (paths.length === 0) return { dirty };

  let diffSha256: string | null = null;
  if (headSha) {
    const diff = (...revisions: string[]) => gitBytes(gitCommand(root, "--no-optional-locks", "diff",
      "--binary", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--no-relative",
      "--submodule=short", "--src-prefix=a/", "--dst-prefix=b/", ...revisions,
      "--", ":(top,exclude,literal).alibai"));
    const staged = diff("--cached", headSha);
    const unstaged = diff();
    if (staged && unstaged && (staged.length > 0 || unstaged.length > 0)) {
      // Frame the two patches so moving the same change into the index changes the digest.
      diffSha256 = createHash("sha256").update(`${staged.length}\n`)
        .update(staged).update(unstaged).digest("hex");
    }
  }
  return { dirty, changes: { paths, diffSha256 } };
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
