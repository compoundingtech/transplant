import { assert, assertEquals } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { parse as parseToml } from "@std/toml";
import { importBundle, packSession } from "../src/migrate.ts";
import { getHarness } from "../src/harness/registry.ts";
import { transcriptPath } from "../src/core/paths.ts";
import { extractProjectEntry, readConfig } from "../src/core/config.ts";
import { extractCodexProject } from "../src/core/codex_config.ts";
import {
  makeFakeRoot,
  setProjectEntry,
  writeSyntheticCodexSession,
  writeSyntheticSession,
} from "./helpers.ts";

Deno.test("e2e Claude: pack on one machine, import onto another at a NEW path", async () => {
  await using src = await makeFakeRoot();
  const srcCwd = "/Users/alice/projects/app";
  const id = "abcd-1234";
  await writeSyntheticSession(src.roots, srcCwd, id, {
    summary: "ported",
    memory: { "MEMORY.md": "- [n](n.md)\n", "n.md": "remembered\n" },
  });
  await setProjectEntry(src.roots, srcCwd, {
    hasTrustDialogAccepted: true,
    allowedTools: ["Bash(ls)"],
    lastSessionId: id,
  });

  const harness = getHarness("claude-code");
  const ref = (await harness.find(src.home, id))!;
  const bundle = join(src.home, "session.tar");
  const manifest = await packSession(harness, src.home, ref, srcCwd, {
    createdAt: 1700000000000,
  }, bundle);
  assertEquals(manifest.harness, "claude-code");
  assertEquals(manifest.sidecarCount, 2);

  await using dst = await makeFakeRoot();
  const dstCwd = "/home/bob/work/app";
  const result = await importBundle(dst.home, bundle, dstCwd, { fork: false });

  assertEquals(result.harness, "claude-code");
  assertEquals(result.transcriptPath, transcriptPath(dst.roots, dstCwd, id));
  // Transcript identical (opaque blob).
  assertEquals(
    await Deno.readTextFile(result.transcriptPath),
    await Deno.readTextFile(transcriptPath(src.roots, srcCwd, id)),
  );
  assertEquals(result.sidecarsWritten, 2);
  assertEquals(
    await Deno.readTextFile(
      `${dst.roots.claudeDir}/projects/-home-bob-work-app/memory/n.md`,
    ),
    "remembered\n",
  );
  const cfg = await readConfig(dst.roots.configPath);
  assertEquals(extractProjectEntry(cfg, dstCwd)?.allowedTools, ["Bash(ls)"]);
  assertEquals(extractProjectEntry(cfg, dstCwd)?.lastSessionId, id);
});

Deno.test("e2e Codex: pack rollout + trust, import onto another machine at a NEW path", async () => {
  await using src = await makeFakeRoot();
  const srcCwd = "/Users/alice/code/proj";
  const uuid = "0a1b2c3d-4e5f-6789-abcd-ef0123456789";
  await writeSyntheticCodexSession(src.home, srcCwd, uuid, {
    ts: "2026-06-23T23-09-12",
    trustLevel: "trusted",
  });

  const harness = getHarness("codex");
  const ref = (await harness.find(src.home, uuid))!;
  const bundle = join(src.home, "codex.tar");
  const manifest = await packSession(harness, src.home, ref, srcCwd, {
    createdAt: 1,
  }, bundle);
  assertEquals(manifest.harness, "codex");
  assertEquals(manifest.configKind, "codex-toml");

  await using dst = await makeFakeRoot();
  const dstCwd = "/srv/relocated/proj";
  const result = await importBundle(dst.home, bundle, dstCwd, { fork: false });

  assertEquals(result.harness, "codex");
  // Rollout lands at the date-bucketed path (cwd-independent), original filename.
  assert(
    result.transcriptPath.endsWith(
      `/sessions/2026/06/23/rollout-2026-06-23T23-09-12-${uuid}.jsonl`,
    ),
  );
  assert(await exists(result.transcriptPath));
  // Trust re-keyed to the new cwd on this machine.
  const cfg = parseToml(
    await Deno.readTextFile(`${dst.home}/.codex/config.toml`),
  ) as Record<string, unknown>;
  assertEquals(extractCodexProject(cfg, dstCwd), { trust_level: "trusted" });
});

Deno.test("e2e Codex: import --fork assigns a fresh rollout id", async () => {
  await using src = await makeFakeRoot();
  const uuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  await writeSyntheticCodexSession(src.home, "/a/b", uuid, {
    trustLevel: "trusted",
  });
  const harness = getHarness("codex");
  const ref = (await harness.find(src.home, uuid))!;
  const bundle = join(src.home, "c.tar");
  await packSession(harness, src.home, ref, "/a/b", { createdAt: 1 }, bundle);

  await using dst = await makeFakeRoot();
  const newId = "ffffffff-1111-2222-3333-444444444444";
  const result = await importBundle(dst.home, bundle, "/c/d", {
    fork: true,
    newSessionId: newId,
  });
  assertEquals(result.sessionId, newId);
  assert(result.transcriptPath.includes(newId));
  assert(await exists(result.transcriptPath));
});
