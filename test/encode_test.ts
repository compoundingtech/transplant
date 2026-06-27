import { assertEquals } from "@std/assert";
import { encodeCwd } from "../src/core/encode.ts";

Deno.test("encodeCwd: replaces every non-alphanumeric char with a hyphen", () => {
  assertEquals(encodeCwd("/path/to/my-project"), "-path-to-my-project");
});

Deno.test("encodeCwd: dots and slashes both collapse to hyphen", () => {
  assertEquals(encodeCwd("/a.b/c_d"), "-a-b-c-d");
});

Deno.test("encodeCwd: keeps alphanumerics, including digits and mixed case", () => {
  assertEquals(encodeCwd("/Users/Dev99/Proj"), "-Users-Dev99-Proj");
});

Deno.test("encodeCwd: collapses runs of separators 1:1 (not deduped)", () => {
  // Two separators in a row become two hyphens — the transform is per-char.
  assertEquals(encodeCwd("/a//b"), "-a--b");
});

Deno.test("encodeCwd: is lossy — different paths can collide", () => {
  assertEquals(encodeCwd("/a/b"), encodeCwd("/a.b"));
});
