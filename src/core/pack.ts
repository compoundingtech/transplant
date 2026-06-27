import { exists } from "@std/fs";
import {
  memoryDir as memoryDirFor,
  type Roots,
  transcriptPath,
} from "./paths.ts";
import { extractProjectEntry, readConfig } from "./config.ts";
import { buildManifest, type Manifest } from "./manifest.ts";
import { packBundle } from "./bundle.ts";

export interface PackSessionInput {
  sessionId: string;
  /** The absolute cwd the session is keyed under on this machine. */
  cwd: string;
  /** Epoch milliseconds for the manifest (supplied by the shell). */
  createdAt: number;
  /** Claude Code version that produced the transcript, if known. */
  claudeVersion?: string | null;
}

/**
 * Gather a session's transcript and sidecars from a {@link Roots} and write a
 * portable bundle to `outPath`. Returns the manifest that was packed.
 */
export async function packSession(
  roots: Roots,
  input: PackSessionInput,
  outPath: string,
): Promise<Manifest> {
  const transcript = transcriptPath(roots, input.cwd, input.sessionId);
  if (!(await exists(transcript))) {
    throw new Error(`session transcript not found: ${transcript}`);
  }

  const memory = memoryDirFor(roots, input.cwd);
  const hasMemory = await exists(memory);

  const config = await readConfig(roots.configPath);
  const projectEntry = extractProjectEntry(config, input.cwd);

  const manifest = buildManifest({
    sessionId: input.sessionId,
    originalCwd: input.cwd,
    claudeVersion: input.claudeVersion ?? null,
    hasMemory,
    hasProjectConfig: projectEntry !== null,
    createdAt: input.createdAt,
  });

  await packBundle(
    {
      manifest,
      transcriptPath: transcript,
      memoryDir: hasMemory ? memory : null,
      projectEntry,
    },
    outPath,
  );

  return manifest;
}
