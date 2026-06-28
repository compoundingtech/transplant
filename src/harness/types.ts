/**
 * A "harness" is an agent CLI whose sessions transplant can migrate (Claude
 * Code, Codex). Each harness knows its own on-disk layout, how to discover
 * sessions, how to resolve the working directory a session belongs to, and what
 * sidecar resources travel with a session. Everything is parameterized by a
 * `home` directory so the whole layer is testable against a synthetic fake
 * `$HOME` with no real agent state.
 */

export type HarnessName = "claude-code" | "codex";

/** How a harness stores its cwd-keyed project config (for re-keying on migrate). */
export type ConfigKind = "claude-json" | "codex-toml";

/** A discovered session and the facts needed to migrate it. */
export interface SessionRef {
  harness: HarnessName;
  sessionId: string;
  /** Absolute path to the transcript on disk. */
  transcriptPath: string;
  /** The transcript's own filename (needed to place date-keyed harnesses like Codex). */
  transcriptBasename: string;
  /** The absolute cwd the session is currently keyed under, or null if unresolved. */
  cwd: string | null;
  /** Epoch ms of last modification. */
  lastModified: number;
  fileSize: number;
  /** Best-effort one-line description for display; never authoritative. */
  summary: string | null;
}

/** A sidecar file, path relative to a harness-defined base (e.g. "memory/MEMORY.md"). */
export interface SidecarFile {
  relPath: string;
  bytes: Uint8Array;
}

/** Everything migratable for one session, gathered by `collect`, restored by `place`. */
export interface SessionResources {
  /** The opaque transcript blob — never parsed for migration. */
  transcript: Uint8Array;
  transcriptBasename: string;
  sidecars: SidecarFile[];
  /** The cwd-keyed project-config entry, harness-specific shape, or null. */
  configEntry: Record<string, unknown> | null;
  configKind: ConfigKind | null;
}

export interface PlaceResult {
  transcriptPath: string;
  sessionId: string;
  toCwd: string;
  sidecarsWritten: number;
  mergedConfig: boolean;
}

export interface MoveResult {
  fromTranscript: string;
  toTranscript: string;
  sessionId: string;
  movedSidecars: number;
  movedConfig: boolean;
}

export interface ForkOptions {
  fork: boolean;
  /** New id when forking; supplied by the shell to keep the core deterministic. */
  newSessionId?: string;
}

/** The capability surface every harness implements. */
export interface Harness {
  readonly name: HarnessName;
  /** True if this harness has any state under `home`. */
  detect(home: string): Promise<boolean>;
  /** All local sessions, newest first. */
  list(home: string): Promise<SessionRef[]>;
  /** Locate one session by id, or null. */
  find(home: string, sessionId: string): Promise<SessionRef | null>;
  /** Gather all migratable resources for a session (for pack). */
  collect(home: string, ref: SessionRef): Promise<SessionResources>;
  /** Restore resources under `home`, keyed at `toCwd`, with `sessionId`. */
  place(
    home: string,
    toCwd: string,
    sessionId: string,
    res: SessionResources,
  ): Promise<PlaceResult>;
  /** Relocate a session to `toCwd` on the same machine. */
  move(
    home: string,
    ref: SessionRef,
    toCwd: string,
    opts: ForkOptions,
  ): Promise<MoveResult>;
}
