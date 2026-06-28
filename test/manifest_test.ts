import { assertEquals, assertThrows } from "@std/assert";
import {
  buildManifest,
  MANIFEST_VERSION,
  verifyManifest,
} from "../src/core/manifest.ts";

function good() {
  return buildManifest({
    harness: "claude-code",
    sessionId: "11111111-2222-3333-4444-555555555555",
    originalCwd: "/work/app",
    transcriptBasename: "11111111-2222-3333-4444-555555555555.jsonl",
    configKind: "claude-json",
    agentVersion: "9.9.9",
    sidecarCount: 2,
    hasConfigEntry: true,
    createdAt: 1700000000000,
  });
}

Deno.test("buildManifest: derives encodedCwd, stamps version + harness", () => {
  const m = good();
  assertEquals(m.version, MANIFEST_VERSION);
  assertEquals(m.harness, "claude-code");
  assertEquals(m.encodedCwd, "-work-app");
  assertEquals(m.configKind, "claude-json");
});

Deno.test("verifyManifest: accepts a built manifest round-trip", () => {
  const m = good();
  assertEquals(verifyManifest(JSON.parse(JSON.stringify(m))), m);
});

Deno.test("verifyManifest: accepts a codex manifest with null config", () => {
  const m = buildManifest({
    harness: "codex",
    sessionId: "abcd",
    originalCwd: "/x",
    transcriptBasename: "rollout-2026-01-01T00-00-00-abcd.jsonl",
    configKind: null,
    sidecarCount: 0,
    hasConfigEntry: false,
    createdAt: 1,
  });
  assertEquals(verifyManifest(JSON.parse(JSON.stringify(m))), m);
});

Deno.test("verifyManifest: rejects unknown harness", () => {
  assertThrows(
    () => verifyManifest({ ...good(), harness: "bogus" }),
    Error,
    "known harness",
  );
});

Deno.test("verifyManifest: rejects wrong version", () => {
  assertThrows(
    () => verifyManifest({ ...good(), version: 99 }),
    Error,
    "unsupported manifest version",
  );
});

Deno.test("verifyManifest: rejects mismatched encodedCwd", () => {
  assertThrows(
    () => verifyManifest({ ...good(), encodedCwd: "-wrong" }),
    Error,
    "does not match",
  );
});

Deno.test("verifyManifest: rejects bad configKind", () => {
  assertThrows(
    () => verifyManifest({ ...good(), configKind: "nope" }),
    Error,
    "configKind",
  );
});

Deno.test("verifyManifest: rejects non-object", () => {
  assertThrows(() => verifyManifest(null), Error, "not an object");
});
