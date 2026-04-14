# DeveCopilotRemote

![DeveCopilotRemote](p1.png)

> **Shopping for clothes with your wife?** She's trying on outfit #47, you're on commit #47.
> 
> **At the gym between sets?** Lift, rest, bugfix, repeat.
> 
> **Sitting in church?** Let us deploy. Amen.
> 
> **Dropping a big one?** Time on the throne, code on the phone.
> 
> **Funeral?** Okay maybe not this one. ...Unless the WiFi's good.

Drive the VS Code Copilot chat panel from your phone.

This extension starts a local web server so you can submit prompts, browse files, and watch live changes from any device on the same network.

(So yeah, if you're outside of the house, just run a VPN / Tailscale / whatever, copilot will fix this for you)

## Screenshots

### Chat
![Chat](Screenshot_Chat.png)

### Checked-out changes
![Checked-out changes](Screenshot_CheckedOut.png)

### Files
![Files](Screenshot_Files.png)

## Commands

- `DeveCopilotRemote: Send Prompt To Chat`
- `DeveCopilotRemote: Summarize Active File In Chat`
- `DeveCopilotRemote: Open Web UI`
- `DeveCopilotRemote: Copy Web UI URL`
- `DeveCopilotRemote: Switch Authentication Mode`

## Authentication

Two auth modes are available, selectable via the status bar item or the **Switch Authentication Mode** command:

| Mode | How it works |
|------|-------------|
| **Token** (default) | A random token is generated each time VS Code starts. The URL includes the token as a query parameter (`?token=...`), anyone with the link can connect. |
| **Password** | A static password you set once in settings. The web UI prompts for it, hashes it client-side (SHA-256), and puts the hash in the URL (`?passwordHash=...`). The hashed URL is bookmarkable and persists across sessions. |

Switch modes from the status bar (bottom-right, shows `$(key) Auth: token/password`) or run the command. When switching to password mode you'll be prompted to set a password if one isn't configured yet.

> **⚠️ HTTP warning:** The web UI is served over plain HTTP. Credentials are transmitted unencrypted. Use a VPN, SSH tunnel, or Tailscale for secure access over untrusted networks.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `deveCopilotRemote.defaultMode` | `current` | Chat mode used when sending prompts (`current`, `ask`, `edit`, `agent`). |
| `deveCopilotRemote.blockOnResponse` | `true` | Wait for the chat response to complete before returning. |
| `deveCopilotRemote.webUi.autoStart` | `true` | Start the web UI server on extension activation. |
| `deveCopilotRemote.webUi.host` | `0.0.0.0` | Host interface for the web UI server. |
| `deveCopilotRemote.webUi.port` | `3210` | Port for the web UI server. |
| `deveCopilotRemote.webUi.authMode` | `token` | Authentication mode: `token` or `password`. |
| `deveCopilotRemote.webUi.password` | *(empty)* | Static password for password auth mode. |

## Run locally

1. `npm install`
2. `npm run compile`
3. Open in VS Code and press **F5**.
4. Run `DeveCopilotRemote: Copy Web UI URL` and open the URL on your phone.

## Limitations

When Copilot requests a tool confirmation (e.g. running a terminal command), the response cannot be extracted, you will need to approve it on the desktop VS Code chat panel. Simple ask-mode responses are relayed directly to the mobile web UI. I would suggest to just activate the "Autopilot mode".
