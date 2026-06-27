import { copy, ensureDir, exists } from "@std/fs";
import { dirname } from "@std/path";
import {
  memoryDir as memoryDirFor,
  projectDir,
  type Roots,
  transcriptPath,
} from "./paths.ts";
import {
  type ClaudeConfig,
  extractProjectEntry,
  mergeProjectEntry,
  readConfig,
  removeProjectEntry,
  rewriteProjectEntry,
  writeConfig,
} from "./config.ts";

export interface MoveOptions {
  /** Assign a fresh session id at the destination instead of reusing the old one. */
  fork: boolean;
  /** The new id to use when `fork` is true. Supplied by the shell (pure core stays deterministic). */
  newSessionId?: string;
}

export interface MoveResult {
  fromTranscript: string;
  toTranscript: string;
  sessionId: string;
  movedMemory: boolean;
  movedConfig: boolean;
}

/**
 * Relocate a session transcript (and its `memory/` + `~/.claude.json` sidecars)
 * from one working directory's encoded folder to another's, on the same machine.
 *
 * The transcript is moved as an OPAQUE blob — never parsed. With `fork`, the
 * destination gets a brand-new session id so the two directories can never point
 * at one transcript file.
 */
export async function moveSession(
  roots: Roots,
  sessionId: string,
  fromCwd: string,
  toCwd: string,
  opts: MoveOptions,
): Promise<MoveResult> {
  const fromTranscript = transcriptPath(roots, fromCwd, sessionId);
  if (!(await exists(fromTranscript))) {
    throw new Error(`session transcript not found: ${fromTranscript}`);
  }

  let destId = sessionId;
  if (opts.fork) {
    if (!opts.newSessionId) throw new Error("fork requires a new session id");
    destId = opts.newSessionId;
  }
  const toTranscript = transcriptPath(roots, toCwd, destId);

  if (fromTranscript === toTranscript) {
    throw new Error("source and destination resolve to the same transcript");
  }
  if (await exists(toTranscript)) {
    throw new Error(`destination transcript already exists: ${toTranscript}`);
  }

  await ensureDir(dirname(toTranscript));
  await copy(fromTranscript, toTranscript);
  await Deno.remove(fromTranscript);

  // Memory sidecar.
  let movedMemory = false;
  const fromMemory = memoryDirFor(roots, fromCwd);
  if (await exists(fromMemory)) {
    const toMemory = memoryDirFor(roots, toCwd);
    await ensureDir(dirname(toMemory));
    await copy(fromMemory, toMemory, { overwrite: true });
    await Deno.remove(fromMemory, { recursive: true });
    movedMemory = true;
  }

  // Project config entry: re-key from old cwd to new cwd.
  let movedConfig = false;
  const config = await readConfig(roots.configPath);
  const entry = extractProjectEntry(config, fromCwd);
  if (entry !== null) {
    const rewritten = rewriteProjectEntry(entry, { sessionId: destId });
    let next: ClaudeConfig = mergeProjectEntry(config, toCwd, rewritten);
    if (fromCwd !== toCwd) next = removeProjectEntry(next, fromCwd);
    await writeConfig(roots.configPath, next);
    movedConfig = true;
  }

  // Clean up an emptied source project folder (best effort).
  await removeIfEmpty(projectDir(roots, fromCwd));

  return {
    fromTranscript,
    toTranscript,
    sessionId: destId,
    movedMemory,
    movedConfig,
  };
}

async function removeIfEmpty(dir: string): Promise<void> {
  try {
    for await (const _ of Deno.readDir(dir)) return; // not empty
    await Deno.remove(dir);
  } catch {
    // missing or non-empty-with-races: leave it alone
  }
}
