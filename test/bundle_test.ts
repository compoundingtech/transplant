import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { packBundle, unpackBundle } from "../src/core/bundle.ts";
import { buildManifest } from "../src/core/manifest.ts";
import type { SessionResources } from "../src/harness/types.ts";
import { makeFakeRoot } from "./helpers.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

function resources(): SessionResources {
  return {
    transcript: enc.encode('{"type":"summary"}\n'),
    transcriptBasename: "sess.jsonl",
    sidecars: [
      { relPath: "memory/MEMORY.md", bytes: enc.encode("- note\n") },
      { relPath: "memory/n.md", bytes: enc.encode("a fact\n") },
    ],
    configEntry: { hasTrustDialogAccepted: true },
    configKind: "claude-json",
  };
}

function manifestFor(sidecarCount: number, hasConfig: boolean) {
  return buildManifest({
    harness: "claude-code",
    sessionId: "sess",
    originalCwd: "/work/app",
    transcriptBasename: "sess.jsonl",
    configKind: hasConfig ? "claude-json" : null,
    sidecarCount,
    hasConfigEntry: hasConfig,
    createdAt: 1,
  });
}

Deno.test("packBundle/unpackBundle: round-trips manifest, transcript, sidecars, config", async () => {
  await using fake = await makeFakeRoot();
  const out = join(fake.home, "bundle.tar");
  const manifest = manifestFor(2, true);
  await packBundle(manifest, resources(), out);

  const { manifest: m, resources: r } = await unpackBundle(out);
  assertEquals(m, manifest);
  assertEquals(dec.decode(r.transcript), '{"type":"summary"}\n');
  assertEquals(r.configEntry, { hasTrustDialogAccepted: true });
  assertEquals(r.sidecars.length, 2);
  const byPath = Object.fromEntries(
    r.sidecars.map((s) => [s.relPath, dec.decode(s.bytes)]),
  );
  assertEquals(byPath["memory/n.md"], "a fact\n");
});

Deno.test("packBundle: omits optional config and sidecars when absent", async () => {
  await using fake = await makeFakeRoot();
  const out = join(fake.home, "bundle.tar");
  const res: SessionResources = {
    transcript: enc.encode("x"),
    transcriptBasename: "sess.jsonl",
    sidecars: [],
    configEntry: null,
    configKind: null,
  };
  await packBundle(manifestFor(0, false), res, out);
  const { resources: r } = await unpackBundle(out);
  assertEquals(r.sidecars.length, 0);
  assertEquals(r.configEntry, null);
});

Deno.test("unpackBundle: rejects a tar with no manifest", async () => {
  await using fake = await makeFakeRoot();
  const out = join(fake.home, "empty.tar");
  const { TarStream } = await import("@std/tar");
  const data = enc.encode("x");
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
