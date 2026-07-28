```
     ____       __
    / __ \___  / /__  ____ _____ _
   / / / / _ \/ / _ \/ __ `/ __ `/
  / /_/ /  __/ /  __/ /_/ / /_/ /
 /_____/\___/_/\___/\__, /\__,_/
                   /____/
  Task infrastructure for AI agents
```

# delega-cli

> **Maintenance status:** Delega’s public hosted service retired on July 28, 2026. This CLI remains public as a verifiable engineering artifact and for Ryan McMillan’s existing private deployment. New public accounts and hosted access are not available. See the [case study](https://ryanmcmillan.com/delega).

CLI for the Delega task API. Manage tasks, agents, and delegations from your terminal.

## Installation

```bash
npm install -g @delega-dev/cli
```

## Existing owner credentials

```bash
# Authenticate with your API key
delega login

# Create a task
delega tasks create "Review pull request #42" --priority 1

# List your tasks
delega tasks list

# Complete a task
delega tasks complete <task-id>
```

## Commands

### Historical setup command

```bash
delega init           # Historical flow; hosted signup now returns 410
```

### Authentication

```bash
delega login          # Authenticate with your API key
delega whoami         # Show current authenticated agent
```

### Tasks

```bash
delega tasks list                          # List tasks
delega tasks list --completed              # Include completed tasks
delega tasks list --limit 10               # Limit results
delega tasks create "content"              # Create a task
delega tasks create "content" --priority 1 # Create with priority (1-4)
delega tasks create "content" --labels "bug,urgent"
delega tasks create "content" --due "2026-03-15"
delega tasks show <id>                     # Show task details (incl. context + comments)
delega tasks complete <id>                 # Mark task as completed
delega tasks delete <id>                   # Delete a task
delega tasks assign <task-id> <agent-id>   # Assign a task (no delegation chain)
delega tasks delegate <task-id> <agent-id> --content "subtask description"
delega tasks chain <id>                    # Show the parent/child delegation chain
delega tasks set-context <id> --context '{"k":"v"}'
delega tasks set-context <id> --kv k=v     # Merge keys into the task context blob
delega tasks dedup --content "proposed content"
delega tasks claim                         # Atomically claim the next available task
delega tasks claim --project <id> --labels "backend,bug" --lease 600
delega tasks heartbeat <id>                # Extend the lease on a claimed task
delega tasks heartbeat <id> --lease 600    # Extend with a custom lease (30-3600s)
delega tasks release <id>                  # Release a claimed task back to the queue
delega tasks state <id> waiting_input      # Report session state on a claimed task
```

### Connect GitHub

```bash
delega github connect                       # Open GitHub's install page; auto-links selected repos
delega github connect --no-open             # Print the install URL instead of opening a browser
```

Links repositories via the hosted GitHub App so commits/PRs that mention a task
(`delega:#<task-id>`, or `Closes-Delega: #<task-id>` to complete on merge) link
back to it. The repos you select are registered automatically — no installation
IDs to copy.

### Repo Sync

```bash
delega sync init --repo owner/name          # Create .delega/config.json + tasks.jsonl
delega sync pull                            # Pull hosted tasks into .delega/tasks.jsonl
delega sync status                          # Show local vs hosted drift
delega sync push                            # Push local JSONL edits with CAS conflict checks
delega sync push --no-auto-link             # Disable branch/HEAD auto-linking
```

### Recurring Tasks

```bash
delega recurring list
delega recurring create "Replace furnace filter" --rule monthly --anchor-day 1 --timezone America/Chicago
delega recurring create "Schedule review" --rule weekly --anchor-weekday 1 --interval 2
delega recurring update <id> --inactive
delega recurring update <id> --active --next-due-at 2026-07-01T14:00:00Z
delega recurring delete <id> --yes
```

Recurring rules support `daily`, `weekly`, `monthly`, and `yearly`. Use `--no-skip-if-open` on create, or `--allow-overlap` on update, when a template should spawn even if an earlier instance is still open.

### Agents

```bash
delega agents list                              # List agents
delega agents create <name>                     # Create an agent
delega agents create <name> --display-name "Friendly Name"
delega agents create <name> --role coordinator  # Create with role: worker, coordinator, admin
delega agents rotate <id>                       # Rotate an agent's API key (admin key required)
delega agents role <id> coordinator             # Set role: worker, coordinator, admin (admin key required)
delega agents delete <id>                       # Delete an agent (admin key required)
```

Roles: `worker` (own-task scope, default), `coordinator` (sees + can comment on all account tasks), `admin` (full account management).

### Diagnostics & Account

```bash
delega status         # Connection check, agent info, task counts
delega stats          # Show usage statistics
delega usage          # Plan quota and rate-limit info
delega reset          # Clear stored credentials and config
```

## Global Options

```bash
--api-url <url>       # Override API URL
--version             # Show version
--help                # Show help
```

Many resource commands also support `--json` for raw JSON output; check
`delega <command> --help` for command-specific flags.

## Configuration

Non-secret CLI settings are stored in `~/.delega/config.json`:

```json
{
  "api_url": "https://api.delega.dev"
}
```

`delega login` stores API keys in the OS credential store when one is available:

- macOS: Keychain
- Linux: libsecret keyring via `secret-tool`
- Windows: DPAPI-protected user storage

Existing `api_key` entries in `~/.delega/config.json` are still read for backward compatibility until the next successful `delega login`.

## Environment Variables

| Variable | Description |
|---|---|
| `DELEGA_API_KEY` | API key (overrides secure storage and config) |
| `DELEGA_AGENT_KEY` | Fallback API key for MCP/CLI shared environments |
| `DELEGA_API_URL` | API base URL (overrides config file) |

Environment variables take precedence over the config file.

## Custom API Endpoints

The CLI defaults to the Delega API at `https://api.delega.dev/v1`. To target a custom endpoint (advanced), set `DELEGA_API_URL`. Bare localhost URLs automatically use the `/api` namespace; remote custom endpoints should include `/api` explicitly.

## Security Notes

- `delega login` now hides API key input instead of echoing it back to the terminal.
- `delega login` stores API keys in the OS credential store instead of plaintext config when secure storage is available.
- `~/.delega/config.json` is written with owner-only permissions (`0600`), and the config directory is locked to `0700`.
- Remote API URLs must use `https://`; plain `http://` is only accepted for `localhost` / `127.0.0.1`.
- On servers that do not expose `/agent/me`, `delega login` and `delega whoami` fall back to generic authentication checks instead of printing hosted account metadata.

## License

MIT
