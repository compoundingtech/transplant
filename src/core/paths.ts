import { join } from "@std/path";
import { encodeCwd } from "./encode.ts";

/**
 * The set of filesystem locations Claude Code state lives under, rooted at a
 * `$HOME`. Kept as data (not read from the environment directly) so the entire
 * core can be exercised against a synthetic fake root in tests.
 */
export interface Roots {
  /** The `~/.claude` directory. */
  claudeDir: string;
  /** The `~/.claude.json` per-project config file. */
  configPath: string;
}

/** Build {@link Roots} from a home directory (defaults to `$HOME`). */
export function rootsFromHome(home: string): Roots {
  return {
    claudeDir: join(home, ".claude"),
    configPath: join(home, ".claude.json"),
  };
}

/** `~/.claude/projects` — the parent of all cwd-keyed transcript folders. */
export function projectsDir(roots: Roots): string {
  return join(roots.claudeDir, "projects");
}

/** `~/.claude/projects/<encoded-cwd>` for a given absolute working directory. */
export function projectDir(roots: Roots, cwd: string): string {
  return join(projectsDir(roots), encodeCwd(cwd));
}

/** `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. */
export function transcriptPath(
  roots: Roots,
  cwd: string,
  sessionId: string,
): string {
  return join(projectDir(roots, cwd), `${sessionId}.jsonl`);
}

/** `~/.claude/projects/<encoded-cwd>/memory` — the optional memory sidecar. */
export function memoryDir(roots: Roots, cwd: string): string {
  return join(projectDir(roots, cwd), "memory");
}
