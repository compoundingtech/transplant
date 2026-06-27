import { join, relative } from "@std/path";
import { walk } from "@std/fs";
import { TarStream, type TarStreamInput, UntarStream } from "@std/tar";
import { type Manifest, MANIFEST_NAME, verifyManifest } from "./manifest.ts";
import type { ProjectEntry } from "./config.ts";

/** Bundle entry names. The transcript is stored format-agnostically as an opaque blob. */
export const TRANSCRIPT_NAME = "transcript.jsonl";
export const PROJECT_CONFIG_NAME = "project-config.json";
export const MEMORY_PREFIX = "memory/";

/** Everything needed to pack a bundle. The shell gathers these from a {@link Roots}. */
export interface PackInput {
  manifest: Manifest;
  /** Absolute path to the `<session-id>.jsonl` transcript. */
  transcriptPath: string;
  /** Absolute path to the `memory/` sidecar, or `null` if the session has none. */
  memoryDir: string | null;
  /** The extracted `~/.claude.json` project entry, or `null` if absent. */
  projectEntry: ProjectEntry | null;
}

/** The reconstructed contents of a bundle, ready to be placed at computed paths. */
export interface UnpackedBundle {
  manifest: Manifest;
  transcript: Uint8Array;
  /** Memory sidecar files, keyed by path relative to the `memory/` root. */
  memory: Map<string, Uint8Array>;
  projectEntry: ProjectEntry | null;
}

const encoder = new TextEncoder();

function bytesEntry(path: string, bytes: Uint8Array): TarStreamInput {
  return {
    type: "file",
    path,
    size: bytes.byteLength,
    readable: ReadableStream.from([bytes]),
  };
}

/** Pack a session into a tar bundle written to `outPath`. */
export async function packBundle(
  input: PackInput,
  outPath: string,
): Promise<void> {
  const entries: TarStreamInput[] = [];

  entries.push(
    bytesEntry(
      MANIFEST_NAME,
      encoder.encode(JSON.stringify(input.manifest, null, 2)),
    ),
  );

  const transcript = await Deno.readFile(input.transcriptPath);
  entries.push(bytesEntry(TRANSCRIPT_NAME, transcript));

  if (input.projectEntry !== null) {
    entries.push(
      bytesEntry(
        PROJECT_CONFIG_NAME,
        encoder.encode(JSON.stringify(input.projectEntry, null, 2)),
      ),
    );
  }

  if (input.memoryDir !== null) {
    for await (const entry of walk(input.memoryDir, { includeDirs: false })) {
      const rel = relative(input.memoryDir, entry.path);
      const bytes = await Deno.readFile(entry.path);
      entries.push(bytesEntry(MEMORY_PREFIX + rel, bytes));
    }
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
  let projectEntry: ProjectEntry | null = null;
  const memory = new Map<string, Uint8Array>();

  for await (
    const entry of file.readable.pipeThrough(new UntarStream())
  ) {
    // Normalize: tar may prefix entries with "./".
    const path = entry.path.replace(/^\.\//, "");
    if (!entry.readable) continue;
    const bytes = new Uint8Array(
      await new Response(entry.readable).arrayBuffer(),
    );
    if (path === MANIFEST_NAME) {
      manifest = verifyManifest(JSON.parse(new TextDecoder().decode(bytes)));
    } else if (path === TRANSCRIPT_NAME) {
      transcript = bytes;
    } else if (path === PROJECT_CONFIG_NAME) {
      projectEntry = JSON.parse(
        new TextDecoder().decode(bytes),
      ) as ProjectEntry;
    } else if (path.startsWith(MEMORY_PREFIX)) {
      memory.set(path.slice(MEMORY_PREFIX.length), bytes);
    }
  }

  if (manifest === null) throw new Error("bundle is missing manifest.json");
  if (transcript === null) {
    throw new Error(`bundle is missing ${TRANSCRIPT_NAME}`);
  }
  return { manifest, transcript, memory, projectEntry };
}

/** Reconstruct the absolute on-disk path for a memory file under a memory root. */
export function memoryTargetPath(memoryRoot: string, relPath: string): string {
  return join(memoryRoot, relPath);
}
