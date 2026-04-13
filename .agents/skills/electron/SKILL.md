---
name: electron
description: Automate Electron desktop apps (VS Code, Slack, Discord, Figma, Notion, Spotify, etc.) using playwright-cli via Chrome DevTools Protocol. Use when the user needs to interact with an Electron app, automate a desktop app, connect to a running app, control a native app, or test an Electron application. Triggers include "automate Slack app", "control VS Code", "interact with Discord app", "test this Electron app", "connect to desktop app", or any task requiring automation of a native Electron application.
allowed-tools: Bash(playwright-cli:*), Bash(npx playwright-cli:*), Bash(curl:*), Bash(lsof:*), Bash(open:*), Bash(ps:*), Bash(kill:*)
---

# Electron App Automation

Automate any Electron desktop app using playwright-cli's CDP attach mode. Electron apps are built on Chromium and expose a Chrome DevTools Protocol (CDP) port that playwright-cli can connect to, enabling the same snapshot-interact workflow used for web pages.

## Critical Safety Rule: Never Kill Processes You Didn't Start

**You may be running inside an Electron app (e.g., Orca).** Killing the wrong process will terminate your own session.

- **NEVER** run `killall Electron`, `pkill Electron`, or any broad process-killing command.
- **NEVER** kill a process unless you launched it yourself in this session and you recorded its PID.
- Before killing, **always verify** the PID belongs to the process you started — check the command line includes the workspace path or args you used to launch it.
- When quitting apps to relaunch with `--remote-debugging-port`, use `osascript -e 'quit app "AppName"'` for named apps (Slack, VS Code, etc.) — **never for Orca or the app you're running inside**.
- If unsure whether a process is safe to kill, **ask the user**.

## Core Workflow

1. **Launch** the Electron app with remote debugging enabled (or find an already-running app with CDP)
2. **Attach** playwright-cli to the CDP endpoint
3. **Snapshot** to discover interactive elements
4. **Interact** using element refs
5. **Re-snapshot** after navigation or state changes

```bash
# Launch an Electron app with remote debugging
open -a "Slack" --args --remote-debugging-port=9222

# Wait for the app to initialize
sleep 3

# Attach playwright-cli to the app via CDP
playwright-cli attach --cdp="http://localhost:9222"

# Standard workflow from here
playwright-cli snapshot
playwright-cli click e5
playwright-cli screenshot
```

## Launching Electron Apps with CDP

Every Electron app supports the `--remote-debugging-port` flag since it's built into Chromium.

### macOS

```bash
# Slack
open -a "Slack" --args --remote-debugging-port=9222

# VS Code
open -a "Visual Studio Code" --args --remote-debugging-port=9223

# Discord
open -a "Discord" --args --remote-debugging-port=9224

# Figma
open -a "Figma" --args --remote-debugging-port=9225

# Notion
open -a "Notion" --args --remote-debugging-port=9226

# Spotify
open -a "Spotify" --args --remote-debugging-port=9227
```

### Linux

```bash
slack --remote-debugging-port=9222
code --remote-debugging-port=9223
discord --remote-debugging-port=9224
```

### Windows

```bash
"C:\Users\%USERNAME%\AppData\Local\slack\slack.exe" --remote-debugging-port=9222
"C:\Users\%USERNAME%\AppData\Local\Programs\Microsoft VS Code\Code.exe" --remote-debugging-port=9223
```

**Important:** If the app is already running, quit it first, then relaunch with the flag. The `--remote-debugging-port` flag must be present at launch time.

## Connecting to an Already-Running App

If an Electron app was already launched with `--remote-debugging-port`, you can attach directly:

```bash
# Check what's listening on a port
lsof -i :9222

# Verify the CDP endpoint has targets
curl -s http://localhost:9222/json

# Attach playwright-cli
playwright-cli attach --cdp="http://localhost:9222"
```

## Attaching

```bash
# Attach to a specific CDP port
playwright-cli attach --cdp="http://localhost:9222"

# Attach with a named session (for controlling multiple apps)
playwright-cli -s=slack attach --cdp="http://localhost:9222"
playwright-cli -s=vscode attach --cdp="http://localhost:9223"
```

After `attach`, all subsequent commands (in that session) target the connected app.

## Tab Management

Electron apps may have multiple windows or webviews. Use tab commands to list and switch between them:

```bash
# List all available targets
playwright-cli tab-list

# Switch to a specific tab by index
playwright-cli tab-select 2
```

If `tab-list` doesn't show all targets, query the CDP endpoint directly to see everything:

```bash
curl -s http://localhost:9222/json | python3 -c "
import sys, json
for i, t in enumerate(json.load(sys.stdin)):
    print(f'[{i}] ({t[\"type\"]}) {t[\"title\"][:60]} - {t[\"url\"][:60]}')
"
```

## Common Patterns

### Inspect and Navigate an App

```bash
open -a "Slack" --args --remote-debugging-port=9222
sleep 3
playwright-cli attach --cdp="http://localhost:9222"
playwright-cli snapshot
# Read the snapshot output to identify UI elements
playwright-cli click e10   # Navigate to a section
playwright-cli snapshot    # Re-snapshot after navigation
```

### Take Screenshots of Desktop Apps

```bash
playwright-cli attach --cdp="http://localhost:9222"
playwright-cli screenshot
playwright-cli screenshot e5  # Screenshot a specific element
playwright-cli screenshot --filename=app-state.png
```

### Extract Data from a Desktop App

```bash
playwright-cli attach --cdp="http://localhost:9222"
playwright-cli snapshot
playwright-cli eval "document.title"
playwright-cli eval "el => el.textContent" e5
```

### Fill Forms in Desktop Apps

```bash
playwright-cli attach --cdp="http://localhost:9222"
playwright-cli snapshot
playwright-cli fill e3 "search query"
playwright-cli press Enter
playwright-cli snapshot
```

### Run Multiple Apps Simultaneously

Use named sessions to control multiple Electron apps at the same time:

```bash
# Attach to Slack
playwright-cli -s=slack attach --cdp="http://localhost:9222"

# Attach to VS Code
playwright-cli -s=vscode attach --cdp="http://localhost:9223"

# Interact with each independently
playwright-cli -s=slack snapshot
playwright-cli -s=vscode snapshot
```

### Run Custom Playwright Code

For advanced scenarios, use `run-code` to execute arbitrary Playwright code:

```bash
playwright-cli run-code "async page => {
  await page.waitForSelector('.loading', { state: 'hidden' });
  const items = await page.locator('.item').allTextContents();
  return items;
}"
```

## Troubleshooting

### "Connection refused" or "Cannot connect"

- Make sure the app was launched with `--remote-debugging-port=NNNN`
- If the app was already running, quit and relaunch with the flag
- Check that the port isn't in use by another process: `lsof -i :9222`

### App launches but attach fails

- Wait a few seconds after launch before attaching (`sleep 3`)
- Some apps take time to initialize their webview
- Verify the endpoint is responding: `curl -s http://localhost:9222/json`

### Elements not appearing in snapshot

- The app may use multiple webviews. Use `playwright-cli tab-list` to list targets and switch
- Use `curl -s http://localhost:<port>/json` to see all CDP targets if tab-list shows fewer
- Try `playwright-cli snapshot` without flags first

### Cannot type in input fields

- Some Electron apps use custom input components
- Try `playwright-cli press` for keyboard events
- Use `playwright-cli run-code` for complex input scenarios

### Stale element refs after interaction

- Element refs change when the page state updates
- Always re-snapshot after clicking, navigating, or filling forms
- Use the new refs from the latest snapshot

## Supported Apps

Any app built on Electron works, including:

- **Communication:** Slack, Discord, Microsoft Teams, Signal, Telegram Desktop
- **Development:** VS Code, GitHub Desktop, Postman, Insomnia
- **Design:** Figma, Notion, Obsidian
- **Media:** Spotify, Tidal
- **Productivity:** Todoist, Linear, 1Password

If an app is built with Electron, it supports `--remote-debugging-port` and can be automated with playwright-cli.

## Cleaning Up

```bash
# Close the playwright-cli session (does NOT kill the Electron app)
playwright-cli close

# Close a named session
playwright-cli -s=slack close

# Close all playwright-cli sessions
playwright-cli close-all
```
