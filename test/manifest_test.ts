import { assertEquals, assertThrows } from "@std/assert";
import {
  buildManifest,
  MANIFEST_VERSION,
  verifyManifest,
} from "../src/core/manifest.ts";

function good() {
  return buildManifest({
    sessionId: "11111111-2222-3333-4444-555555555555",
    originalCwd: "/work/app",
    claudeVersion: "9.9.9",
    hasMemory: true,
    hasProjectConfig: false,
    createdAt: 1700000000000,
  });
}

Deno.test("buildManifest: derives encodedCwd and stamps the version", () => {
  const m = good();
  assertEquals(m.version, MANIFEST_VERSION);
  assertEquals(m.encodedCwd, "-work-app");
  assertEquals(m.originalCwd, "/work/app");
  assertEquals(m.claudeVersion, "9.9.9");
});

Deno.test("buildManifest: defaults claudeVersion to null", () => {
  const m = buildManifest({
    sessionId: "x",
    originalCwd: "/a",
    hasMemory: false,
    hasProjectConfig: false,
    createdAt: 0,
  });
  assertEquals(m.claudeVersion, null);
});

Deno.test("verifyManifest: accepts a freshly built manifest round-trip", () => {
  const m = good();
  const parsed = JSON.parse(JSON.stringify(m));
  assertEquals(verifyManifest(parsed), m);
});

Deno.test("verifyManifest: rejects wrong version", () => {
  const m = { ...good(), version: 99 };
  assertThrows(() => verifyManifest(m), Error, "unsupported manifest version");
});

Deno.test("verifyManifest: rejects mismatched encodedCwd", () => {
  const m = { ...good(), encodedCwd: "-wrong" };
  assertThrows(() => verifyManifest(m), Error, "does not match");
});

Deno.test("verifyManifest: rejects missing sessionId", () => {
  const m = { ...good() } as Record<string, unknown>;
  delete m.sessionId;
  assertThrows(() => verifyManifest(m), Error, "sessionId");
});

Deno.test("verifyManifest: rejects non-object", () => {
  assertThrows(() => verifyManifest(null), Error, "not an object");
});
