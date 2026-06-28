import { TarStream, type TarStreamInput, UntarStream } from "@std/tar";
import { type Manifest, MANIFEST_NAME, verifyManifest } from "./manifest.ts";
import type { ConfigKind, SessionResources } from "../harness/types.ts";

/** Bundle entry names. The transcript is stored format-agnostically as an opaque blob. */
export const TRANSCRIPT_NAME = "transcript.jsonl";
export const CONFIG_ENTRY_NAME = "config-entry.json";
export const SIDECAR_PREFIX = "sidecars/";

/** The reconstructed contents of a bundle. */
export interface UnpackedBundle {
  manifest: Manifest;
  resources: SessionResources;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesEntry(path: string, bytes: Uint8Array): TarStreamInput {
  return {
    type: "file",
    path,
    size: bytes.byteLength,
    readable: ReadableStream.from([bytes]),
  };
}

/** Pack a manifest + a session's resources into a tar bundle at `outPath`. */
export async function packBundle(
  manifest: Manifest,
  resources: SessionResources,
  outPath: string,
): Promise<void> {
  const entries: TarStreamInput[] = [];
  entries.push(
    bytesEntry(
      MANIFEST_NAME,
      encoder.encode(JSON.stringify(manifest, null, 2)),
    ),
  );
  entries.push(bytesEntry(TRANSCRIPT_NAME, resources.transcript));

  if (resources.configEntry !== null) {
    entries.push(
      bytesEntry(
        CONFIG_ENTRY_NAME,
        encoder.encode(JSON.stringify(resources.configEntry, null, 2)),
      ),
    );
  }
  for (const sidecar of resources.sidecars) {
    entries.push(bytesEntry(SIDECAR_PREFIX + sidecar.relPath, sidecar.bytes));
  }

  const out = await Deno.open(outPath, {
    write: true,
    create: true,
    truncate: true,
  });
  await ReadableStream.from(entries)
    .pipeThrough(new TarStream())
    .pipeTo(out.writable);
}

/** Read and validate a tar bundle into memory. Throws if the manifest is missing/invalid. */
export async function unpackBundle(
  bundlePath: string,
): Promise<UnpackedBundle> {
  const file = await Deno.open(bundlePath, { read: true });

  let manifest: Manifest | null = null;
  let transcript: Uint8Array | null = null;
  let configEntry: Record<string, unknown> | null = null;
  const sidecars: { relPath: string; bytes: Uint8Array }[] = [];

  for await (const entry of file.readable.pipeThrough(new UntarStream())) {
    const path = entry.path.replace(/^\.\//, ""); // tar may prefix "./"
    if (!entry.readable) continue;
    const bytes = new Uint8Array(
      await new Response(entry.readable).arrayBuffer(),
    );
    if (path === MANIFEST_NAME) {
      manifest = verifyManifest(JSON.parse(decoder.decode(bytes)));
    } else if (path === TRANSCRIPT_NAME) {
      transcript = bytes;
    } else if (path === CONFIG_ENTRY_NAME) {
      configEntry = JSON.parse(decoder.decode(bytes)) as Record<
        string,
        unknown
      >;
    } else if (path.startsWith(SIDECAR_PREFIX)) {
      sidecars.push({ relPath: path.slice(SIDECAR_PREFIX.length), bytes });
    }
  }

  if (manifest === null) throw new Error("bundle is missing manifest.json");
  if (transcript === null) {
    throw new Error(`bundle is missing ${TRANSCRIPT_NAME}`);
  }

  const resources: SessionResources = {
    transcript,
    transcriptBasename: manifest.transcriptBasename,
    sidecars,
    configEntry,
    configKind: manifest.configKind as ConfigKind | null,
  };
  return { manifest, resources };
}
