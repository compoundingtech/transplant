import { encodeCwd } from "./encode.ts";
import type { ConfigKind, HarnessName } from "../harness/types.ts";

/** Current bundle manifest schema version. */
export const MANIFEST_VERSION = 2 as const;

/** Filename of the manifest inside a bundle. */
export const MANIFEST_NAME = "manifest.json";

/**
 * Describes a packed session bundle. `originalCwd` is the load-bearing field for
 * cross-machine import: it records the absolute path the session was keyed under
 * on the source machine (encoded folder names are lossy and cannot be decoded);
 * `encodedCwd` is stored for Claude-style verification. `harness` tells `import`
 * which on-disk layout to reconstruct.
 */
export interface Manifest {
  version: typeof MANIFEST_VERSION;
  harness: HarnessName;
  sessionId: string;
  originalCwd: string;
  encodedCwd: string;
  /** The transcript's on-disk filename (needed to place date-keyed harnesses). */
  transcriptBasename: string;
  configKind: ConfigKind | null;
  /** Agent CLI version that produced the transcript, if known. */
  agentVersion: string | null;
  sidecarCount: number;
  hasConfigEntry: boolean;
  /** Epoch milliseconds the bundle was created (supplied by the shell). */
  createdAt: number;
}

export interface BuildManifestInput {
  harness: HarnessName;
  sessionId: string;
  originalCwd: string;
  transcriptBasename: string;
  configKind: ConfigKind | null;
  agentVersion?: string | null;
  sidecarCount: number;
  hasConfigEntry: boolean;
  createdAt: number;
}

/** Build a manifest, deriving `encodedCwd` from `originalCwd`. Pure. */
export function buildManifest(input: BuildManifestInput): Manifest {
  return {
    version: MANIFEST_VERSION,
    harness: input.harness,
    sessionId: input.sessionId,
    originalCwd: input.originalCwd,
    encodedCwd: encodeCwd(input.originalCwd),
    transcriptBasename: input.transcriptBasename,
    configKind: input.configKind,
    agentVersion: input.agentVersion ?? null,
    sidecarCount: input.sidecarCount,
    hasConfigEntry: input.hasConfigEntry,
    createdAt: input.createdAt,
  };
}

const HARNESSES: readonly HarnessName[] = ["claude-code", "codex"];
const CONFIG_KINDS: readonly ConfigKind[] = ["claude-json", "codex-toml"];

/**
 * Validate an untrusted parsed object as a {@link Manifest}, throwing a clear
 * error on any mismatch. Guards `import` against malformed or hostile bundles.
 */
export function verifyManifest(obj: unknown): Manifest {
  if (!obj || typeof obj !== "object") {
    throw new Error("manifest is not an object");
  }
  const m = obj as Record<string, unknown>;
  if (m.version !== MANIFEST_VERSION) {
    throw new Error(
      `unsupported manifest version: ${
        String(m.version)
      } (expected ${MANIFEST_VERSION})`,
    );
  }
  const str = (k: string): string => {
    if (typeof m[k] !== "string" || (m[k] as string).length === 0) {
      throw new Error(`manifest.${k} must be a non-empty string`);
    }
    return m[k] as string;
  };
  const bool = (k: string): boolean => {
    if (typeof m[k] !== "boolean") {
      throw new Error(`manifest.${k} must be a boolean`);
    }
    return m[k] as boolean;
  };
  const harness = str("harness") as HarnessName;
  if (!HARNESSES.includes(harness)) {
    throw new Error(`manifest.harness is not a known harness: ${harness}`);
  }
  const sessionId = str("sessionId");
  const originalCwd = str("originalCwd");
  const encodedCwd = str("encodedCwd");
  if (encodedCwd !== encodeCwd(originalCwd)) {
    throw new Error(
      "manifest.encodedCwd does not match encodeCwd(originalCwd)",
    );
  }
  const transcriptBasename = str("transcriptBasename");
  if (
    m.configKind !== null && !CONFIG_KINDS.includes(m.configKind as ConfigKind)
  ) {
    throw new Error(`manifest.configKind is invalid: ${String(m.configKind)}`);
  }
  if (m.agentVersion !== null && typeof m.agentVersion !== "string") {
    throw new Error("manifest.agentVersion must be a string or null");
  }
  if (typeof m.sidecarCount !== "number") {
    throw new Error("manifest.sidecarCount must be a number");
  }
  if (typeof m.createdAt !== "number") {
    throw new Error("manifest.createdAt must be a number");
  }
  return {
    version: MANIFEST_VERSION,
    harness,
    sessionId,
    originalCwd,
    encodedCwd,
    transcriptBasename,
    configKind: (m.configKind as ConfigKind | null) ?? null,
    agentVersion: (m.agentVersion as string | null) ?? null,
    sidecarCount: m.sidecarCount as number,
    hasConfigEntry: bool("hasConfigEntry"),
    createdAt: m.createdAt as number,
  };
}
