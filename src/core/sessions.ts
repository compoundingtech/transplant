import { join } from "@std/path";
import { projectsDir, type Roots } from "./paths.ts";
import { encodeCwd } from "./encode.ts";
import { readConfig } from "./config.ts";

/**
 * Metadata about a local session transcript.
 *
 * The authoritative fields (`sessionId`, `encodedCwd`, `fileSize`,
 * `lastModified`) come purely from the filesystem — the filename and a stat —
 * and never depend on the transcript's internal format. The `summary` and
 * `firstPrompt` fields are a best-effort cosmetic PEEK into the jsonl for
 * display only; they are `null` whenever the peek fails for any reason. The
 * transcript is otherwise treated as an opaque blob (its format is internal to
 * Claude Code and changes between releases).
 */
export interface SessionInfo {
  sessionId: string;
  encodedCwd: string;
  /**
   * The absolute working directory the session is CURRENTLY keyed under (the
   * encoded folder name is lossy and cannot be decoded directly). Resolved to a
   * path `p` for which `encodeCwd(p) === encodedCwd`, preferring the matching
   * `~/.claude.json` project key and falling back to the transcript's own `cwd`
   * only when it is consistent with the folder. After a move/import the
   * transcript's internal cwd is stale, so it is never trusted on its own.
   * `null` when no consistent path can be determined; `move`/`pack` then need an
   * explicit `--from`.
   */
  cwd: string | null;
  fileSize: number;
  /** Epoch milliseconds of the transcript's last modification. */
  lastModified: number;
  summary: string | null;
  firstPrompt: string | null;
}

function sessionIdFromFile(name: string): string | null {
  if (!name.endsWith(".jsonl")) return null;
  return name.slice(0, -".jsonl".length);
}

/**
 * Best-effort, non-authoritative extraction of a human-readable summary and the
 * first user prompt from a transcript. NEVER throws — any parse failure (format
 * drift, truncation, binary content) degrades to `null`. Reads only the first
 * chunk of the file so it stays cheap on large transcripts.
 */
interface Peeked {
  summary: string | null;
  firstPrompt: string | null;
  cwd: string | null;
}

async function peekMetadata(path: string): Promise<Peeked> {
  const empty: Peeked = { summary: null, firstPrompt: null, cwd: null };
  try {
    using file = await Deno.open(path, { read: true });
    const buf = new Uint8Array(64 * 1024);
    const n = await file.read(buf);
    if (n === null) return empty;
    const text = new TextDecoder().decode(buf.subarray(0, n));
    let summary: string | null = null;
    let firstPrompt: string | null = null;
    let cwd: string | null = null;
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let obj: unknown;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        continue; // partial trailing line, or not the format we expect
      }
      if (obj && typeof obj === "object") {
        const rec = obj as Record<string, unknown>;
        if (
          summary === null && rec.type === "summary" &&
          typeof rec.summary === "string"
        ) {
          summary = rec.summary;
        }
        if (cwd === null && typeof rec.cwd === "string") cwd = rec.cwd;
        if (firstPrompt === null && rec.type === "user") {
          const content = (rec.message as Record<string, unknown> | undefined)
            ?.content;
          if (typeof content === "string") firstPrompt = content;
          else if (Array.isArray(content)) {
            const textPart = content.find(
              (p) =>
                p && typeof p === "object" &&
                (p as Record<string, unknown>).type === "text",
            ) as Record<string, unknown> | undefined;
            if (typeof textPart?.text === "string") firstPrompt = textPart.text;
          }
        }
      }
      if (summary !== null && firstPrompt !== null && cwd !== null) break;
    }
    return { summary, firstPrompt, cwd };
  } catch {
    return empty;
  }
}

async function readDirSafe(path: string): Promise<Deno.DirEntry[]> {
  const out: Deno.DirEntry[] = [];
  try {
    for await (const entry of Deno.readDir(path)) out.push(entry);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
  return out;
}

/**
 * Resolve the absolute cwd a session is currently keyed under. The folder name
 * is authoritative for WHERE the file lives; the cwd must satisfy
 * `encodeCwd(cwd) === encodedCwd`. Prefer a matching config key (survives
 * relocations), then the transcript's own cwd but only if consistent with the
 * folder (the transcript is opaque and goes stale after a move).
 */
function resolveCwd(
  encodedCwd: string,
  peekedCwd: string | null,
  keyByEncoded: Map<string, string>,
): string | null {
  const fromConfig = keyByEncoded.get(encodedCwd);
  if (fromConfig) return fromConfig;
  if (peekedCwd && encodeCwd(peekedCwd) === encodedCwd) return peekedCwd;
  return null;
}

/** List the session transcripts inside a single encoded-cwd project folder. */
export async function listSessionsInProject(
  projectPath: string,
  encodedCwd: string,
  keyByEncoded: Map<string, string> = new Map(),
): Promise<SessionInfo[]> {
  const sessions: SessionInfo[] = [];
  for (const entry of await readDirSafe(projectPath)) {
    if (!entry.isFile) continue;
    const sessionId = sessionIdFromFile(entry.name);
    if (!sessionId) continue;
    const full = join(projectPath, entry.name);
    const stat = await Deno.stat(full);
    const { summary, firstPrompt, cwd } = await peekMetadata(full);
    sessions.push({
      sessionId,
      encodedCwd,
      cwd: resolveCwd(encodedCwd, cwd, keyByEncoded),
      fileSize: stat.size,
      lastModified: stat.mtime?.getTime() ?? 0,
      summary,
      firstPrompt,
    });
  }
  return sessions;
}

/**
 * Pure-core replacement for the SDK's `listSessions`: enumerate every local
 * session across all project folders under `~/.claude/projects`, newest first.
 * Reads nothing but the filesystem (plus `~/.claude.json` to recover current
 * cwds); ships in the compiled binary without the SDK's heavy dependency tree.
 */
export async function listAllSessions(roots: Roots): Promise<SessionInfo[]> {
  const root = projectsDir(roots);
  const config = await readConfig(roots.configPath);
  const keyByEncoded = new Map<string, string>();
  for (const key of Object.keys(config.projects ?? {})) {
    keyByEncoded.set(encodeCwd(key), key);
  }
  const all: SessionInfo[] = [];
  for (const entry of await readDirSafe(root)) {
    if (!entry.isDirectory) continue;
    const projectPath = join(root, entry.name);
    all.push(
      ...(await listSessionsInProject(projectPath, entry.name, keyByEncoded)),
    );
  }
  all.sort((a, b) => b.lastModified - a.lastModified);
  return all;
}

/**
 * Locate a single session by id across all project folders. Returns `null` if
 * no transcript with that id exists. Used by `move`/`pack` to resolve the source
 * folder (always reliable) and the current cwd (config-key first, consistent
 * peek as fallback).
 */
export async function findSession(
  roots: Roots,
  sessionId: string,
): Promise<SessionInfo | null> {
  for (const session of await listAllSessions(roots)) {
    if (session.sessionId === sessionId) return session;
  }
  return null;
}
