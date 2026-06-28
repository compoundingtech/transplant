import { assert, assertEquals } from "@std/assert";
import {
  detectHarnesses,
  findAcross,
  getHarness,
  HARNESS_NAMES,
  isHarnessName,
  listAll,
} from "../src/harness/registry.ts";
import {
  makeFakeRoot,
  writeSyntheticCodexSession,
  writeSyntheticSession,
} from "./helpers.ts";

Deno.test("registry: names, lookup, and guard", () => {
  assertEquals(HARNESS_NAMES.sort(), ["claude-code", "codex"]);
  assert(isHarnessName("codex"));
  assert(!isHarnessName("bogus"));
  assertEquals(getHarness("codex").name, "codex");
});

Deno.test("detectHarnesses: finds both when both roots exist", async () => {
  await using fake = await makeFakeRoot(); // creates ~/.claude
  await writeSyntheticCodexSession(
    fake.home,
    "/a/b",
    "0a1b2c3d-4e5f-6789-abcd-ef0123456789",
  );
  const present = (await detectHarnesses(fake.home)).map((h) => h.name).sort();
  assertEquals(present, ["claude-code", "codex"]);
});

Deno.test("listAll: merges sessions from both harnesses, newest first", async () => {
  await using fake = await makeFakeRoot();
  await writeSyntheticSession(fake.roots, "/c/app", "claude-1");
  await writeSyntheticCodexSession(
    fake.home,
    "/x/app",
    "0a1b2c3d-4e5f-6789-abcd-ef0123456789",
  );
  const all = await listAll(fake.home);
  const harnesses = new Set(all.map((s) => s.harness));
  assertEquals(harnesses.size, 2);
});

Deno.test("findAcross: locates by id; restricts with `only`", async () => {
  await using fake = await makeFakeRoot();
  await writeSyntheticSession(fake.roots, "/c/app", "shared-id");
  const any = await findAcross(fake.home, "shared-id");
  assertEquals(any.length, 1);
  assertEquals(any[0].harness, "claude-code");
  assertEquals((await findAcross(fake.home, "shared-id", "codex")).length, 0);
});
