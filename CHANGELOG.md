# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.6.0] - 2026-06-10

### Added
- `delega github connect` — start the self-serve GitHub App install flow:
  opens the GitHub install page tied to your account via a one-time link, then
  the repos you select are auto-linked as verified bindings (no manual
  installation id). `--no-open` prints the URL instead; `--json` for scripting.

## [1.5.1] - 2026-06-10

### Fixed
- `delega sync` now reports a clear `Line N is invalid JSON in
  .delega/tasks.jsonl` error instead of crashing with a raw stack trace when
  the mirror file has been hand-edited into malformed JSON.

## [1.5.0] - 2026-06-10

### Added
- `delega sync init|pull|push|status` — mirror hosted Delega tasks into
  `.delega/tasks.jsonl` inside a Git repo, with deterministic JSONL output,
  repo/branch/commit auto-linking on push, and explicit CAS conflicts when
  hosted context changed after the local mirror was pulled

## [1.4.0] - 2026-06-10

### Added
- `delega tasks state <task_id> <state> [-m <detail>]` — report a session
  state (`working`, `waiting_input`, `errored`) on a task you have claimed
  (POST /tasks/:id/state) without extending the lease
- `delega tasks list` shows a State column; `--state <state>` filters by
  session state (GET /tasks?state=)
- `delega tasks show` displays the session state (with detail) and the
  accountable agent when present

## [1.3.0] - 2026-06-10

### Added
- `delega tasks claim [--project <id>] [--labels "a,b"] [--lease <seconds>]` — atomically claim the next claimable task (POST /tasks/claim), ordered by priority then age; prints "No tasks available to claim." when the queue is empty
- `delega tasks heartbeat <task_id> [--lease <seconds>]` — extend the lease on a claimed task (POST /tasks/:id/heartbeat); 409 if you don't hold an active claim
- `delega tasks release <task_id>` — release a claimed task back to the queue (POST /tasks/:id/release); holder or admin only
- `delega tasks list --claimed` / `--unclaimed` — filter by claim state (GET /tasks?claimed=)
- Task claim fields (`claimed_by_agent_id`, `claimed_at`, `lease_expires_at`) on the Task model, and a `claimed` status badge in task output

## [1.2.1] - 2026-04-14

### Fixed
- `delega tasks show` now parses and pretty-prints the `context` field when present (hosted returns a JSON-encoded string; self-hosted returns a dict — both render as an indented JSON block now)
- `delega tasks show` surfaces `root_task_id` + `delegation_depth` when the task is part of a delegation chain

### Added
- Accept `DELEGA_AGENT_KEY` as a fallback env var for `DELEGA_API_KEY` — cross-client consistency with the @delega-dev/mcp package, which uses `DELEGA_AGENT_KEY` as its primary. Agents can now set one env var for both tools.

## [1.2.0] - 2026-04-14

### Added
- `delega tasks assign <task_id> <agent_id | --unassign>` — assign/unassign a task (PUT /tasks/:id with `assigned_to_agent_id`)
- `delega tasks chain <task_id>` — show the full parent/child delegation chain, indented by depth
- `delega tasks set-context <task_id> --kv key=value...` (or `--context '{...}'`) — deep-merge keys into a task's persistent context blob (PATCH /tasks/:id/context)
- `delega tasks dedup --content "..." [--threshold 0.6]` — TF-IDF + cosine similarity check against open tasks (POST /tasks/dedup); call before `delega tasks create` to avoid redundant work
- `delega agents delete <id>` — delete an agent (`--yes` for scripts, `--dry-run` for preview). API refuses if the agent has active tasks, is the recovery agent, is the last active, or is the caller
- `delega usage` — plan quota + rate-limit info (hosted API only; gated client-side with a clear error on self-hosted)

## [1.1.5] - 2026-03-28

### Added
- `delega status` command for connection diagnostics
- `delega reset` command to wipe local config and credentials
- `--version` / `-v` flag reads version from package.json
- `delega init --help` shows usage info without running the wizard
- Delegation chain columns in `delega tasks list`
- CHANGELOG.md

### Fixed
- Docker image tag pinned to CLI version instead of hardcoded `1.0.0`
- Improved error messages across all commands
- Shared API helper requests now time out after 15 seconds instead of hanging indefinitely
- Hosted signup validates email format before calling the API
- `delega status` now uses a single 15-second timeout budget across health and authenticated probes

## [1.0.10] - 2026-03-22

### Added
- MCP client selector in `delega init` (Claude Code, Claude Desktop, Cursor, Windsurf, VS Code, Continue, Codex, OpenClaw)

### Fixed
- Codex MCP config outputs correct TOML format
- VS Code MCP config includes required `type: "stdio"` field

## [1.0.9] - 2026-03-22

### Fixed
- `delega init` MCP config outputs `DELEGA_AGENT_KEY` (not `DELEGA_API_KEY`)

## [1.0.8] - 2026-03-17

### Changed
- Documentation features `delega init` as the primary onboarding path

## [1.0.7] and earlier

See [git history](https://github.com/delega-dev/delega-cli/commits/main) for changes prior to 1.0.8.
