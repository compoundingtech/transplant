import { parseArgs } from "@std/cli";
import { type Roots, rootsFromHome } from "./core/paths.ts";
import { findSession, listAllSessions } from "./core/sessions.ts";
import { moveSession } from "./core/move.ts";
import { packSession } from "./core/pack.ts";
import { importBundle } from "./core/import.ts";

const HELP =
  `transplant — migrate Claude Code sessions between working directories and machines

USAGE:
  transplant ls
  transplant move <session-id> --to <dir> [--from <dir>] [--fork-session]
  transplant pack <session-id> -o <bundle.tar> [--from <dir>]
  transplant import <bundle.tar> --to <dir> [--fork-session]

COMMANDS:
  ls       List local sessions (across all project folders).
  move     Relocate a session to another directory on this machine.
  pack     Bundle a session (transcript + memory + project config) for transport.
  import   Reconstruct a bundled session on this machine under --to.

OPTIONS:
  --to <dir>        Destination project directory (absolute path).
  --from <dir>      Source project directory; only needed if it can't be
                    auto-detected from the transcript.
  -o, --output      Output bundle path (pack).
  --fork-session    Give the session a fresh id at the destination so two
                    directories never point at one transcript file.
  -h, --help        Show this help.

The transcript is always treated as an opaque blob and never parsed for content.
After importing on another machine, note that MCP servers, hooks and tools the
session references must exist there, auth is per-machine, and absolute paths
baked into history are not rewritten.`;

function homeDir(): string {
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
  if (!home) throw new Error("cannot determine home directory ($HOME unset)");
  return home;
}

/** Best-effort Claude Code version for the manifest; null if unavailable. */
async function detectClaudeVersion(): Promise<string | null> {
  try {
    const cmd = new Deno.Command("claude", {
      args: ["--version"],
      stdout: "piped",
      stderr: "null",
    });
    const { success, stdout } = await cmd.output();
    if (!success) return null;
    const out = new TextDecoder().decode(stdout).trim();
    return out || null;
  } catch {
    return null;
  }
}

async function resolveSourceCwd(
  roots: Roots,
  sessionId: string,
  override: string | undefined,
): Promise<string> {
  if (override) return override;
  const found = await findSession(roots, sessionId);
  if (!found) throw new Error(`session not found: ${sessionId}`);
  if (!found.cwd) {
    throw new Error(
      `could not determine the source directory for ${sessionId}; pass --from <dir>`,
    );
  }
  return found.cwd;
}

function requireString(value: unknown, flag: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing required ${flag}`);
  }
  return value;
}

async function cmdLs(roots: Roots): Promise<number> {
  const sessions = await listAllSessions(roots);
  if (sessions.length === 0) {
    console.log("No local sessions found.");
    return 0;
  }
  for (const s of sessions) {
    const when = s.lastModified ? new Date(s.lastModified).toISOString() : "?";
    const where = s.cwd ?? `(encoded: ${s.encodedCwd})`;
    const desc = s.summary ?? s.firstPrompt ?? "";
    console.log(`${s.sessionId}\t${when}\t${where}`);
    if (desc) console.log(`    ${desc.replaceAll("\n", " ").slice(0, 100)}`);
  }
  return 0;
}

async function cmdMove(
  roots: Roots,
  args: ReturnType<typeof parseArgs>,
): Promise<number> {
  const sessionId = requireString(args._[1], "session-id");
  const toCwd = requireString(args.to, "--to");
  const fork = Boolean(args["fork-session"]);
  const fromCwd = await resolveSourceCwd(
    roots,
    sessionId,
    args.from as string | undefined,
  );
  const newSessionId = fork ? crypto.randomUUID() : undefined;
  const result = await moveSession(roots, sessionId, fromCwd, toCwd, {
    fork,
    newSessionId,
  });
  console.log(`Moved ${sessionId} → ${result.toTranscript}`);
  if (fork) console.log(`Forked to new id: ${result.sessionId}`);
  if (result.movedMemory) console.log("Moved memory/ sidecar.");
  if (result.movedConfig) console.log("Re-keyed ~/.claude.json project entry.");
  return 0;
}

async function cmdPack(
  roots: Roots,
  args: ReturnType<typeof parseArgs>,
): Promise<number> {
  const sessionId = requireString(args._[1], "session-id");
  const out = requireString(args.output, "-o/--output");
  const cwd = await resolveSourceCwd(
    roots,
    sessionId,
    args.from as string | undefined,
  );
  const manifest = await packSession(
    roots,
    {
      sessionId,
      cwd,
      createdAt: Date.now(),
      claudeVersion: await detectClaudeVersion(),
    },
    out,
  );
  console.log(`Packed ${sessionId} → ${out}`);
  console.log(`  origin: ${manifest.originalCwd}`);
  console.log(
    `  memory: ${manifest.hasMemory ? "yes" : "no"}, config: ${
      manifest.hasProjectConfig ? "yes" : "no"
    }`,
  );
  return 0;
}

async function cmdImport(
  roots: Roots,
  args: ReturnType<typeof parseArgs>,
): Promise<number> {
  const bundle = requireString(args._[1], "bundle path");
  const toCwd = requireString(args.to, "--to");
  const fork = Boolean(args["fork-session"]);
  const newSessionId = fork ? crypto.randomUUID() : undefined;
  const result = await importBundle(roots, bundle, toCwd, {
    fork,
    newSessionId,
  });
  console.log(`Imported → ${result.toTranscript}`);
  console.log(`  session id: ${result.sessionId}${fork ? " (forked)" : ""}`);
  if (result.restoredMemory > 0) {
    console.log(`  restored ${result.restoredMemory} memory file(s).`);
  }
  if (result.mergedConfig) {
    console.log("  merged ~/.claude.json project entry.");
  }
  return 0;
}

/** Parse argv, dispatch to a command, and return a process exit code. */
export async function runCli(argv: string[]): Promise<number> {
  const args = parseArgs(argv, {
    boolean: ["help", "fork-session"],
    string: ["to", "from", "output"],
    alias: { h: "help", o: "output" },
    stopEarly: false,
  });

  if (args.help || args._.length === 0) {
    console.log(HELP);
    return args.help ? 0 : 1;
  }

  const command = String(args._[0]);
  const roots = rootsFromHome(homeDir());

  try {
    switch (command) {
      case "ls":
        return await cmdLs(roots);
      case "move":
        return await cmdMove(roots, args);
      case "pack":
        return await cmdPack(roots, args);
      case "import":
        return await cmdImport(roots, args);
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
