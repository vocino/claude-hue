# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Does

claude-hue is a CLI tool that visualizes Claude usage on a Philips Hue light. It gradually shifts a light's color (e.g., green → red) based on usage. Three data sources (best first):

1. **Claude Code OAuth** (zero config) — If you've run `claude login`, the daemon reads credentials from `~/.claude/.credentials.json` (Windows/Linux) and calls `api.anthropic.com/api/oauth/usage`. No cookie, no extension. Same approach as MeterBar.
2. **Browser extension** — Chrome extension fetches usage from claude.ai using the browser's cookies and pushes to the daemon. No cookie copying.
3. **Cookie API** — `claude-hue auth` saves cookie; daemon polls claude.ai when OAuth/extension data is stale. May be blocked by Cloudflare from Node.
4. **Local prompt counting** (fallback) — Claude Code `UserPromptSubmit` hook logs timestamps; daemon counts prompts in a rolling window.

## Commands

- `npm run build` — Compile TypeScript to `dist/`
- `npm run dev` — Watch mode compilation
- `npm test` — Run tests (`vitest run`)
- `npm run test:watch` — Watch mode tests
- `node dist/index.js <command>` — Run the CLI locally

## Architecture

Three components work together:

1. **Hook** (`src/hook/log-prompt.ts`) — Minimal script registered as a Claude Code `UserPromptSubmit` hook. Appends an ISO timestamp to `~/.claude-hue/usage.log`. Must stay fast and synchronous (uses `appendFileSync`).

2. **Daemon** (`src/daemon/daemon.ts`) — Long-running process. Accepts usage from extension (HTTP POST) or polls Claude API when cookie configured; falls back to local prompt counting. Interpolates CIE xy color and PUTs to Hue bridge API. Manages PID file at `~/.claude-hue/daemon.pid`.

3. **CLI** (`src/index.ts`) — Commander-based entry point with subcommands: `setup`, `auth`, `start`, `stop`, `status`, `reset`, `hook install`, `hook uninstall`.

### Key Modules

- `src/hue/color.ts` — CIE xy color presets and linear interpolation. The Hue bridge clips colors to the bulb's gamut automatically.
- `src/hue/fetch.ts` — Wrapper for `fetch` that disables TLS cert verification (Hue bridges use self-signed certs on the local network).
- `src/hue/bridge.ts` — Bridge discovery (via `discovery.meethue.com`), user creation (link button pairing), light enumeration.
- `src/hue/light.ts` — Sets light state (color, brightness, transition time) and flashes lights for identification.
- `src/daemon/usage.ts` — Reads the timestamp log, filters to rolling window, calculates usage percentage, trims old entries.
- `src/config/config.ts` — Loads/saves `~/.claude-hue/config.json`. All runtime state lives under `~/.claude-hue/`.
- `src/cli/install-hook.ts` — Reads/merges `~/.claude/settings.json` to register/unregister the hook. Must preserve existing hooks and settings.
- `src/claude/api.ts` — Fetches usage from claude.ai's internal API. Org ID: lastActiveOrg cookie → /api/bootstrap → /api/organizations. Parses `utilization`, `percentUsed`, etc. Handles `five_hour`, `seven_day`, `seven_day_sonnet` response format.

### Config Location

All user data lives in `~/.claude-hue/`:
- `config.json` — Bridge IP, API key, light ID, colors, limits, daemon settings, optional `claude.sessionKey` and `claude.orgId`
- `usage.log` — One ISO timestamp per line, appended by the hook
- `daemon.pid` — PID of running daemon process

## Conventions

- ESM throughout (`"type": "module"` in package.json, `.js` extensions in imports)
- Hue bridge API calls go through `hueFetch()` from `src/hue/fetch.ts` to handle self-signed TLS certs
- Colors use CIE xy color space (not RGB or HSB) for hardware-independent accuracy
- The hook script must remain minimal — no async operations, no config loading, just append and exit
- The `sessionKey` from claude.ai expires after ~8 hours; the daemon gracefully falls back to local counting after 3 consecutive API failures
- The `/api/organizations/{orgId}/usage` endpoint is unofficial and may change — the response parser handles multiple possible field names defensively
