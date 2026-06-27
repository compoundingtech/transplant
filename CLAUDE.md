# transplant

A small CLI to migrate Claude Code sessions between working directories — and
between machines — without losing conversation history.

## Why

Claude Code stores each session transcript at
`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`, keyed by the **working
directory** (absolute path with every non-alphanumeric char replaced by `-`).
Rename or move a project and `claude --resume` looks under the new cwd's folder,
finds nothing, and the history appears lost. `transplant` moves the transcript
(and its sidecars) to wherever the project now lives, on this machine or
another.

## Commands (target shape)

```
transplant ls                                   # list local sessions
transplant move <session-id> --to <dir>         # same machine, dir -> dir
transplant pack <session-id> -o <bundle.tar>    # bundle for transport
transplant import <bundle.tar> --to <dir>       # reconstruct on this machine
```

`move`/`import` support `--fork-session` (fresh session-id in the destination so
two dirs never point at one transcript file).

## What a session actually consists of

1. **`<session-id>.jsonl`** — the transcript (the history). Treated as an opaque
   blob; never parsed (the format is internal to Claude Code and changes between
   releases).
2. **`memory/`** — sibling folder in the same project dir, if the session uses
   memory. Also cwd-keyed; moves with the transcript.
3. **`~/.claude.json` project entry** — keyed by the absolute cwd path; carries
   trust acceptance, tool permissions, MCP enablement, and `lastSessionId`.
   Optional for history, but migrating it avoids re-prompts on first launch.

## Engineering conventions

- **Runtime: Deno.** Single-binary `deno compile`; `deno test`/`fmt`/`lint`.
- **Pure core, thin shell.** Keep the logic in pure functions —
  `encodeCwd(path)`, sidecar discovery, manifest build, project-config
  extract/rewrite — and test them against a fake `$HOME/.claude` root with
  synthetic fixtures. No real Claude state in tests.
- **Zero failing tests, ever.** Tests pass before anything is presented as done.
- The official Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) provides
  `migrateSession` / `listSessions` / `getSessionMessages` for the same-machine
  case; prefer it over hand-editing files where it fits.

## Cardinal rule: no PII in the repo

This is a public repository. **Never commit real session data, real filesystem
paths, real usernames, real session UUIDs, or machine names.** All fixtures are
synthetic. Scan the diff for PII before every push.
