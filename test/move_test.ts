import { assert, assertEquals, assertRejects } from "@std/assert";
import { exists } from "@std/fs";
import { moveSession } from "../src/core/move.ts";
import { memoryDir, transcriptPath } from "../src/core/paths.ts";
import { extractProjectEntry, readConfig } from "../src/core/config.ts";
import {
  makeFakeRoot,
  setProjectEntry,
  writeSyntheticSession,
} from "./helpers.ts";

Deno.test("moveSession: relocates transcript, removes source", async () => {
  await using fake = await makeFakeRoot();
  const id = "s1";
  await writeSyntheticSession(fake.roots, "/old/app", id);
  const from = transcriptPath(fake.roots, "/old/app", id);
  const to = transcriptPath(fake.roots, "/new/app", id);

  const result = await moveSession(fake.roots, id, "/old/app", "/new/app", {
    fork: false,
  });

  assertEquals(result.sessionId, id);
  assert(!(await exists(from)), "source should be gone");
  assert(await exists(to), "destination should exist");
});

Deno.test("moveSession: moves memory sidecar and re-keys config", async () => {
  await using fake = await makeFakeRoot();
  const id = "s2";
  await writeSyntheticSession(fake.roots, "/old/app", id, {
    memory: { "MEMORY.md": "x\n" },
  });
  await setProjectEntry(fake.roots, "/old/app", {
    hasTrustDialogAccepted: true,
    lastSessionId: id,
  });

  const result = await moveSession(fake.roots, id, "/old/app", "/new/app", {
    fork: false,
  });
  assert(result.movedMemory);
  assert(result.movedConfig);

  assert(await exists(`${memoryDir(fake.roots, "/new/app")}/MEMORY.md`));
  assert(!(await exists(memoryDir(fake.roots, "/old/app"))));

  const config = await readConfig(fake.roots.configPath);
  assertEquals(extractProjectEntry(config, "/old/app"), null);
  assertEquals(
    extractProjectEntry(config, "/new/app")?.hasTrustDialogAccepted,
    true,
  );
});

Deno.test("moveSession --fork: destination gets the new id and lastSessionId follows", async () => {
  await using fake = await makeFakeRoot();
  const id = "s3";
  await writeSyntheticSession(fake.roots, "/old/app", id);
  await setProjectEntry(fake.roots, "/old/app", { lastSessionId: id });

  const result = await moveSession(fake.roots, id, "/old/app", "/new/app", {
    fork: true,
    newSessionId: "forked-id",
  });
  assertEquals(result.sessionId, "forked-id");
  assert(await exists(transcriptPath(fake.roots, "/new/app", "forked-id")));

  const config = await readConfig(fake.roots.configPath);
  assertEquals(
    extractProjectEntry(config, "/new/app")?.lastSessionId,
    "forked-id",
  );
});

Deno.test("moveSession: errors on missing source", async () => {
  await using fake = await makeFakeRoot();
  await assertRejects(
    () => moveSession(fake.roots, "nope", "/a", "/b", { fork: false }),
    Error,
    "not found",
  );
});

Deno.test("moveSession: errors when destination already exists", async () => {
  await using fake = await makeFakeRoot();
  const id = "dup";
  await writeSyntheticSession(fake.roots, "/old/app", id);
  await writeSyntheticSession(fake.roots, "/new/app", id);
  await assertRejects(
    () => moveSession(fake.roots, id, "/old/app", "/new/app", { fork: false }),
    Error,
    "already exists",
  );
});

Deno.test("moveSession --fork: errors without a new id", async () => {
  await using fake = await makeFakeRoot();
  await writeSyntheticSession(fake.roots, "/old/app", "s");
  await assertRejects(
    () => moveSession(fake.roots, "s", "/old/app", "/new/app", { fork: true }),
    Error,
    "requires a new session id",
  );
});
