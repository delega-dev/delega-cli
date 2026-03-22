# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
