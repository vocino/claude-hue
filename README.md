# claude-hue

**See your Claude Code usage at a glance** — your Philips Hue light glows green → red as you approach limits.

![claude-hue](https://img.shields.io/badge/Hue-green→red-00CCFF?style=flat-square&labelColor=161B22)
[![npm version](https://img.shields.io/npm/v/claude-hue?style=flat-square&labelColor=161B22)](https://www.npmjs.com/package/claude-hue)
[![License: MIT](https://img.shields.io/badge/License-MIT-3DFA9A?style=flat-square&labelColor=161B22)](https://opensource.org/licenses/MIT)

A simple ambient display for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) users. No cookies, no browser extension, no prompt counting — just `claude login` and OAuth.

> **v2.0 breaking change:** OAuth-only. Handles 2026 Max subscription tiers — 5h session, weekly, monthly credit pool, harness/tool limits. Fixes 429 rate-limit spam from old poller.

## What it shows

- **Green** = plenty left
- **Yellow** = getting close
- **Red** = near limit

Your light tracks the **5-hour session** (most dynamic). `status` shows all limits: 5h, weekly, monthly, harness.

## Requirements

- Node 18+
- Philips Hue Bridge + 1 color bulb (same LAN)
- Claude Pro or Max with `claude login` (Claude Code CLI OAuth)

## Quickstart (3 steps)

```bash
npm i -g claude-hue
claude-hue setup   # finds bridge, pick light, pick colors (3 questions)
claude-hue start   # polls OAuth usage every 5m (429-safe), updates light
```

That's it. Requires you've run `claude login` once in Claude Code (creates `~/.claude/.credentials.json`).

## Commands

| Command | Description |
|---------|-------------|
| `claude-hue setup` | Pair bridge + choose light + colors |
| `claude-hue start` | Start daemon (polls usage, updates light) |
| `claude-hue stop` | Stop daemon |
| `claude-hue status` | Show bridge, light, OAuth, all limits sorted + primary |
| `claude-hue demo` | Cycle green→yellow→red to test light |

No `auth` or `hook` subcommands in v2 — OAuth only.

## How it works

Daemon reads OAuth token from `~/.claude/.credentials.json` (created by `claude login`), fetches `https://api.anthropic.com/api/oauth/usage` with `Bearer` + `anthropic-beta: oauth-2025-04-20`, parses generic response tolerating:

- `five_hour` / `session` / `claude_code` / `5h` → primary for light (2025-2026 rolling)
- `seven_day` / `weekly` / `7d`
- `monthly` / `credit` / `allowance` — new June 2026 non-interactive pool for Agent SDK / `claude -p` ($20 Pro, $100 Max 5x, $200 Max 20x)
- `harness` / `tool` — tool-call budget
- `extra` / `overage` — ignored for primary unless alone

Generic parser handles both shapes:

- Object map `{ five_hour: { utilization: 68, resets_at: ... }, seven_day: ... }` (old)
- Wrapped `{ limits: [ { type: "five_hour", utilization: 68 }, ... ] }` (mid-2026 change, e-paper gist)
- Array shape

Primary logic: session → weekly → monthly → harness → highest non-extra.

Poll interval 5m default + ±30s jitter to avoid thundering herd. On 429 (see https://github.com/anthropics/claude-code/issues/31021 + #30930), respects `Retry-After` header, exponential backoff to 5 min, keeps last color. No spam.

Config in `~/.claude-hue/config.json`, PID in `daemon.pid`. Token re-read each poll so Claude Code auto-refresh works.

## Colors

During `setup` pick preset (green→red, green→orange, blue→red, blue→purple) or custom hex (`#40a02b` → `#d20f39`) → converted to CIE xy.

## Why v2 simplifies

Old v1 had 3 auth paths:

- Cookie scraping `claude.ai/api/organizations/*/usage` — needed orgId extraction via `lastActiveOrg` cookie → `/api/bootstrap` → `/api/organizations`, Cloudflare evasion, User-Agent spoof → broke every 2 months
- Browser extension HTTP server on 7684 (`extension/background.js` polling with `credentials: include`, POST to localhost)
- Hook prompt counting (`src/hook/log-prompt.ts` appending timestamps to `~/.claude-hue/usage.log`, file watcher in daemon)

v2 deletes all that — OAuth Bearer works, no Cloudflare, no extension install, 9 source files ~300 LOC vs 17 files 650 LOC (-55%).

## Troubleshooting

- **Light not changing?** `claude-hue demo` → `claude-hue status` → `claude login`
- **No OAuth token?** Run `claude login` in Claude Code CLI, not claude.ai. Check `ls ~/.claude/.credentials.json`
- **Bridge not found?** Same LAN? Enter IP manually in setup (find via Hue app → Bridge → IP)
- **Link button error?** Press physical button on bridge, wait 3s, Enter — 3 attempts
- **429 errors?** Daemon backs off automatically. Anthropic rate-limits `/api/oauth/usage` aggressively after Apr 2026 block of third-party tools. If persistent, increase `daemon.pollIntervalMs` in `~/.claude-hue/config.json` (e.g. 600000 = 10m). See https://github.com/anthropics/claude-code/issues/31021
- **Token after 401?** `claude login` again

## Migration v1 → v2

- `extension/` removed — uninstall Chrome extension manually if installed (harmless if left)
- `claude-hue auth` removed — error says "removed in v2, use `claude login`"
- `claude-hue hook install/uninstall` removed
- Old config with `usage` or `claude` keys still loads (extra keys ignored) — or re-run `setup`
- `~/.claude-hue/usage.log` no longer used — safe to delete

## Dev

```bash
git clone https://github.com/vocino/claude-hue.git
cd claude-hue
npm install
npm test        # 23 tests: color interpolation + oauth parser for 2026 tiers
npm run build
```

Built by [@Vocino](https://vocino.com) — part of [vocino.com](https://vocino.com) ecosystem.
