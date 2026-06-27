import { assert, assertEquals } from "@std/assert";
import {
  extractProjectEntry,
  mergeProjectEntry,
  readConfig,
  removeProjectEntry,
  rewriteProjectEntry,
  writeConfig,
} from "../src/core/config.ts";
import { makeFakeRoot, setProjectEntry } from "./helpers.ts";

Deno.test("readConfig: missing file yields empty config", async () => {
  await using fake = await makeFakeRoot();
  const config = await readConfig(fake.roots.configPath);
  assertEquals(config, {});
});

Deno.test("extractProjectEntry: returns the entry for an absolute cwd, else null", () => {
  const config = {
    projects: { "/work/app": { hasTrustDialogAccepted: true } },
  };
  assertEquals(extractProjectEntry(config, "/work/app"), {
    hasTrustDialogAccepted: true,
  });
  assertEquals(extractProjectEntry(config, "/work/other"), null);
});

Deno.test("rewriteProjectEntry: updates lastSessionId without mutating input", () => {
  const entry = { lastSessionId: "old", allowedTools: ["a"] };
  const next = rewriteProjectEntry(entry, { sessionId: "new" });
  assertEquals(next.lastSessionId, "new");
  assertEquals(entry.lastSessionId, "old"); // pure
  assertEquals(next.allowedTools, ["a"]);
});

Deno.test("mergeProjectEntry: adds under the new key, leaves config immutable", () => {
  const config = { projects: { "/a": { x: 1 } }, other: true };
  const next = mergeProjectEntry(config, "/b", { y: 2 });
  assertEquals(next.projects["/a"], { x: 1 });
  assertEquals(next.projects["/b"], { y: 2 });
  assertEquals(next.other, true);
  assert(!("/b" in config.projects)); // original untouched
});

Deno.test("removeProjectEntry: drops the key, immutably", () => {
  const config = { projects: { "/a": { x: 1 }, "/b": { y: 2 } } };
  const next = removeProjectEntry(config, "/a");
  assertEquals(Object.keys(next.projects ?? {}), ["/b"]);
  assertEquals(Object.keys(config.projects), ["/a", "/b"]);
});

Deno.test("read/write round-trips a project entry through the fake root", async () => {
  await using fake = await makeFakeRoot();
  await setProjectEntry(fake.roots, "/work/app", {
    hasTrustDialogAccepted: true,
  });
  const config = await readConfig(fake.roots.configPath);
  assertEquals(extractProjectEntry(config, "/work/app"), {
    hasTrustDialogAccepted: true,
  });
  // a second entry survives a rewrite of the file
  await writeConfig(
    fake.roots.configPath,
    mergeProjectEntry(config, "/x", { z: 9 }),
  );
  const after = await readConfig(fake.roots.configPath);
  assertEquals(Object.keys(after.projects ?? {}).sort(), ["/work/app", "/x"]);
});
