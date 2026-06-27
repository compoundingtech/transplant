/**
 * DEV-ONLY oracle test. The shipped binary does NOT bundle the Claude Agent SDK
 * (see deno.json / README for the rationale: it drags a heavy transitive tree
 * just to list files). Instead we keep the SDK here, in tests only, as a
 * reference implementation: our pure-core `listAllSessions` must agree with the
 * SDK's `listSessions` on the fields both derive, for synthetic fixtures.
 *
 * If the SDK can't be loaded (offline, version pull fails), the test is skipped
 * rather than failing the suite.
 */
import { assertEquals } from "@std/assert";
import { listAllSessions } from "../src/core/sessions.ts";
import { makeFakeRoot, writeSyntheticSession } from "./helpers.ts";

async function loadSdk(): Promise<
  { listSessions: (opts: { dir: string }) => Promise<unknown[]> } | null
> {
  try {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    if (typeof sdk.listSessions === "function") {
      return sdk as unknown as {
        listSessions: (opts: { dir: string }) => Promise<unknown[]>;
      };
    }
    return null;
  } catch {
    return null;
  }
}

Deno.test("oracle: pure ls agrees with SDK listSessions on shared fields", async () => {
  const sdk = await loadSdk();
  if (!sdk) {
    console.warn("SDK unavailable — skipping oracle test");
    return;
  }

  await using fake = await makeFakeRoot();
  const cwd = `${fake.home}/proj`;
  await writeSyntheticSession(
    fake.roots,
    cwd,
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    {
      summary: "oracle session",
      firstPrompt: "compare me",
    },
  );

  // The SDK reads HOME to find ~/.claude; point it at our fake root.
  const prevHome = Deno.env.get("HOME");
  Deno.env.set("HOME", fake.home);
  let sdkSessions: Array<Record<string, unknown>>;
  try {
    sdkSessions = (await sdk.listSessions({ dir: cwd })) as Array<
      Record<string, unknown>
    >;
  } finally {
    if (prevHome !== undefined) Deno.env.set("HOME", prevHome);
  }

  const ours = await listAllSessions(fake.roots);
  assertEquals(ours.length, 1);
  assertEquals(sdkSessions.length, 1);

  const o = ours[0];
  const s = sdkSessions[0];
  // Shared, authoritative fields must match the reference implementation.
  assertEquals(o.sessionId, s.sessionId);
  assertEquals(o.fileSize, s.fileSize);
  assertEquals(o.cwd, s.cwd);
  assertEquals(o.summary, s.summary);
  assertEquals(o.firstPrompt, s.firstPrompt);
});
