import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  memoryDir,
  projectDir,
  projectsDir,
  rootsFromHome,
  transcriptPath,
} from "../src/core/paths.ts";

const roots = rootsFromHome("/home/user");

Deno.test("rootsFromHome: derives claudeDir and configPath", () => {
  assertEquals(roots.claudeDir, "/home/user/.claude");
  assertEquals(roots.configPath, "/home/user/.claude.json");
});

Deno.test("projectsDir: points at ~/.claude/projects", () => {
  assertEquals(projectsDir(roots), "/home/user/.claude/projects");
});

Deno.test("projectDir: appends the encoded cwd", () => {
  assertEquals(
    projectDir(roots, "/work/app"),
    "/home/user/.claude/projects/-work-app",
  );
});

Deno.test("transcriptPath: <projects>/<encoded>/<id>.jsonl", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  assertEquals(
    transcriptPath(roots, "/work/app", id),
    `/home/user/.claude/projects/-work-app/${id}.jsonl`,
  );
});

Deno.test("memoryDir: sibling memory folder in the project dir", () => {
  assertStringIncludes(memoryDir(roots, "/work/app"), "/-work-app/memory");
});
