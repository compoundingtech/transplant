import { parseArgs } from "@std/cli";
import {
  findAcross,
  getHarness,
  isHarnessName,
  listAll,
} from "./harness/registry.ts";
import type { HarnessName, SessionRef } from "./harness/types.ts";
import { importBundle, packSession } from "./migrate.ts";

const HELP =
  `transplant — migrate agent CLI sessions between working directories and machines

Supports the Claude Code and Codex harnesses behind one interface.

USAGE:
  transplant ls [--harness <claude-code|codex>]
  transplant move <session-id> --to <dir> [--from <dir>] [--harness <h>] [--fork-session]
  transplant pack <session-id> -o <bundle.tar> [--from <dir>] [--harness <h>]
  transplant import <bundle.tar> --to <dir> [--fork-session]

COMMANDS:
  ls       List local sessions across harnesses.
  move     Relocate a session to another directory on this machine.
  pack     Bundle a session (transcript + sidecars + project config) for transport.
  import   Reconstruct a bundled session on this machine under --to (harness from manifest).

OPTIONS:
  --to <dir>        Destination project directory (absolute path).
  --from <dir>      Source project directory; only needed if it can't be detected.
  --harness <h>     Restrict to a harness (claude-code | codex) to disambiguate.
  -o, --output      Output bundle path (pack).
  --fork-session    Give the session a fresh id at the destination.
  -h, --help        Show this help.

The transcript is always treated as an opaque blob and never parsed for content.
Note across machines: referenced MCP servers/hooks/tools must exist on the target,
auth is per-machine (credentials are never transported), and absolute paths baked
into history are not rewritten. Codex sessions are date-keyed (not cwd-keyed), so a
same-machine "move" only re-keys the trust entry; the transcript stays in place.`;

function homeDir(): string {
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
  if (!home) throw new Error("cannot determine home directory ($HOME unset)");
  return home;
}

/** Best-effort agent version for the manifest; null if unavailable. */
async function detectVersion(harness: HarnessName): Promise<string | null> {
  const bin = harness === "codex" ? "codex" : "claude";
  try {
    const cmd = new Deno.Command(bin, {
      args: ["--version"],
      stdout: "piped",
      stderr: "null",
    });
    const { success, stdout } = await cmd.output();
    if (!success) return null;
    return new TextDecoder().decode(stdout).trim() || null;
  } catch {
    return null;
  }
}

function requireString(value: unknown, flag: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing required ${flag}`);
  }
  return value;
}

function harnessFilter(
  args: ReturnType<typeof parseArgs>,
): HarnessName | undefined {
  const h = args.harness as string | undefined;
  if (h === undefined) return undefined;
  if (!isHarnessName(h)) {
    throw new Error(`unknown harness: ${h} (use claude-code or codex)`);
  }
  return h;
}

/** Resolve a single session ref by id, erroring clearly on miss/ambiguity. */
async function resolveRef(
  home: string,
  sessionId: string,
  only: HarnessName | undefined,
): Promise<SessionRef> {
  const matches = await findAcross(home, sessionId, only);
  if (matches.length === 0) throw new Error(`session not found: ${sessionId}`);
  if (matches.length > 1) {
    const which = matches.map((m) => m.harness).join(", ");
    throw new Error(
      `session id ${sessionId} exists in multiple harnesses (${which}); pass --harness`,
    );
  }
  return matches[0];
}

function resolveCwd(ref: SessionRef, override: string | undefined): string {
  if (override) return override;
  if (ref.cwd) return ref.cwd;
  throw new Error(
    `could not determine the directory for ${ref.sessionId}; pass --from <dir>`,
  );
}

async function cmdLs(
  home: string,
  only: HarnessName | undefined,
): Promise<number> {
  const sessions = await listAll(home, only);
  if (sessions.length === 0) {
    console.log("No local sessions found.");
    return 0;
  }
  for (const s of sessions) {
    const when = s.lastModified ? new Date(s.lastModified).toISOString() : "?";
    const where = s.cwd ?? "(unknown dir)";
    console.log(`${s.harness}\t${s.sessionId}\t${when}\t${where}`);
    if (s.summary) {
      console.log(`    ${s.summary.replaceAll("\n", " ").slice(0, 100)}`);
    }
  }
  return 0;
}

async function cmdMove(
  home: string,
  args: ReturnType<typeof parseArgs>,
): Promise<number> {
  const sessionId = requireString(args._[1], "session-id");
  const toCwd = requireString(args.to, "--to");
  const fork = Boolean(args["fork-session"]);
  const ref = await resolveRef(home, sessionId, harnessFilter(args));
  const cwd = resolveCwd(ref, args.from as string | undefined);
  const harness = getHarness(ref.harness);
  const newSessionId = fork ? crypto.randomUUID() : undefined;
  const result = await harness.move(home, { ...ref, cwd }, toCwd, {
    fork,
    newSessionId,
  });

  if (result.fromTranscript === result.toTranscript && !fork) {
    console.log(`Re-keyed ${ref.harness} session ${sessionId} to ${toCwd}.`);
    console.log(
      `  transcript stays at ${result.toTranscript} (date-keyed, not cwd-keyed).`,
    );
  } else {
    console.log(`Moved ${sessionId} → ${result.toTranscript}`);
  }
  if (fork) console.log(`Forked to new id: ${result.sessionId}`);
  if (result.movedSidecars > 0) {
    console.log(`Moved ${result.movedSidecars} sidecar file(s).`);
  }
  if (result.movedConfig) console.log("Re-keyed project config entry.");
  return 0;
}

async function cmdPack(
  home: string,
  args: ReturnType<typeof parseArgs>,
): Promise<number> {
  const sessionId = requireString(args._[1], "session-id");
  const out = requireString(args.output, "-o/--output");
  const ref = await resolveRef(home, sessionId, harnessFilter(args));
  const cwd = resolveCwd(ref, args.from as string | undefined);
  const harness = getHarness(ref.harness);
  const manifest = await packSession(
    harness,
    home,
    ref,
    cwd,
    { createdAt: Date.now(), agentVersion: await detectVersion(ref.harness) },
    out,
  );
  console.log(`Packed ${ref.harness} session ${sessionId} → ${out}`);
  console.log(`  origin: ${manifest.originalCwd}`);
  console.log(
    `  sidecars: ${manifest.sidecarCount}, config: ${
      manifest.hasConfigEntry ? "yes" : "no"
    }`,
  );
  return 0;
}

async function cmdImport(
  home: string,
  args: ReturnType<typeof parseArgs>,
): Promise<number> {
  const bundle = requireString(args._[1], "bundle path");
  const toCwd = requireString(args.to, "--to");
  const fork = Boolean(args["fork-session"]);
  const newSessionId = fork ? crypto.randomUUID() : undefined;
  const result = await importBundle(home, bundle, toCwd, {
    fork,
    newSessionId,
  });
  console.log(`Imported ${result.harness} session → ${result.transcriptPath}`);
  console.log(`  session id: ${result.sessionId}${fork ? " (forked)" : ""}`);
  if (result.sidecarsWritten > 0) {
    console.log(`  restored ${result.sidecarsWritten} sidecar file(s).`);
  }
  if (result.mergedConfig) console.log("  merged project config entry.");
  return 0;
}

/** Parse argv, dispatch to a command, and return a process exit code. */
export async function runCli(argv: string[]): Promise<number> {
  const args = parseArgs(argv, {
    boolean: ["help", "fork-session"],
    string: ["to", "from", "output", "harness"],
    alias: { h: "help", o: "output" },
  });

  if (args.help || args._.length === 0) {
    console.log(HELP);
    return args.help ? 0 : 1;
  }

  const command = String(args._[0]);
  const home = homeDir();
  try {
    switch (command) {
      case "ls":
        return await cmdLs(home, harnessFilter(args));
      case "move":
        return await cmdMove(home, args);
      case "pack":
        return await cmdPack(home, args);
      case "import":
        return await cmdImport(home, args);
      default:
        console.error(`Unknown command: ${command}\n`);
        console.log(HELP);
        return 1;
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
