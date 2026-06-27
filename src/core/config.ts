/**
 * Read, extract, rewrite and merge the per-project entry inside `~/.claude.json`.
 *
 * `~/.claude.json` is a single JSON object whose top-level `projects` map is
 * keyed by the ABSOLUTE working-directory path (not the encoded form). Each
 * entry carries trust acceptance, tool permissions, MCP enablement and
 * `lastSessionId`. Migrating the entry alongside the transcript avoids re-prompts
 * on first launch in the new location.
 *
 * We only ever touch the one project entry we are migrating; the rest of the
 * (potentially large, machine-private) config is left untouched.
 */

/** A single project's config block. Shape is owned by Claude Code; we treat it as opaque. */
export type ProjectEntry = Record<string, unknown>;

/** The subset of `~/.claude.json` we care about: just the projects map. */
export interface ClaudeConfig {
  projects?: Record<string, ProjectEntry>;
  [key: string]: unknown;
}

/** Parse a `~/.claude.json`. Returns an empty config if the file is absent. */
export async function readConfig(configPath: string): Promise<ClaudeConfig> {
  try {
    const text = await Deno.readTextFile(configPath);
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") return parsed as ClaudeConfig;
    return {};
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return {};
    throw err;
  }
}

/** Pull the project entry for an absolute cwd, or `null` if there isn't one. */
export function extractProjectEntry(
  config: ClaudeConfig,
  cwd: string,
): ProjectEntry | null {
  return config.projects?.[cwd] ?? null;
}

/**
 * Return a copy of `entry` rewritten for the destination. The only field tied to
 * a specific transcript is `lastSessionId`; when the session is forked (new id)
 * we point it at the new id so `claude --continue` resumes the right transcript.
 */
export function rewriteProjectEntry(
  entry: ProjectEntry,
  opts: { sessionId?: string } = {},
): ProjectEntry {
  const next: ProjectEntry = { ...entry };
  if (opts.sessionId !== undefined) next.lastSessionId = opts.sessionId;
  return next;
}

/**
 * Return a new config with `entry` placed under the destination cwd key. Pure:
 * the input config is not mutated.
 */
export function mergeProjectEntry(
  config: ClaudeConfig,
  cwd: string,
  entry: ProjectEntry,
): ClaudeConfig & { projects: Record<string, ProjectEntry> } {
  return {
    ...config,
    projects: { ...(config.projects ?? {}), [cwd]: entry },
  };
}

/** Return a new config with the project entry for `cwd` removed. */
export function removeProjectEntry(
  config: ClaudeConfig,
  cwd: string,
): ClaudeConfig {
  if (!config.projects || !(cwd in config.projects)) return config;
  const projects = { ...config.projects };
  delete projects[cwd];
  return { ...config, projects };
}

/** Serialize and write a config back to disk (pretty-printed, trailing newline). */
export async function writeConfig(
  configPath: string,
  config: ClaudeConfig,
): Promise<void> {
  await Deno.writeTextFile(configPath, JSON.stringify(config, null, 2) + "\n");
}
