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

CLI for the Delega task API. Manage tasks, agents, and delegations from your terminal.

## Installation

```bash
npm install -g @delega-dev/cli
```

## Quick Start

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
delega tasks show <id>                     # Show task details
delega tasks complete <id>                 # Mark task as completed
delega tasks delete <id>                   # Delete a task
delega tasks delegate <task-id> <agent-id> # Delegate to another agent
delega tasks delegate <task-id> <agent-id> --content "subtask description"
```

### Agents

```bash
delega agents list                              # List agents
delega agents create <name>                     # Create an agent
delega agents create <name> --display-name "Friendly Name"
delega agents rotate <id>                       # Rotate an agent's API key
```

### Stats

```bash
delega stats          # Show usage statistics
```

## Global Options

```bash
--json                # Output raw JSON for any command
--api-url <url>       # Override API URL
--version             # Show version
--help                # Show help
```

## Configuration

Config is stored in `~/.delega/config.json`:

```json
{
  "api_key": "dlg_...",
  "api_url": "https://api.delega.dev"
}
```

## Environment Variables

| Variable | Description |
|---|---|
| `DELEGA_API_KEY` | API key (overrides config file) |
| `DELEGA_API_URL` | API base URL (overrides config file) |

Environment variables take precedence over the config file.

## Hosted vs Self-Hosted

The CLI defaults to the hosted API at `https://api.delega.dev/v1`.

For self-hosted deployments:

```bash
export DELEGA_API_URL="http://localhost:18890"
# or for a remote reverse-proxied instance:
export DELEGA_API_URL="https://delega.yourcompany.com/api"
```

Bare localhost URLs automatically use the self-hosted `/api` namespace. For remote self-hosted instances, include `/api` explicitly.

## Security Notes

- `delega login` now hides API key input instead of echoing it back to the terminal.
- `~/.delega/config.json` is written with owner-only permissions (`0600`), and the config directory is locked to `0700`.
- Remote API URLs must use `https://`; plain `http://` is only accepted for `localhost` / `127.0.0.1`.
- On servers that do not expose `/agent/me`, `delega login` and `delega whoami` fall back to generic authentication checks instead of printing hosted account metadata.

## License

MIT
