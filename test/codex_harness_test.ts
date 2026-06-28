import { assert, assertEquals } from "@std/assert";
import { exists } from "@std/fs";
import { parse as parseToml } from "@std/toml";
import { CodexHarness } from "../src/harness/codex.ts";
import { extractCodexProject } from "../src/core/codex_config.ts";
import { makeFakeRoot, writeSyntheticCodexSession } from "./helpers.ts";

const codex = new CodexHarness();

Deno.test("codex.detect: true only when ~/.codex exists", async () => {
  await using fake = await makeFakeRoot();
  assertEquals(await codex.detect(fake.home), false);
  await writeSyntheticCodexSession(
    fake.home,
    "/work/app",
    "0a1b2c3d-4e5f-6789-abcd-ef0123456789",
  );
  assertEquals(await codex.detect(fake.home), true);
});

Deno.test("codex.list/find: id is the rollout uuid; cwd peeked from session_meta", async () => {
  await using fake = await makeFakeRoot();
  const uuid = "0a1b2c3d-4e5f-6789-abcd-ef0123456789";
  await writeSyntheticCodexSession(fake.home, "/work/app", uuid, {
    trustLevel: "trusted",
  });
  const list = await codex.list(fake.home);
  assertEquals(list.length, 1);
  assertEquals(list[0].sessionId, uuid);
  assertEquals(list[0].cwd, "/work/app");
  assertEquals((await codex.find(fake.home, uuid))?.cwd, "/work/app");
  assertEquals(await codex.find(fake.home, "nope"), null);
});

Deno.test("codex.collect: transcript opaque, config entry from trust toml", async () => {
  await using fake = await makeFakeRoot();
  const uuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  await writeSyntheticCodexSession(fake.home, "/work/app", uuid, {
    trustLevel: "trusted",
  });
  const ref = (await codex.find(fake.home, uuid))!;
  const res = await codex.collect(fake.home, ref);
  assertEquals(res.configKind, "codex-toml");
  assertEquals(res.configEntry, { trust_level: "trusted" });
  assertEquals(res.sidecars.length, 0);
});

Deno.test("codex.move: re-keys trust, leaves the date-keyed transcript in place", async () => {
  await using fake = await makeFakeRoot();
  const uuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const path = await writeSyntheticCodexSession(fake.home, "/old/app", uuid, {
    trustLevel: "trusted",
  });
  const ref = (await codex.find(fake.home, uuid))!;
  const result = await codex.move(fake.home, ref, "/new/app", { fork: false });

  assertEquals(result.fromTranscript, result.toTranscript); // not relocated
  assert(await exists(path)); // original still there
  const cfg = parseToml(
    await Deno.readTextFile(`${fake.home}/.codex/config.toml`),
  ) as Record<
    string,
    unknown
  >;
  assertEquals(extractCodexProject(cfg, "/new/app"), {
    trust_level: "trusted",
  });
  assertEquals(extractCodexProject(cfg, "/old/app"), null); // re-keyed
});

Deno.test("codex.move --fork: writes a fresh-id rollout copy", async () => {
  await using fake = await makeFakeRoot();
  const uuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  await writeSyntheticCodexSession(fake.home, "/old/app", uuid, {
    trustLevel: "trusted",
  });
  const ref = (await codex.find(fake.home, uuid))!;
  const newId = "ffffffff-1111-2222-3333-444444444444";
  const result = await codex.move(fake.home, ref, "/new/app", {
    fork: true,
    newSessionId: newId,
  });
  assertEquals(result.sessionId, newId);
  assert(result.toTranscript.includes(newId));
  assert(await exists(result.toTranscript));
  assert(await exists(ref.transcriptPath)); // original kept
});
