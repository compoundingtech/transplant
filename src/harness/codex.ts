import { ensureDir, exists, walk } from "@std/fs";
import { basename, join } from "@std/path";
import {
  extractCodexProject,
  readCodexConfig,
  removeCodexProject,
  upsertCodexProject,
  writeCodexConfig,
} from "../core/codex_config.ts";
import type {
  ForkOptions,
  Harness,
  MoveResult,
  PlaceResult,
  SessionRef,
  SessionResources,
} from "./types.ts";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const ROLLOUT_FILE = /^rollout-.*\.jsonl?$/;

function codexDir(home: string): string {
  return join(home, ".codex");
}
function sessionsDir(home: string): string {
  return join(codexDir(home), "sessions");
}
function configPath(home: string): string {
  return join(codexDir(home), "config.toml");
}

/** The session id is the trailing UUID of a rollout filename. */
function uuidFromBasename(name: string): string | null {
  const m = name.match(new RegExp(UUID.source + "(?=\\.jsonl?$)", "i"));
  return m ? m[0] : null;
}

/** Reconstruct a rollout filename for a (possibly forked) session id. */
function rolloutNameFor(originalBasename: string, sessionId: string): string {
  return originalBasename.replace(
    new RegExp(UUID.source + "(\\.jsonl?)$", "i"),
    `${sessionId}$1`,
  );
}

/** Date-bucketed destination for a rollout; falls back to the flat root for the legacy format. */
function rolloutDestPath(home: string, rolloutBasename: string): string {
  const m = rolloutBasename.match(/^rollout-(\d{4})-(\d{2})-(\d{2})T/);
  const root = sessionsDir(home);
  return m
    ? join(root, m[1], m[2], m[3], rolloutBasename)
    : join(root, rolloutBasename);
}

/** Best-effort peek of the `session_meta` first line for the recorded cwd. Never throws. */
async function peekCwd(path: string): Promise<string | null> {
  try {
    using file = await Deno.open(path, { read: true });
    const buf = new Uint8Array(64 * 1024);
    const n = await file.read(buf);
    if (n === null) return null;
    const text = new TextDecoder().decode(buf.subarray(0, n));
    const firstLine = text.split("\n", 1)[0]?.trim();
    if (!firstLine) return null;
    const obj = JSON.parse(firstLine) as Record<string, unknown>;
    const payload = obj.payload as Record<string, unknown> | undefined;
    const cwd = payload?.cwd ?? obj.cwd;
    return typeof cwd === "string" ? cwd : null;
  } catch {
    return null;
  }
}

async function toRef(path: string): Promise<SessionRef | null> {
  const name = basename(path);
  const sessionId = uuidFromBasename(name);
  if (!sessionId) return null;
  const stat = await Deno.stat(path);
  return {
    harness: "codex",
    sessionId,
    transcriptPath: path,
    transcriptBasename: name,
    cwd: await peekCwd(path),
    lastModified: stat.mtime?.getTime() ?? 0,
    fileSize: stat.size,
    summary: null,
  };
}

/**
 * Codex harness. Sessions ("rollouts") live at
 * `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl` (date+uuid-keyed, NOT
 * cwd-keyed); the cwd is recorded inside the `session_meta` line. The only
 * cwd-keyed sidecar is the `config.toml` `[projects."<cwd>"]` trust entry.
 * `auth.json` (credentials) and the global history/state stores are deliberately
 * never migrated — see the README resource inventory.
 */
export class CodexHarness implements Harness {
  readonly name = "codex" as const;

  detect(home: string): Promise<boolean> {
    return exists(codexDir(home));
  }

  async list(home: string): Promise<SessionRef[]> {
    const root = sessionsDir(home);
    if (!(await exists(root))) return [];
    const refs: SessionRef[] = [];
    for await (const entry of walk(root, { includeDirs: false })) {
      if (!ROLLOUT_FILE.test(entry.name)) continue;
      const ref = await toRef(entry.path);
      if (ref) refs.push(ref);
    }
    refs.sort((a, b) => b.lastModified - a.lastModified);
    return refs;
  }

  async find(home: string, sessionId: string): Promise<SessionRef | null> {
    for (const ref of await this.list(home)) {
      if (ref.sessionId === sessionId) return ref;
    }
    return null;
  }

  async collect(home: string, ref: SessionRef): Promise<SessionResources> {
    const transcript = await Deno.readFile(ref.transcriptPath);
    let configEntry: Record<string, unknown> | null = null;
    if (ref.cwd) {
      const config = await readCodexConfig(configPath(home));
      configEntry = extractCodexProject(config, ref.cwd);
    }
    return {
      transcript,
      transcriptBasename: ref.transcriptBasename,
      sidecars: [],
      configEntry,
      configKind: configEntry !== null ? "codex-toml" : null,
    };
  }

  async place(
    home: string,
    toCwd: string,
    sessionId: string,
    res: SessionResources,
  ): Promise<PlaceResult> {
    const destName = rolloutNameFor(res.transcriptBasename, sessionId);
    const dest = rolloutDestPath(home, destName);
    await ensureDir(join(dest, ".."));
    await Deno.writeFile(dest, res.transcript);

    const mergedConfig = await mergeTrust(home, toCwd, res.configEntry);
    return {
      transcriptPath: dest,
      sessionId,
      toCwd,
      sidecarsWritten: 0,
      mergedConfig,
    };
  }

  async move(
    home: string,
    ref: SessionRef,
    toCwd: string,
    opts: ForkOptions,
  ): Promise<MoveResult> {
    // Codex rollouts are date-keyed, not cwd-keyed: a same-machine "move" does
    // not relocate the transcript. Only the cwd-bound trust entry is re-keyed.
    // Forking writes a fresh-id copy of the rollout alongside the original.
    let fromTranscript = ref.transcriptPath;
    let toTranscript = ref.transcriptPath;
    let destId = ref.sessionId;

    if (opts.fork) {
      if (!opts.newSessionId) throw new Error("fork requires a new session id");
      destId = opts.newSessionId;
      const destName = rolloutNameFor(ref.transcriptBasename, destId);
      toTranscript = rolloutDestPath(home, destName);
      if (await exists(toTranscript)) {
        throw new Error(
          `destination transcript already exists: ${toTranscript}`,
        );
      }
      await ensureDir(join(toTranscript, ".."));
      await Deno.copyFile(ref.transcriptPath, toTranscript);
      fromTranscript = ref.transcriptPath;
    }

    // Re-key trust from old cwd to new cwd.
    let movedConfig = false;
    const path = configPath(home);
    let text = "";
    try {
      text = await Deno.readTextFile(path);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
    const parsed = await readCodexConfig(path);
    const existing = ref.cwd ? extractCodexProject(parsed, ref.cwd) : null;
    const entry = (existing ?? { trust_level: "trusted" }) as Record<
      string,
      string | number | boolean
    >;
    let next = upsertCodexProject(text, toCwd, entry);
    if (!opts.fork && ref.cwd && ref.cwd !== toCwd) {
      next = removeCodexProject(next, ref.cwd);
    }
    await writeCodexConfig(path, next);
    movedConfig = true;

    return {
      fromTranscript,
      toTranscript,
      sessionId: destId,
      movedSidecars: 0,
      movedConfig,
    };
  }
}

async function mergeTrust(
  home: string,
  toCwd: string,
  configEntry: Record<string, unknown> | null,
): Promise<boolean> {
  if (configEntry === null) return false;
  const path = configPath(home);
  let text = "";
  try {
    text = await Deno.readTextFile(path);
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  const entry = configEntry as Record<string, string | number | boolean>;
  await ensureDir(codexDir(home));
  await writeCodexConfig(path, upsertCodexProject(text, toCwd, entry));
  return true;
}
