import { assertEquals } from "@std/assert";
import { findSession, listAllSessions } from "../src/core/sessions.ts";
import { encodeCwd } from "../src/core/encode.ts";
import {
  makeFakeRoot,
  setProjectEntry,
  writeSyntheticSession,
} from "./helpers.ts";

Deno.test("listAllSessions: empty root yields no sessions", async () => {
  await using fake = await makeFakeRoot();
  assertEquals(await listAllSessions(fake.roots), []);
});

Deno.test("listAllSessions: discovers sessions with FS-authoritative fields", async () => {
  await using fake = await makeFakeRoot();
  await writeSyntheticSession(fake.roots, "/work/app", "aaaa1111", {
    summary: "first",
    firstPrompt: "do the thing",
  });
  const sessions = await listAllSessions(fake.roots);
  assertEquals(sessions.length, 1);
  const s = sessions[0];
  assertEquals(s.sessionId, "aaaa1111");
  assertEquals(s.encodedCwd, encodeCwd("/work/app"));
  assertEquals(s.cwd, "/work/app");
  assertEquals(s.summary, "first");
  assertEquals(s.firstPrompt, "do the thing");
});

Deno.test("listAllSessions: sorts newest-first by lastModified", async () => {
  await using fake = await makeFakeRoot();
  const older = await writeSyntheticSession(fake.roots, "/a", "old");
  await writeSyntheticSession(fake.roots, "/b", "new");
  // Force a stable ordering by backdating the first file.
  await Deno.utime(older, new Date(1000), new Date(1000));
  const ids = (await listAllSessions(fake.roots)).map((s) => s.sessionId);
  assertEquals(ids, ["new", "old"]);
});

Deno.test("peek degrades gracefully: opaque/garbage transcript still lists", async () => {
  await using fake = await makeFakeRoot();
  // A transcript whose contents we can't parse — must NOT crash listing.
  await writeSyntheticSession(fake.roots, "/work/app", "garbage", {
    extraLines: ["this is not json at all {{{"],
  });
  const path = `${fake.roots.claudeDir}/projects/${
    encodeCwd("/work/app")
  }/garbage.jsonl`;
  await Deno.writeTextFile(path, "not json\nstill not json\n");
  const sessions = await listAllSessions(fake.roots);
  assertEquals(sessions.length, 1);
  assertEquals(sessions[0].summary, null);
  assertEquals(sessions[0].cwd, null);
});

Deno.test("findSession: resolves by id, returns null when absent", async () => {
  await using fake = await makeFakeRoot();
  await writeSyntheticSession(fake.roots, "/work/app", "target");
  const found = await findSession(fake.roots, "target");
  assertEquals(found?.cwd, "/work/app");
  assertEquals(await findSession(fake.roots, "missing"), null);
});

Deno.test("cwd resolution: a STALE transcript cwd (post-move) is ignored in favor of the config key", async () => {
  await using fake = await makeFakeRoot();
  // The file lives under /new/loc but the opaque transcript still says /old/loc.
  await writeSyntheticSession(fake.roots, "/new/loc", "relocated", {
    transcriptCwd: "/old/loc",
  });
  // With no config, the inconsistent peek is rejected -> cwd unknown.
  assertEquals((await findSession(fake.roots, "relocated"))?.cwd, null);

  // With a config entry keyed to the real folder, that wins.
  await setProjectEntry(fake.roots, "/new/loc", { lastSessionId: "relocated" });
  assertEquals((await findSession(fake.roots, "relocated"))?.cwd, "/new/loc");
});
