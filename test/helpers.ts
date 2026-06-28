import { ensureDir } from "@std/fs";
import { dirname } from "@std/path";
import {
  memoryDir,
  type Roots,
  rootsFromHome,
  transcriptPath,
} from "../src/core/paths.ts";
import {
  type ClaudeConfig,
  type ProjectEntry,
  readConfig,
  writeConfig,
} from "../src/core/config.ts";

/**
 * A disposable fake `$HOME/.claude` root populated with SYNTHETIC fixtures.
 * No real Claude state ever touches the tests.
 */
export interface FakeRoot {
  home: string;
  roots: Roots;
  [Symbol.asyncDispose](): Promise<void>;
}

export async function makeFakeRoot(): Promise<FakeRoot> {
  const home = await Deno.makeTempDir({ prefix: "transplant-test-" });
  const roots = rootsFromHome(home);
  await ensureDir(roots.claudeDir);
  return {
    home,
    roots,
    async [Symbol.asyncDispose]() {
      await Deno.remove(home, { recursive: true });
    },
  };
}

export interface SyntheticSessionOpts {
  summary?: string;
  firstPrompt?: string;
  /** The `cwd` value embedded in the transcript lines (defaults to the keyed cwd). */
  transcriptCwd?: string;
  /** Memory sidecar files keyed by path relative to `memory/`. */
  memory?: Record<string, string>;
  /** Extra opaque jsonl lines appended verbatim (kept synthetic). */
  extraLines?: string[];
}

/**
 * Write a synthetic session transcript (and optional memory sidecar) keyed under
 * `cwd`. The jsonl content is deliberately minimal but shaped like the real
 * format so the best-effort peek and the SDK oracle have something to read.
 */
export async function writeSyntheticSession(
  roots: Roots,
  cwd: string,
  sessionId: string,
  opts: SyntheticSessionOpts = {},
): Promise<string> {
  const transcriptCwd = opts.transcriptCwd ?? cwd;
  const summary = opts.summary ?? "synthetic session";
  const firstPrompt = opts.firstPrompt ?? "hello there";
  const lines = [
    JSON.stringify({
      type: "summary",
      summary,
      leafUuid: "00000000-0000-0000-0000-000000000001",
    }),
    JSON.stringify({
      type: "user",
      uuid: "00000000-0000-0000-0000-000000000002",
      cwd: transcriptCwd,
      sessionId,
      message: { role: "user", content: firstPrompt },
    }),
    ...(opts.extraLines ?? []),
  ];
  const path = transcriptPath(roots, cwd, sessionId);
  await ensureDir(dirname(path));
  await Deno.writeTextFile(path, lines.join("\n") + "\n");

  if (opts.memory) {
    const root = memoryDir(roots, cwd);
    for (const [rel, content] of Object.entries(opts.memory)) {
      const target = `${root}/${rel}`;
      await ensureDir(dirname(target));
      await Deno.writeTextFile(target, content);
    }
  }
  return path;
}

/** Set a synthetic project entry in the fake `~/.claude.json`. */
export async function setProjectEntry(
  roots: Roots,
  cwd: string,
  entry: ProjectEntry,
): Promise<void> {
  const config: ClaudeConfig = await readConfig(roots.configPath);
  config.projects = { ...(config.projects ?? {}), [cwd]: entry };
  await writeConfig(roots.configPath, config);
}

// ---- Codex fixtures ----------------------------------------------------------

export interface SyntheticCodexOpts {
  /** Filename timestamp portion, e.g. "2026-06-23T23-09-12". */
  ts?: string;
  /** Trust level to record in config.toml [projects."<cwd>"]; omitted = no entry. */
  trustLevel?: string;
  /** cwd recorded in the session_meta line (defaults to `cwd`). */
  metaCwd?: string;
}

/**
 * Write a synthetic Codex rollout under a fake `~/.codex` and optionally a
 * trust entry in config.toml. Returns the rollout's absolute path.
 */
export async function writeSyntheticCodexSession(
  home: string,
  cwd: string,
  uuid: string,
  opts: SyntheticCodexOpts = {},
): Promise<string> {
  const ts = opts.ts ?? "2026-06-23T23-09-12";
  const [y, m, d] = ts.split("T")[0].split("-");
  const name = `rollout-${ts}-${uuid}.jsonl`;
  const dir = `${home}/.codex/sessions/${y}/${m}/${d}`;
  await ensureDir(dir);
  const lines = [
    JSON.stringify({
      type: "session_meta",
      timestamp: `${ts}Z`,
      payload: { id: uuid, cwd: opts.metaCwd ?? cwd, cli_version: "9.9.9" },
    }),
    JSON.stringify({ type: "response_item", payload: { role: "assistant" } }),
  ];
  const path = `${dir}/${name}`;
  await Deno.writeTextFile(path, lines.join("\n") + "\n");

  if (opts.trustLevel !== undefined) {
    await setCodexTrust(home, cwd, opts.trustLevel);
  }
  return path;
}

/** Upsert a [projects."<cwd>"] trust entry in the fake config.toml. */
export async function setCodexTrust(
  home: string,
  cwd: string,
  trustLevel: string,
): Promise<void> {
  const path = `${home}/.codex/config.toml`;
  await ensureDir(`${home}/.codex`);
  let text = "";
  try {
    text = await Deno.readTextFile(path);
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  const { upsertCodexProject } = await import("../src/core/codex_config.ts");
  await Deno.writeTextFile(
    path,
    upsertCodexProject(text, cwd, { trust_level: trustLevel }),
  );
}
