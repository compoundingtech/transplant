import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { packBundle, unpackBundle } from "../src/core/bundle.ts";
import { buildManifest } from "../src/core/manifest.ts";
import { memoryDir, transcriptPath } from "../src/core/paths.ts";
import { makeFakeRoot, writeSyntheticSession } from "./helpers.ts";

Deno.test("pack then unpack round-trips transcript, memory and project entry", async () => {
  await using fake = await makeFakeRoot();
  const cwd = "/work/app";
  const id = "sess-1";
  await writeSyntheticSession(fake.roots, cwd, id, {
    memory: { "MEMORY.md": "- [note](n.md)\n", "n.md": "a fact\n" },
  });

  const manifest = buildManifest({
    sessionId: id,
    originalCwd: cwd,
    hasMemory: true,
    hasProjectConfig: true,
    createdAt: 123,
  });
  const out = join(fake.home, "bundle.tar");
  await packBundle(
    {
      manifest,
      transcriptPath: transcriptPath(fake.roots, cwd, id),
      memoryDir: memoryDir(fake.roots, cwd),
      projectEntry: { hasTrustDialogAccepted: true },
    },
    out,
  );

  const unpacked = await unpackBundle(out);
  assertEquals(unpacked.manifest, manifest);
  assertEquals(
    new TextDecoder().decode(unpacked.transcript).split("\n")[0].includes(
      "summary",
    ),
    true,
  );
  assertEquals(unpacked.projectEntry, { hasTrustDialogAccepted: true });
  assertEquals(unpacked.memory.size, 2);
  assertEquals(
    new TextDecoder().decode(unpacked.memory.get("n.md")!),
    "a fact\n",
  );
});

Deno.test("pack omits optional sidecars when absent", async () => {
  await using fake = await makeFakeRoot();
  const cwd = "/solo";
  const id = "sess-2";
  await writeSyntheticSession(fake.roots, cwd, id);
  const manifest = buildManifest({
    sessionId: id,
    originalCwd: cwd,
    hasMemory: false,
    hasProjectConfig: false,
    createdAt: 0,
  });
  const out = join(fake.home, "bundle.tar");
  await packBundle(
    {
      manifest,
      transcriptPath: transcriptPath(fake.roots, cwd, id),
      memoryDir: null,
      projectEntry: null,
    },
    out,
  );
  const unpacked = await unpackBundle(out);
  assertEquals(unpacked.memory.size, 0);
  assertEquals(unpacked.projectEntry, null);
});

Deno.test("unpackBundle: rejects a tar with no manifest", async () => {
  await using fake = await makeFakeRoot();
  const out = join(fake.home, "empty.tar");
  // A valid-but-irrelevant tar (just a stray file, no manifest).
  await Deno.writeTextFile(join(fake.home, "stray.txt"), "x");
  const { TarStream } = await import("@std/tar");
  const data = new TextEncoder().encode("x");
  const f = await Deno.open(out, { write: true, create: true, truncate: true });
  await ReadableStream.from([
    {
      type: "file" as const,
      path: "stray.txt",
      size: data.byteLength,
      readable: ReadableStream.from([data]),
    },
  ]).pipeThrough(new TarStream()).pipeTo(f.writable);
  await assertRejects(() => unpackBundle(out), Error, "missing manifest");
});
