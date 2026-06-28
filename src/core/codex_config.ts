import { parse as parseToml } from "@std/toml";

/**
 * Read and surgically edit the `[projects."<cwd>"]` entries in Codex's
 * `~/.codex/config.toml`.
 *
 * Reads use `@std/toml` (safe, lossless for extraction). Writes are done by
 * targeted text edits — NOT a full parse→stringify round-trip — so the rest of
 * the user's real config (global prefs, `[mcp_servers.*]`, comments, ordering)
 * is preserved. Only the one project section we migrate is touched.
 */

export type CodexProjectEntry = Record<string, string | number | boolean>;

/** Parse the whole config; returns `{}` if the file is absent. */
export async function readCodexConfig(
  configPath: string,
): Promise<Record<string, unknown>> {
  try {
    return parseToml(await Deno.readTextFile(configPath)) as Record<
      string,
      unknown
    >;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return {};
    throw err;
  }
}

/** Extract the project entry for an absolute cwd, or null. */
export function extractCodexProject(
  config: Record<string, unknown>,
  cwd: string,
): CodexProjectEntry | null {
  const projects = config.projects as Record<string, unknown> | undefined;
  const entry = projects?.[cwd];
  if (!entry || typeof entry !== "object") return null;
  return entry as CodexProjectEntry;
}

function tomlValue(v: string | number | boolean): string {
  if (typeof v === "string") return JSON.stringify(v); // TOML basic strings match JSON quoting
  return String(v);
}

/** Render a `[projects."<cwd>"]` section block (TOML key escaped as a basic string). */
function renderSection(cwd: string, entry: CodexProjectEntry): string {
  const header = `[projects.${JSON.stringify(cwd)}]`;
  const body = Object.entries(entry)
    .map(([k, v]) => `${k} = ${tomlValue(v)}`)
    .join("\n");
  return body ? `${header}\n${body}\n` : `${header}\n`;
}

/**
 * Locate the [start, end) line range of the `[projects."<cwd>"]` section in
 * `lines`, or null if absent. `end` is the index of the next section header (or
 * lines.length).
 */
function findSection(
  lines: string[],
  cwd: string,
): { start: number; end: number } | null {
  const header = `[projects.${JSON.stringify(cwd)}]`;
  const start = lines.findIndex((l) => l.trim() === header);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/** Insert or replace the project section for `cwd`. Returns the new file text. */
export function upsertCodexProject(
  tomlText: string,
  cwd: string,
  entry: CodexProjectEntry,
): string {
  const section = renderSection(cwd, entry).replace(/\n$/, "");
  const lines = tomlText.length === 0 ? [] : tomlText.split("\n");
  const found = findSection(lines, cwd);
  if (found) {
    // Replace the existing section body (drop any trailing blank line it owned).
    let end = found.end;
    while (end > found.start + 1 && lines[end - 1].trim() === "") end--;
    lines.splice(found.start, end - found.start, ...section.split("\n"));
    return lines.join("\n");
  }
  const base = tomlText.replace(/\s*$/, "");
  return base.length === 0 ? section + "\n" : `${base}\n\n${section}\n`;
}

/** Remove the project section for `cwd`. Returns the new file text (unchanged if absent). */
export function removeCodexProject(tomlText: string, cwd: string): string {
  const lines = tomlText.split("\n");
  const found = findSection(lines, cwd);
  if (!found) return tomlText;
  let end = found.end;
  // Also swallow a single trailing blank separator line, if present.
  if (end < lines.length && lines[end].trim() === "") end++;
  lines.splice(found.start, end - found.start);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

/** Write config text, creating parent dirs as needed. */
export async function writeCodexConfig(
  configPath: string,
  text: string,
): Promise<void> {
  await Deno.writeTextFile(configPath, text);
}
