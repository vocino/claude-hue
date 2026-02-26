# Claude Usage for Philips Hue

**See your Claude.ai usage at a glance** — your Philips Hue light changes color (e.g., green → red) as you approach your limits. A little fun tool by [@Vocino](https://www.threads.com/@vocino).

For example:
- **Green** = plenty of usage left
- **Yellow** = getting close
- **Red** = near or at limit

---

## What you need

- **Node.js** 18+
- **Philips Hue bridge** on your network
- **One Philips Hue color light** (any color-capable bulb)
- **Claude Pro or Claude Free** account (claude.ai)

---

## Quick start

### 1. Install

```bash
npm install -g claude-hue
```

Or build from source:

```bash
git clone https://github.com/vocino/claude-hue.git
cd claude-hue
npm install
npm run build
```

### 2. Run setup

```bash
claude-hue setup
```

You'll be guided through:

- Finding your Hue bridge
- Pressing the link button on the bridge
- Choosing which light to use
- Picking a color gradient: presets (green→red, blue→red, etc.) or **custom hex codes** (e.g. `#40a02b` → `#d20f39`)

### 3. Get real usage data (pick one)

For the light to show **actual** Claude usage (not just prompt counting), use one of these:

| Option | Easiest for | What to do |
|--------|-------------|------------|
| **Claude Code OAuth** | Anyone using Claude Code | Run `claude login` once. No other setup. |
| **Browser extension** | Chrome users | Load the `extension/` folder in Chrome → Extensions → Load unpacked. Stay logged into claude.ai. |
| **Cookie auth** | No extension, no Claude Code | Run `claude-hue auth` and paste your cookie from DevTools. |

### 4. Start the daemon

```bash
claude-hue start
```

Your light will now update based on your usage. Keep this terminal open (or run it in the background).

---

## Commands

| Command | Description |
|---------|-------------|
| `claude-hue setup` | Configure bridge, light, and colors |
| `claude-hue start` | Start the daemon (updates the light) |
| `claude-hue stop` | Stop the daemon |
| `claude-hue status` | Show current usage and mode |
| `claude-hue demo` | Cycle light through colors to verify it works |
| `claude-hue auth` | Set claude.ai cookie for real usage |
| `claude-hue reset` | Clear the usage log |
| `claude-hue hook install` | Install Claude Code hook (fallback prompt counting) |
| `claude-hue hook uninstall` | Remove the hook |

---

## Usage modes explained

The daemon gets usage data in this order:

1. **Claude Code OAuth** — If you've run `claude login`, it reads your token and fetches usage from Anthropic's API. Zero config.
2. **Browser extension** — If installed, the extension fetches usage from claude.ai (using your logged-in session) and sends it to the daemon every minute.
3. **Cookie** — If you ran `claude-hue auth`, the daemon polls claude.ai with your cookie. May be blocked by Cloudflare on some setups.
4. **Local prompt counting** — Fallback: counts prompts from the Claude Code hook. Rough estimate, not real usage.

For the best experience, use OAuth or the extension.

The light shows your **current session** (5-hour rolling window) — when that resets, the light goes back to green. Weekly limits don't affect the light.

---

## Custom colors

During setup, choose **Custom (enter hex codes)** to pick your own gradient. Enter two hex colors:

- **Start color** (low usage): e.g. `#40a02b`
- **End color** (high usage): e.g. `#d20f39`

Both 3-digit (`#f00`) and 6-digit (`#ff0000`) hex are supported.

---

## Browser extension setup

1. Open Chrome and go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension` folder (in the project if you cloned; if you used npm, run `npm root -g` and go to `claude-hue/extension` inside that path)
5. Make sure you're logged into [claude.ai](https://claude.ai)
6. Start the daemon with `claude-hue start`

The extension will fetch your usage and push it to the daemon. Click the extension icon to see current usage.

---

## Cookie auth (manual)

If you don't use the extension or Claude Code:

1. Go to [claude.ai/settings/usage](https://claude.ai/settings/usage) and log in
2. Open DevTools (F12) → **Network** tab
3. Refresh the page
4. Click any request to claude.ai (e.g. `usage`)
5. In **Request Headers**, find **Cookie**
6. Right-click the Cookie value → **Copy value**
7. Run `claude-hue auth` and paste when prompted

Copy the **full** cookie string (starts with `anthropic-device-id=...`) for best results.

---

## Troubleshooting

**Light doesn't change / hard to tell if it's working**
- Run `claude-hue demo` — cycles the light through green → yellow → red so you can verify the light responds
- Run `claude-hue status` — shows which mode is active and current usage
- Ensure the daemon is running (`claude-hue start`)
- On startup, the daemon prints `Usage source: oauth` (real usage) or `Usage source: local` (prompt counting)

**"Local prompt counting" but I want real usage**
- Run `claude login` (if you use Claude Code), or
- Install the browser extension and stay logged into claude.ai, or
- Run `claude-hue auth` and paste your cookie

**Setup can't find my bridge**
- Ensure the bridge and computer are on the same network
- Try entering the bridge IP manually when setup asks

**Link button error**
- Press the physical link button on the Hue bridge
- Wait a few seconds, then press Enter in the terminal

---

## Config & data

All runtime data lives in `~/.claude-hue/`:

- `config.json` — Bridge IP, API key, light ID, colors, limits
- `usage.log` — Timestamps from the Claude Code hook (fallback mode)
- `daemon.pid` — PID of the running daemon

---

## Development

```bash
npm run build        # Compile TypeScript to dist/
npm run dev          # Watch mode compilation
npm test             # Run tests
npm run test:watch   # Watch mode tests
```

**Project structure:** The **hook** (`src/hook/`) appends timestamps for fallback counting. The **daemon** (`src/daemon/`) accepts usage from OAuth, extension, or cookie; interpolates color; and updates the light. The **CLI** (`src/index.ts`) uses Commander for setup, auth, start, stop, etc.

**Conventions:** ESM throughout. Hue API calls use `hueFetch()` from `src/hue/fetch.ts` for self-signed TLS. Colors use CIE xy (not RGB). The hook stays minimal (sync only, no config).

---

## License

MIT
