# DeveCopilotRemote

Drive the VS Code Copilot chat panel from your phone.

This extension starts a local web server so you can submit prompts, browse files, and watch live changes from any device on the same network.

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

## Run locally

1. `npm install`
2. `npm run compile`
3. Open in VS Code and press **F5**.
4. Run `DeveCopilotRemote: Copy Web UI URL` and open the URL on your phone.

## Limitations

Copilot does not expose an API to stream the full agent response back to extensions. Because of this, the web UI can only stream back the file changes Copilot makes — the actual chat response text is only visible in the desktop VS Code chat panel.

