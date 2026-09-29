import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import {
  extractCodexProject,
  removeCodexProject,
  upsertCodexProject,
} from "../src/core/codex_config.ts";

const SAMPLE = `model = "gpt-x"
personality = "concise"

[projects."/work/app"]
trust_level = "trusted"

[mcp_servers.coord]
command = "coord"
`;

Deno.test("extractCodexProject: reads a project entry, else null", () => {
  const config = parseToml(SAMPLE) as Record<string, unknown>;
  assertEquals(extractCodexProject(config, "/work/app"), {
    trust_level: "trusted",
  });
  assertEquals(extractCodexProject(config, "/missing"), null);
});

Deno.test("upsertCodexProject: adds a new section, preserving the rest of the file", () => {
  const next = upsertCodexProject(SAMPLE, "/new/dir", {
    trust_level: "trusted",
  });
  // Existing content survives untouched.
  assertStringIncludes(next, `model = "gpt-x"`);
  assertStringIncludes(next, `[mcp_servers.coord]`);
  assertStringIncludes(next, `[projects."/work/app"]`);
  // New section is present and parses.
  const parsed = parseToml(next) as Record<string, unknown>;
  assertEquals(extractCodexProject(parsed, "/new/dir"), {
    trust_level: "trusted",
  });
});

Deno.test("upsertCodexProject: replaces an existing section's body in place", () => {
  const next = upsertCodexProject(SAMPLE, "/work/app", {
    trust_level: "untrusted",
  });
  const parsed = parseToml(next) as Record<string, unknown>;
  assertEquals(extractCodexProject(parsed, "/work/app"), {
    trust_level: "untrusted",
  });
  // mcp_servers section still intact after an in-place replace.
  assertStringIncludes(next, `[mcp_servers.coord]`);
});

Deno.test("upsertCodexProject: handles an empty initial file", () => {
  const next = upsertCodexProject("", "/x", { trust_level: "trusted" });
  const parsed = parseToml(next) as Record<string, unknown>;
  assertEquals(extractCodexProject(parsed, "/x"), { trust_level: "trusted" });
});

Deno.test("removeCodexProject: drops a section, keeps others", () => {
  const next = removeCodexProject(SAMPLE, "/work/app");
  const parsed = parseToml(next) as Record<string, unknown>;
  assertEquals(extractCodexProject(parsed, "/work/app"), null);
  assertStringIncludes(next, `[mcp_servers.coord]`);
  assertStringIncludes(next, `model = "gpt-x"`);
});

Deno.test("upsertCodexProject: round-trips a path containing special chars", () => {
  const cwd = "/Users/example/My Project.v2";
  const next = upsertCodexProject(SAMPLE, cwd, { trust_level: "trusted" });
  const parsed = parseToml(next) as Record<string, unknown>;
  assert(extractCodexProject(parsed, cwd) !== null);
});
