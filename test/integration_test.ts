import { assert, assertEquals } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { packSession } from "../src/core/pack.ts";
import { importBundle } from "../src/core/import.ts";
import { memoryDir, transcriptPath } from "../src/core/paths.ts";
import { extractProjectEntry, readConfig } from "../src/core/config.ts";
import {
  makeFakeRoot,
  setProjectEntry,
  writeSyntheticSession,
} from "./helpers.ts";

Deno.test("end-to-end: pack from one machine, import onto another at a NEW path", async () => {
  // Source "machine".
  await using src = await makeFakeRoot();
  const srcCwd = "/Users/alice/projects/app";
  const id = "abcd-1234";
  await writeSyntheticSession(src.roots, srcCwd, id, {
    summary: "ported session",
    memory: { "MEMORY.md": "- [n](n.md)\n", "n.md": "remembered\n" },
  });
  await setProjectEntry(src.roots, srcCwd, {
    hasTrustDialogAccepted: true,
    allowedTools: ["Bash(ls)"],
    lastSessionId: id,
  });

  const bundle = join(src.home, "session.tar");
  const manifest = await packSession(
    src.roots,
    {
      sessionId: id,
      cwd: srcCwd,
      createdAt: 1700000000000,
      claudeVersion: "1.2.3",
    },
    bundle,
  );
  assertEquals(manifest.hasMemory, true);
  assertEquals(manifest.hasProjectConfig, true);

  // Target "machine" — different home, different project location.
  await using dst = await makeFakeRoot();
  const dstCwd = "/home/bob/work/app";
  const result = await importBundle(dst.roots, bundle, dstCwd, { fork: false });

  // Transcript landed under the recomputed encoded-cwd for the target path.
  assertEquals(result.toTranscript, transcriptPath(dst.roots, dstCwd, id));
  assert(await exists(result.toTranscript));

  // Transcript bytes are identical (opaque blob, untouched).
  const original = await Deno.readTextFile(
    transcriptPath(src.roots, srcCwd, id),
  );
  const imported = await Deno.readTextFile(result.toTranscript);
  assertEquals(imported, original);

  // Memory restored.
  assertEquals(result.restoredMemory, 2);
  assertEquals(
    await Deno.readTextFile(`${memoryDir(dst.roots, dstCwd)}/n.md`),
    "remembered\n",
  );

  // Config re-keyed to the local cwd, permissions preserved.
  const config = await readConfig(dst.roots.configPath);
  const entry = extractProjectEntry(config, dstCwd);
  assertEquals(entry?.hasTrustDialogAccepted, true);
  assertEquals(entry?.allowedTools, ["Bash(ls)"]);
  assertEquals(entry?.lastSessionId, id);
});

Deno.test("end-to-end: import --fork assigns a fresh id at the destination", async () => {
  await using src = await makeFakeRoot();
  const id = "orig-id";
  await writeSyntheticSession(src.roots, "/src/app", id);
  await setProjectEntry(src.roots, "/src/app", { lastSessionId: id });
  const bundle = join(src.home, "s.tar");
  await packSession(
    src.roots,
    { sessionId: id, cwd: "/src/app", createdAt: 1 },
    bundle,
  );

  await using dst = await makeFakeRoot();
  const result = await importBundle(dst.roots, bundle, "/dst/app", {
    fork: true,
    newSessionId: "fresh-id",
  });
  assertEquals(result.sessionId, "fresh-id");
  assert(await exists(transcriptPath(dst.roots, "/dst/app", "fresh-id")));
  assert(!(await exists(transcriptPath(dst.roots, "/dst/app", id))));

  const config = await readConfig(dst.roots.configPath);
  assertEquals(
    extractProjectEntry(config, "/dst/app")?.lastSessionId,
    "fresh-id",
  );
});
