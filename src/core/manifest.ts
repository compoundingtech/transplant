import { encodeCwd } from "./encode.ts";

/** Current bundle manifest schema version. */
export const MANIFEST_VERSION = 1 as const;

/** Filename of the manifest inside a bundle. */
export const MANIFEST_NAME = "manifest.json";

/**
 * Describes a packed session bundle. The `originalCwd` is the load-bearing field
 * for cross-machine import: it records the absolute path the session was keyed
 * under on the source machine (the encoded folder name is lossy and cannot be
 * decoded), while `encodedCwd` is stored for verification/debugging.
 */
export interface Manifest {
  version: typeof MANIFEST_VERSION;
  sessionId: string;
  originalCwd: string;
  encodedCwd: string;
  /** Claude Code version that produced the transcript, if known. */
  claudeVersion: string | null;
  hasMemory: boolean;
  hasProjectConfig: boolean;
  /** Epoch milliseconds the bundle was created (supplied by the shell). */
  createdAt: number;
}

export interface BuildManifestInput {
  sessionId: string;
  originalCwd: string;
  claudeVersion?: string | null;
  hasMemory: boolean;
  hasProjectConfig: boolean;
  createdAt: number;
}

/** Build a manifest, deriving `encodedCwd` from `originalCwd`. Pure. */
export function buildManifest(input: BuildManifestInput): Manifest {
  return {
    version: MANIFEST_VERSION,
    sessionId: input.sessionId,
    originalCwd: input.originalCwd,
    encodedCwd: encodeCwd(input.originalCwd),
    claudeVersion: input.claudeVersion ?? null,
    hasMemory: input.hasMemory,
    hasProjectConfig: input.hasProjectConfig,
    createdAt: input.createdAt,
  };
}

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
  const sessionId = str("sessionId");
  const originalCwd = str("originalCwd");
  const encodedCwd = str("encodedCwd");
  if (encodedCwd !== encodeCwd(originalCwd)) {
    throw new Error(
      "manifest.encodedCwd does not match encodeCwd(originalCwd)",
    );
  }
  if (m.claudeVersion !== null && typeof m.claudeVersion !== "string") {
    throw new Error("manifest.claudeVersion must be a string or null");
  }
  if (typeof m.createdAt !== "number") {
    throw new Error("manifest.createdAt must be a number");
  }
  return {
    version: MANIFEST_VERSION,
    sessionId,
    originalCwd,
    encodedCwd,
    claudeVersion: (m.claudeVersion as string | null) ?? null,
    hasMemory: bool("hasMemory"),
    hasProjectConfig: bool("hasProjectConfig"),
    createdAt: m.createdAt as number,
  };
}
