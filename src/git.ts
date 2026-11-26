import { execFileSync } from "node:child_process";
import type { GitMetadata } from "./report";

function git(...args: string[]): string | null {
  try {
    const result = execFileSync("git", args, {
      encoding: "utf8",
      env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return result.replace(/\r?\n$/, "");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("Git must be installed to use alibai.");
    }
    if (typeof (error as { status?: number }).status === "number") return null;
    throw error;
  }
}

export function gitRoot(): string {
  const root = git("rev-parse", "--show-toplevel");
  if (!root) throw new Error("Run alibai from a Git working tree.");
  return root;
}

export function gitMetadata(base?: string): GitMetadata {
  const branch = git("symbolic-ref", "--quiet", "HEAD")?.replace(/^refs\/heads\//, "") ?? null;
  const headSha = git("rev-parse", "--verify", "HEAD^{commit}");
  const status = git("--no-optional-locks", "status", "--porcelain=v1", "--untracked-files=normal");
  if (status === null) throw new Error("Could not read Git working tree status.");
  const dirty = status.length > 0;
  if (base !== undefined) {
    const baseSha = git("rev-parse", "--verify", "--end-of-options", `${base}^{commit}`);
    if (!baseSha) throw new Error(`--base does not resolve to a local commit: ${base}`);
    return { branch, headSha, baseSha, dirty };
  }

  if (headSha) {
    for (const ref of [
      "refs/remotes/origin/HEAD", "refs/remotes/origin/main", "refs/heads/main",
      "refs/remotes/origin/master", "refs/heads/master",
    ]) {
      const baseSha = git("merge-base", headSha, ref);
      if (baseSha && baseSha !== headSha) return { branch, headSha, baseSha, dirty };
    }
    return { branch, headSha, baseSha: git("rev-parse", "--verify", `${headSha}^1`), dirty };
  }

  return { branch, headSha, baseSha: null, dirty };
}
