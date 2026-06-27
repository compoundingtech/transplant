# transplant

A small CLI to migrate [Claude Code](https://claude.com/claude-code) sessions
between working directories — and between machines — without losing conversation
history.

## Why

Claude Code stores each session transcript at
`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`, keyed by the **working
directory**. The encoded form is the absolute path with every non-alphanumeric
character replaced by `-` (so `/path/to/my-project` becomes
`-path-to-my-project`; dots and slashes both become `-`).

Because the lookup is keyed by cwd, renaming or moving a project means
`claude --resume` looks under the new directory's folder, finds nothing, and the
history appears lost. `transplant` relocates the transcript (and its sidecars) to
wherever the project now lives — on this machine or another.

## Install

Requires [Deno](https://deno.com/) 2.x.

Run from source:

```sh
deno run -A main.ts <command>
```

Or build a single binary:

```sh
deno task compile      # produces ./transplant
./transplant --help
```

## Commands

```
transplant ls                                   # list local sessions
transplant move <session-id> --to <dir>         # same machine, dir -> dir
transplant pack <session-id> -o <bundle.tar>    # bundle for transport
transplant import <bundle.tar> --to <dir>       # reconstruct on this machine
```

`--to` / `--from` take absolute project directory paths. `--from` is only needed
when the source directory can't be auto-detected (see
[Resolving the source directory](#resolving-the-source-directory)).

Both `move` and `import` accept `--fork-session`, which assigns a fresh
session-id in the destination so two directories never point at one transcript
file.

### Examples

Move a session after you renamed its project folder:

```sh
transplant move 1a2b3c4d-... --to /Users/me/code/renamed-project
```

Carry a session to another machine:

```sh
# on the source machine
transplant pack 1a2b3c4d-... -o session.tar
scp session.tar other-machine:~

# on the target machine (path may differ here)
transplant import ~/session.tar --to /home/me/work/project
```

## What a session actually consists of

1. **`<session-id>.jsonl`** — the transcript (the history). `transplant` treats
   it as an **opaque blob** and never parses it for migration: the format is
   internal to Claude Code and changes between releases. (`ls` does a tolerant,
   best-effort peek for a one-line summary; it degrades silently and never
   affects a move.)
2. **`memory/`** — a sibling folder in the same project dir, if the session uses
   memory. Also cwd-keyed; moves with the transcript.
3. **`~/.claude.json` project entry** — keyed by the absolute cwd; carries trust
   acceptance, tool permissions, MCP enablement, and `lastSessionId`. Migrating
   it avoids re-prompts on first launch.

A packed bundle is a tar containing `manifest.json` (original absolute cwd,
session id, Claude version), `transcript.jsonl`, the relevant `project-config.json`
subset, and any `memory/` files.

## Resolving the source directory

The encoded folder name is **lossy** and cannot be decoded back to a real path.
To migrate the `~/.claude.json` entry, `transplant` recovers the directory a
session is currently keyed under by matching the encoded folder against your
`~/.claude.json` project keys (the transcript's own embedded path is used only
when it's consistent with the folder, since it goes stale after a move). If
neither is available, pass `--from <dir>` explicitly.

## Cross-machine notes

`import` recomputes the encoded-cwd for wherever the project lives on the target
machine. Be aware that:

- MCP servers, hooks, and CLI tools the session references must also exist on the
  target machine.
- Authentication is per-machine — credentials are **not** transported. Sign in
  again on the new machine.
- Absolute paths baked into the conversation history are not rewritten; old
  references may not resolve if the project lives at a different path.

## Architecture

Pure core, thin shell. The logic — `encodeCwd`, path computation, session
discovery, manifest build/verify, project-config extract/rewrite, and bundle
pack/unpack — lives in pure functions under `src/core/`, unit-tested against a
synthetic fake `$HOME/.claude` root. The CLI in `src/cli.ts` only parses
arguments and performs I/O.

The official Claude Agent SDK is **not** bundled in the shipped binary (it pulls
a large transitive dependency tree just to list sessions). Instead it is a
dev-only dependency used as a test oracle: a test asserts that `transplant`'s own
session listing agrees with the SDK's `listSessions` on synthetic fixtures.

## Development

```sh
deno task test     # run the suite
deno lint
deno fmt
deno task compile  # build ./transplant
```

All fixtures are synthetic; no real Claude state is used in tests.

## License

[MIT](./LICENSE)
