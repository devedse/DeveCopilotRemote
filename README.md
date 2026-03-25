# DeveCopilotRemote

This is a VS Code extension for driving the existing native chat panel from a mobile device.

## What it does

- asks for a prompt
- optionally attaches the active file
- calls `workbench.action.chat.open`
- submits the request into the real chat panel
- serves a responsive mobile web UI for remote prompt submission
- browse workspace files from your phone
- view uncommitted git changes and live edits in real time

## Commands

- `DeveCopilotRemote: Send Prompt To Chat`
- `DeveCopilotRemote: Summarize Active File In Chat`
- `DeveCopilotRemote: Open Web UI`
- `DeveCopilotRemote: Copy Web UI URL`

## Run locally

1. Run `npm install` in this folder.
2. Run `npm run compile`.
3. Open this folder in VS Code.
4. Press `F5` to launch the Extension Development Host.
5. Run `DeveCopilotRemote: Open Web UI` or `DeveCopilotRemote: Copy Web UI URL`.
6. Open the copied URL on your phone if both devices are on the same network.

## Notes

This extension targets the existing native chat surface. It submits prompts into the panel. Responses are only available in the VS Code desktop chat panel — there is no API to read the actual Copilot response from an extension.

The web UI has three tabs:

- **Chat** — compose and submit prompts to the VS Code Copilot chat panel
- **Changes** — shows uncommitted git changes plus a live stream of file edits as they happen
- **Files** — browse the workspace directory tree and view file contents

