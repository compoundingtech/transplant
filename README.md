# transplant

A small CLI to migrate agent-CLI sessions — **Claude Code** and **Codex** —
between working directories and between machines, without losing conversation
history.

## Why

Agent CLIs store each session transcript on disk and tie session resumption to
your working directory. Rename or move a project, or switch machines, and the
lookup fails and the history appears lost. `transplant` relocates the transcript
and its sidecars to wherever the project now lives — on this machine or another
— behind one interface, with a per-harness understanding of each tool's real
on-disk layout.

## Install

Requires [Deno](https://deno.com/) 2.x.

```sh
deno run -A main.ts <command>     # from source
deno task compile                 # build ./transplant
./transplant --help
```

## Commands

```
transplant ls [--harness <claude-code|codex>]
transplant move <session-id> --to <dir> [--from <dir>] [--harness <h>] [--fork-session]
transplant pack <session-id> -o <bundle.tar> [--from <dir>] [--harness <h>]
transplant import <bundle.tar> --to <dir> [--fork-session]
```

- `ls` lists local sessions across both harnesses
  (`<harness> <id> <modified> <dir>`).
- `move` relocates a session to another directory on this machine.
- `pack` bundles a session for transport; `import` reconstructs it (the harness
  is read from the bundle manifest, so `import` needs no `--harness`).
- `--from` is only needed when the source directory can't be auto-detected.
- `--harness` disambiguates if a session id somehow exists in both.
- `--fork-session` assigns a fresh session-id at the destination so two
  directories never point at one transcript.

A packed bundle is a tar of `manifest.json` (harness, original absolute cwd,
session id, agent version), `transcript.jsonl` (the opaque transcript),
`config-entry.json` (the cwd-keyed project config), and any sidecar files.

## How each harness stores a session (verified on disk)

The transcript is always treated as an **opaque blob** — never parsed for
migration; its format is internal to each tool and changes between releases.

### Claude Code (`~/.claude`)

| Resource                                                     | Path                                                                                            | Migrated?                                                                                                                                                         |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transcript                                                   | `projects/<encoded-cwd>/<id>.jsonl`                                                             | ✅                                                                                                                                                                |
| Memory sidecar                                               | `projects/<encoded-cwd>/memory/`                                                                | ✅                                                                                                                                                                |
| Project config                                               | `~/.claude.json` → `projects["<abs-cwd>"]` (trust, allowedTools, MCP enablement, lastSessionId) | ✅ (whole entry)                                                                                                                                                  |
| File checkpoints / env                                       | `file-history/<run-id>/`, `session-env/<run-id>/`                                               | ❌ keyed by an **ephemeral harness run-id**, not the session id — there is no on-disk session→checkpoint mapping, and they are per-run working state, not history |
| Shell snapshots, global command history, tasks/plans, caches | `shell-snapshots/`, `history.jsonl`, …                                                          | ❌ global or run-scoped, not part of a session                                                                                                                    |

`encoded-cwd` = the absolute path with every non-alphanumeric character replaced
by `-` (`/path/to/my-project` → `-path-to-my-project`). This is lossy and cannot
be decoded, so the real path is recovered from the `~/.claude.json` key (and the
transcript only when consistent with the folder).

### Codex (`~/.codex`)

| Resource               | Path                                                                                                                           | Migrated?                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Transcript ("rollout") | `sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl` (date+uuid-keyed, **not** cwd-keyed; cwd lives inside the `session_meta` line) | ✅                                                                           |
| Project trust          | `config.toml` → `[projects."<abs-cwd>"]` (`trust_level`)                                                                       | ✅                                                                           |
| Credentials            | `auth.json`                                                                                                                    | ❌ per-machine secret — **never transported**; re-authenticate on the target |
| Global stores          | `history.jsonl`, `state_*.sqlite`, `logs_*.sqlite`, `memories/`                                                                | ❌ global, not session-scoped                                                |

Because Codex rollouts are date-keyed rather than cwd-keyed, a same-machine
`move` does **not** relocate the transcript — it only re-keys the `[projects]`
trust entry. `import` places the rollout at its date-bucketed path on the target
and re-keys trust to the new cwd.

If a resource is intentionally not migrated, the table says so and why — nothing
is silently dropped.

## Cross-machine notes

`import` recomputes the destination for wherever the project lives on the target
machine. Be aware that:

- MCP servers, hooks, and CLI tools the session references must also exist
  there.
- Authentication is per-machine — credentials are **not** transported.
- Absolute paths baked into conversation history are not rewritten.

## Architecture

Pure core, thin shell, harness abstraction. A `Harness` (Claude Code, Codex)
encapsulates session discovery, cwd resolution, the sidecar set, and path logic;
the CLI and a small generic migrate layer drive them. The pure functions
(`encodeCwd`, path computation, session discovery, config extract/rewrite,
manifest build/verify, bundle pack/unpack, Codex TOML editing) are unit-tested
against synthetic fake `$HOME` roots — no real agent state in tests.

The official Claude Agent SDK is **not** bundled in the shipped binary (it pulls
a large transitive dependency tree just to list sessions). It is a dev-only test
oracle: a test asserts that `transplant`'s own Claude listing agrees with the
SDK's `listSessions` on synthetic fixtures.

## Development

```sh
deno task test     # run the suite
deno lint
deno fmt
deno task compile  # build ./transplant
```

All fixtures are synthetic; no real Claude or Codex state is used in tests.

## License

[MIT](./LICENSE)
