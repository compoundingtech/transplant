import { ensureDir } from "@std/fs";
import { dirname } from "@std/path";
import {
  memoryDir as memoryDirFor,
  type Roots,
  transcriptPath,
} from "./paths.ts";
import { memoryTargetPath, unpackBundle } from "./bundle.ts";
import {
  mergeProjectEntry,
  readConfig,
  rewriteProjectEntry,
  writeConfig,
} from "./config.ts";

export interface ImportOptions {
  /** Give the imported session a fresh id (so a source machine's copy can coexist). */
  fork: boolean;
  /** The new id to use when `fork` is true. Supplied by the shell. */
  newSessionId?: string;
}

export interface ImportResult {
  toTranscript: string;
  sessionId: string;
  /** Absolute cwd the session is now keyed under on THIS machine. */
  toCwd: string;
  restoredMemory: number;
  mergedConfig: boolean;
}

/**
 * Reconstruct a packed session on this machine, keyed under `toCwd`. The encoded
 * folder is recomputed for the target path (the bundle's original path is
 * informational only), the transcript is restored as an opaque blob, the
 * `memory/` sidecar is recreated, and the project-config entry is re-keyed to
 * `toCwd`.
 */
export async function importBundle(
  roots: Roots,
  bundlePath: string,
  toCwd: string,
  opts: ImportOptions,
): Promise<ImportResult> {
  const bundle = await unpackBundle(bundlePath);

  let destId = bundle.manifest.sessionId;
  if (opts.fork) {
    if (!opts.newSessionId) throw new Error("fork requires a new session id");
    destId = opts.newSessionId;
  }

  const toTranscript = transcriptPath(roots, toCwd, destId);
  await ensureDir(dirname(toTranscript));
  await Deno.writeFile(toTranscript, bundle.transcript);

  // Restore memory sidecar.
  let restoredMemory = 0;
  if (bundle.memory.size > 0) {
    const root = memoryDirFor(roots, toCwd);
    for (const [rel, bytes] of bundle.memory) {
      const target = memoryTargetPath(root, rel);
      await ensureDir(dirname(target));
      await Deno.writeFile(target, bytes);
      restoredMemory++;
    }
  }

  // Merge the project-config entry, re-keyed to the local cwd.
  let mergedConfig = false;
  if (bundle.projectEntry !== null) {
    const config = await readConfig(roots.configPath);
    const rewritten = rewriteProjectEntry(bundle.projectEntry, {
      sessionId: destId,
    });
    const next = mergeProjectEntry(config, toCwd, rewritten);
    await writeConfig(roots.configPath, next);
    mergedConfig = true;
  }

  return {
    toTranscript,
    sessionId: destId,
    toCwd,
    restoredMemory,
    mergedConfig,
  };
}
