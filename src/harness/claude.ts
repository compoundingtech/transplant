import { ensureDir, exists, walk } from "@std/fs";
import { basename, dirname, relative } from "@std/path";
import {
  memoryDir,
  projectDir,
  rootsFromHome,
  transcriptPath,
} from "../core/paths.ts";
import { findSession, listAllSessions } from "../core/sessions.ts";
import {
  extractProjectEntry,
  mergeProjectEntry,
  readConfig,
  writeConfig,
} from "../core/config.ts";
import { moveSession } from "../core/move.ts";
import type {
  ForkOptions,
  Harness,
  MoveResult,
  PlaceResult,
  SessionRef,
  SessionResources,
  SidecarFile,
} from "./types.ts";

const SIDECAR_MEMORY_PREFIX = "memory/";

/**
 * Claude Code harness. Sessions live at
 * `~/.claude/projects/<encoded-cwd>/<id>.jsonl`; the `memory/` sibling and the
 * `~/.claude.json` project entry are the sidecars. See the resource inventory in
 * the README for what is intentionally NOT migrated (file-history/session-env,
 * which are keyed by an ephemeral run-id, not the session).
 */
export class ClaudeHarness implements Harness {
  readonly name = "claude-code" as const;

  detect(home: string): Promise<boolean> {
    return exists(rootsFromHome(home).claudeDir);
  }

  async list(home: string): Promise<SessionRef[]> {
    const roots = rootsFromHome(home);
    const sessions = await listAllSessions(roots);
    return sessions.map((s) => ({
      harness: this.name,
      sessionId: s.sessionId,
      transcriptPath: s.cwd
        ? transcriptPath(roots, s.cwd, s.sessionId)
        : `${roots.claudeDir}/projects/${s.encodedCwd}/${s.sessionId}.jsonl`,
      transcriptBasename: `${s.sessionId}.jsonl`,
      cwd: s.cwd,
      lastModified: s.lastModified,
      fileSize: s.fileSize,
      summary: s.summary ?? s.firstPrompt,
    }));
  }

  async find(home: string, sessionId: string): Promise<SessionRef | null> {
    const roots = rootsFromHome(home);
    const s = await findSession(roots, sessionId);
    if (!s) return null;
    return {
      harness: this.name,
      sessionId: s.sessionId,
      transcriptPath: s.cwd
        ? transcriptPath(roots, s.cwd, s.sessionId)
        : `${roots.claudeDir}/projects/${s.encodedCwd}/${s.sessionId}.jsonl`,
      transcriptBasename: `${s.sessionId}.jsonl`,
      cwd: s.cwd,
      lastModified: s.lastModified,
      fileSize: s.fileSize,
      summary: s.summary ?? s.firstPrompt,
    };
  }

  async collect(home: string, ref: SessionRef): Promise<SessionResources> {
    if (!ref.cwd) {
      throw new Error(
        `cannot determine the source directory for ${ref.sessionId}; pass --from <dir>`,
      );
    }
    const roots = rootsFromHome(home);
    const transcript = await Deno.readFile(ref.transcriptPath);

    const sidecars: SidecarFile[] = [];
    const mem = memoryDir(roots, ref.cwd);
    if (await exists(mem)) {
      for await (const entry of walk(mem, { includeDirs: false })) {
        const rel = relative(mem, entry.path);
        sidecars.push({
          relPath: SIDECAR_MEMORY_PREFIX + rel,
          bytes: await Deno.readFile(entry.path),
        });
      }
    }

    const config = await readConfig(roots.configPath);
    const configEntry = extractProjectEntry(config, ref.cwd);

    return {
      transcript,
      transcriptBasename: ref.transcriptBasename,
      sidecars,
      configEntry,
      configKind: configEntry !== null ? "claude-json" : null,
    };
  }

  async place(
    home: string,
    toCwd: string,
    sessionId: string,
    res: SessionResources,
  ): Promise<PlaceResult> {
    const roots = rootsFromHome(home);
    const dest = transcriptPath(roots, toCwd, sessionId);
    await ensureDir(dirname(dest));
    await Deno.writeFile(dest, res.transcript);

    let sidecarsWritten = 0;
    const project = projectDir(roots, toCwd);
    for (const sidecar of res.sidecars) {
      const target = `${project}/${sidecar.relPath}`;
      await ensureDir(dirname(target));
      await Deno.writeFile(target, sidecar.bytes);
      sidecarsWritten++;
    }

    let mergedConfig = false;
    if (res.configEntry !== null) {
      const config = await readConfig(roots.configPath);
      const entry = { ...res.configEntry, lastSessionId: sessionId };
      await writeConfig(
        roots.configPath,
        mergeProjectEntry(config, toCwd, entry),
      );
      mergedConfig = true;
    }

    return {
      transcriptPath: dest,
      sessionId,
      toCwd,
      sidecarsWritten,
      mergedConfig,
    };
  }

  async move(
    home: string,
    ref: SessionRef,
    toCwd: string,
    opts: ForkOptions,
  ): Promise<MoveResult> {
    if (!ref.cwd) {
      throw new Error(
        `cannot determine the source directory for ${ref.sessionId}; pass --from <dir>`,
      );
    }
    const roots = rootsFromHome(home);
    // Count memory files before the move for an accurate report.
    let sidecarCount = 0;
    const mem = memoryDir(roots, ref.cwd);
    if (await exists(mem)) {
      for await (const _ of walk(mem, { includeDirs: false })) sidecarCount++;
    }
    const result = await moveSession(
      roots,
      ref.sessionId,
      ref.cwd,
      toCwd,
      opts,
    );
    return {
      fromTranscript: result.fromTranscript,
      toTranscript: result.toTranscript,
      sessionId: result.sessionId,
      movedSidecars: result.movedMemory ? sidecarCount : 0,
      movedConfig: result.movedConfig,
    };
  }
}

/** Stable basename of a Claude transcript path (exposed for tests/manifests). */
export function claudeTranscriptBasename(sessionId: string): string {
  return basename(`${sessionId}.jsonl`);
}
