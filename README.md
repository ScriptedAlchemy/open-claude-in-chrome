# Open Claude in Chrome

**Claude in Chrome, fully open source. No domain blocklist. Any Chromium browser.**

The official [Claude in Chrome](https://code.claude.com/docs/en/chrome) extension gives Claude Code full browser automation. Open Claude in Chrome is a clean-room reimplementation that removes the restrictions while maintaining 100% feature and performance parity.

[![Demo](https://img.youtube.com/vi/n4-2fjOsGhw/maxresdefault.jpg)](https://youtu.be/n4-2fjOsGhw)

> **Demo:** [Watch Claude on Tinder, Reddit, and Robinhood](https://youtu.be/n4-2fjOsGhw) | **Deep dive:** [How I reverse-engineered it](https://www.noemica.io/blog/reverse-engineered-claude-in-chrome)

## What's Different

| | Claude in Chrome | Open Claude in Chrome |
|---|---|---|
| **Domain blocklist** | 58 blocked domains across 11 categories | No blocklist. Navigate anywhere. |
| **Browser support** | Chrome and Edge only | Any Chromium browser (Chrome, Edge, Brave, Arc, Opera, Vivaldi, etc.) |
| **Source code** | Closed source | Open source (MIT) |
| **Tools** | 18 MCP tools | Same 18 MCP tools |
| **Performance** | Baseline | Identical |

### Blocked Domains in the Official Extension

| Category | Blocked Sites |
|----------|--------------|
| Banking | Chase, BofA, Wells Fargo, Citibank |
| Investing/Brokerage | Schwab, Fidelity, Robinhood, E-Trade, Wealthfront, Betterment |
| Payments/Transfers | PayPal, Venmo, Cash App, Zelle, Stripe, Square, Wise, Western Union, MoneyGram, Adyen, Checkout.com |
| BNPL | Klarna, Affirm, Afterpay |
| Neobanks/Fintech | SoFi, Chime, Mercury, Brex, Ramp |
| Crypto | Coinbase, Binance, Kraken, MetaMask |
| Gambling | DraftKings, FanDuel, Bet365, Bovada, PokerStars, BetMGM, Caesars |
| Dating | Tinder, Bumble, Hinge, Match, OKCupid |
| Adult | Pornhub, XVideos, XNXX |
| News/Media | NYT, WSJ, Barron's, MarketWatch, Bloomberg, Reuters, Economist, Wired, Vogue |
| Social Media | Reddit |

Open Claude in Chrome has **none of these restrictions**.

## Architecture

```
Claude Code <--stdio MCP--> mcp-server.js <--TCP--> native-host.js <--native messaging--> Extension <--> Browser
```

Three components:
1. **Extension** — Manifest V3 with CDP-based browser automation and parity tool aliases
2. **MCP Server** — Node.js process started by Claude Code, exposes tools via MCP
3. **Native Messaging Host** — Bridge between the MCP server and the extension

## Installation

### Prerequisites

- **Node.js** v18+
- **Any Chromium browser** (Chrome, Edge, Brave, Arc, Opera, Vivaldi, etc.)
- **Claude Code** v2.0.73+

### Step 1: Install dependencies

From the repo root:

```bash
bun install
```

### Step 2: Load the extension

1. Go to `chrome://extensions` (or `brave://extensions` / `edge://extensions`)
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `packages/open-claude-in-chrome/extension/` directory

### Step 3: Register native messaging

From the repo root:

```bash
bun run chrome:install:host
```

The install script auto-detects unpacked Open Claude in Chrome installs by
reading local Chromium profile metadata for the current `extension/` path.
If auto-detection misses a browser, you can still pass explicit IDs:

```bash
bun run chrome:install:host -- <chrome-id> <brave-id> <arc-id>
```

### Step 4: Restart your browser

Close **all** windows and reopen. The browser reads native messaging host configs on startup.

### Step 5: Enable in OpenClaude

Enable Chrome integration from OpenClaude Settings or with `/chrome`. OpenClaude
loads the Chrome MCP runtime as a built-in package; do not add a project or user
`.mcp.json` entry for this extension.

## Verification

Start a new OpenClaude session and test:

```
Navigate to reddit.com and take a screenshot
```

Reddit loads. No domain restriction.

## Available Tools

Core tools and current parity aliases:

| Tool | Description |
|------|-------------|
| `tabs_context_mcp` | Get tab group context |
| `tabs_create_mcp` | Create new tab |
| `tabs_context` | Alias for tab group context |
| `tabs_create` | Alias for creating a new tab |
| `tabs_close_mcp` | Close a tab in the current group |
| `browser_batch` | Execute ordered browser tool actions |
| `navigate` | Navigate to URL, back, forward |
| `computer` | Mouse, keyboard, screenshots (13 actions) |
| `read_page` | Accessibility tree with element refs |
| `get_page_text` | Extract article/main text |
| `find` | Find elements by text/attributes |
| `form_input` | Set form values by ref |
| `javascript_tool` | Execute JS in page context |
| `read_console_messages` | Console output (filtered) |
| `read_network_requests` | Network activity |
| `resize_window` | Resize browser window |
| `upload_image` | Upload screenshot to file input |
| `file_upload` | Prepare a file upload target |
| `gif_creator` | GIF recording/export |
| `shortcuts_list` | List shortcuts |
| `shortcuts_execute` | Run shortcut |
| `switch_browser` | Switch browser |
| `update_plan` | Present plan (auto-approved) |
| `turn_answer_start` | Browser turn-start compatibility signal |

## Updating After Code Changes

No build step. All files are plain JavaScript. After pulling or editing code:

| What changed | What to do |
|---|---|
| `extension/background.js` or `extension/content.js` or `extension/manifest.json` | Reload the extension: `brave://extensions` > click the reload icon |
| `host/mcp-server.js` | Kill stale servers and reconnect: `pkill -f "node.*mcp-server"` then restart or reconnect OpenClaude |
| `host/native-host.js` | Restart the browser (close all windows, reopen) |
| `install.sh` or native host name changed | Re-run `bun run chrome:install:host`, restart browser |

### Quick reset (nuclear option)

If things are broken and you're not sure why:

```bash
# 1. Kill all MCP servers
pkill -f "node.*mcp-server"

# 2. Re-run install
bun run chrome:install:host

# 3. Restart browser (close all windows, reopen)

# 4. Reload extension in brave://extensions

# 5. Reconnect in OpenClaude
# /mcp
```

## Multiple Sessions

Multiple OpenClaude sessions can share the same browser extension. The first session becomes the "primary" (owns the TCP port), and subsequent sessions connect as clients through the primary. All sessions can use the browser simultaneously.

If a session disconnects, kill stale servers and reconnect:

```bash
pkill -f "node.*mcp-server"
# then /mcp in each OpenClaude session
```

## Troubleshooting

### Extension not connecting

1. Verify the extension is loaded and enabled
2. Check that `bun run chrome:install:host` was run after loading the unpacked extension from this checkout
3. Restart the browser completely (all windows)
4. Verify the native messaging host manifest exists:
   - **Chrome (macOS)**: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.openclaude.chrome.json`
   - **Brave (macOS)**: `~/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.openclaude.chrome.json`
   - **Edge (macOS)**: `~/Library/Application Support/Microsoft Edge/NativeMessagingHosts/com.openclaude.chrome.json`
5. Confirm the manifest's `allowed_origins` includes the ID of the loaded unpacked extension

### MCP server not found

Do not add this extension through manual MCP config. Rebuild/restart OpenClaude
so the built-in `claude-in-chrome` runtime can load the bundled
`open-claude-in-chrome` package.

### "Browser extension is not connected"

The MCP server started but the native host hasn't connected. Try:
1. Open any webpage (wakes the service worker)
2. Check service worker logs: `chrome://extensions` > "Inspect views: service worker"
3. Verify `host/native-host-wrapper.sh` exists

### Tools fail immediately after reconnect

Stale MCP server processes from previous sessions may be holding the port. Fix:

```bash
pkill -f "node.*mcp-server"
```

Then `/mcp` in Claude Code to reconnect. The fresh server will bind the port and accept the native host connection.

### Does the unpacked extension ID change?

It can. The ID is not pinned in `manifest.json`, so Chromium may assign a
different unpacked ID when you load the extension from a different checkout,
worktree, or browser/profile. That is why `./install.sh` now auto-detects the
installed ID from browser profile data instead of forcing you to paste it
manually. If you keep the same browser/profile and the same unpacked path, the
ID is often stable, but the install flow no longer depends on that.

### Port conflict

Default port is 18765. To change:
1. Create `~/.config/open-claude-in-chrome/config.json`:
   ```json
   { "port": 19000 }
   ```
2. Restart browser and Claude Code

## License

MIT

Built by [Sebastian Sosa](https://github.com/CakeCrusher) ([Noemica](https://noemica.io))
