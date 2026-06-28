import { buildManifest, type Manifest } from "./core/manifest.ts";
import { packBundle, unpackBundle } from "./core/bundle.ts";
import { getHarness } from "./harness/registry.ts";
import type {
  ForkOptions,
  Harness,
  HarnessName,
  PlaceResult,
  SessionRef,
} from "./harness/types.ts";

export interface PackMeta {
  /** Epoch ms for the manifest (supplied by the shell). */
  createdAt: number;
  /** Agent CLI version, if known. */
  agentVersion?: string | null;
}

/**
 * Gather a session's resources via its harness and write a portable bundle.
 * `cwd` must be resolved by the caller (a session's source dir); it is the
 * load-bearing field for cross-machine import. Returns the packed manifest.
 */
export async function packSession(
  harness: Harness,
  home: string,
  ref: SessionRef,
  cwd: string,
  meta: PackMeta,
  outPath: string,
): Promise<Manifest> {
  const resolved: SessionRef = { ...ref, cwd };
  const resources = await harness.collect(home, resolved);
  const manifest = buildManifest({
    harness: harness.name,
    sessionId: ref.sessionId,
    originalCwd: cwd,
    transcriptBasename: ref.transcriptBasename,
    configKind: resources.configKind,
    agentVersion: meta.agentVersion ?? null,
    sidecarCount: resources.sidecars.length,
    hasConfigEntry: resources.configEntry !== null,
    createdAt: meta.createdAt,
  });
  await packBundle(manifest, resources, outPath);
  return manifest;
}

export interface ImportResult extends PlaceResult {
  harness: HarnessName;
}

/**
 * Reconstruct a bundled session on this machine under `toCwd`, dispatching to
 * the harness recorded in the bundle manifest.
 */
export async function importBundle(
  home: string,
  bundlePath: string,
  toCwd: string,
  opts: ForkOptions,
): Promise<ImportResult> {
  const { manifest, resources } = await unpackBundle(bundlePath);
  const harness = getHarness(manifest.harness);
  let destId = manifest.sessionId;
  if (opts.fork) {
    if (!opts.newSessionId) throw new Error("fork requires a new session id");
    destId = opts.newSessionId;
  }
  const result = await harness.place(home, toCwd, destId, resources);
  return { harness: manifest.harness, ...result };
}
