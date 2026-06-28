import { assert, assertEquals } from "@std/assert";
import { exists } from "@std/fs";
import { ClaudeHarness } from "../src/harness/claude.ts";
import { transcriptPath } from "../src/core/paths.ts";
import {
  makeFakeRoot,
  setProjectEntry,
  writeSyntheticSession,
} from "./helpers.ts";

const claude = new ClaudeHarness();

Deno.test("claude.detect: true only when ~/.claude exists", async () => {
  await using fake = await makeFakeRoot();
  assertEquals(await claude.detect(fake.home), true); // makeFakeRoot creates .claude
});

Deno.test("claude.list/find: maps to SessionRef with transcript path + basename", async () => {
  await using fake = await makeFakeRoot();
  await writeSyntheticSession(fake.roots, "/work/app", "s1", { summary: "hi" });
  const ref = (await claude.find(fake.home, "s1"))!;
  assertEquals(ref.harness, "claude-code");
  assertEquals(ref.cwd, "/work/app");
  assertEquals(ref.transcriptBasename, "s1.jsonl");
  assertEquals(
    ref.transcriptPath,
    transcriptPath(fake.roots, "/work/app", "s1"),
  );
});

Deno.test("claude.collect+place: round-trips transcript, memory, config to a new cwd", async () => {
  await using fake = await makeFakeRoot();
  await writeSyntheticSession(fake.roots, "/src/app", "s2", {
    memory: { "MEMORY.md": "x\n" },
  });
  await setProjectEntry(fake.roots, "/src/app", {
    hasTrustDialogAccepted: true,
  });
  const ref = (await claude.find(fake.home, "s2"))!;
  const res = await claude.collect(fake.home, ref);
  assertEquals(res.sidecars.length, 1);

  await using dst = await makeFakeRoot();
  const result = await claude.place(dst.home, "/dst/app", "s2", res);
  assertEquals(result.sidecarsWritten, 1);
  assert(await exists(transcriptPath(dst.roots, "/dst/app", "s2")));
  assert(
    await exists(`${dst.roots.claudeDir}/projects/-dst-app/memory/MEMORY.md`),
  );
});

Deno.test("claude.collect: errors when cwd is unresolved", async () => {
  await using fake = await makeFakeRoot();
  // stale transcript cwd + no config => cwd null
  await writeSyntheticSession(fake.roots, "/new/loc", "s3", {
    transcriptCwd: "/old/loc",
  });
  const ref = (await claude.find(fake.home, "s3"))!;
  assertEquals(ref.cwd, null);
  let threw = false;
  try {
    await claude.collect(fake.home, ref);
  } catch {
    threw = true;
  }
  assert(threw);
});
