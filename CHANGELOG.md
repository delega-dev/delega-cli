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

## [1.0.10] - 2026-03-18

### Changed
- Version bump (no functional changes)

## [1.0.9] - 2026-03-18

### Added
- MCP client selector in `delega init` (Claude, Cursor, Windsurf, VS Code, Continue, Codex, OpenClaw)

## [1.0.8] - 2026-03-17

### Fixed
- `delega init` MCP config outputs `DELEGA_AGENT_KEY` (not `DELEGA_API_KEY`)

### Changed
- Documentation features `delega init` as the primary onboarding path

## [1.0.7] and earlier

See [git history](https://github.com/delega-dev/delega-cli/commits/main) for changes prior to 1.0.8.
