import { execFile } from 'child_process';
import { createHash, randomBytes } from 'crypto';
import * as http from 'http';
import { networkInterfaces } from 'os';
import * as path from 'path';
import { promises as fs } from 'fs';
import { promisify } from 'util';
import * as vscode from 'vscode';

const execFileAsync = promisify(execFile);

type ChatMode = 'ask' | 'edit' | 'agent';
type RequestedChatMode = ChatMode | 'current';

type ChatOpenOptions = {
  query: string;
  isPartialQuery?: boolean;
  attachFiles?: Array<vscode.Uri | { uri: vscode.Uri; range: vscode.Range }>;
  mode?: ChatMode | string;
  blockOnResponse?: boolean;
  modelSelector?: { vendor?: string; id?: string; family?: string; version?: string };
};

type WebUiState = {
  server: http.Server;
  host: string;
  port: number;
  token: string;
  localUrl: string;
  externalUrl?: string;
};

type ChatRequestBody = {
  prompt?: string;
  mode?: RequestedChatMode;
  attachActiveFile?: boolean;
  model?: string;
};

type GitRepository = {
  rootUri: vscode.Uri;
  show(ref: string): Promise<string>;
};

type FileChange = {
  path: string;
  status: string;
  diff: string;
};

type ChangeListener = (change: FileChange) => void;

type StreamEvent =
  | { type: 'status'; stage: 'submitted' | 'awaiting-response' | 'response-complete'; message: string }
  | { type: 'response'; text: string; model?: string; details?: string }
  | { type: 'confirmation'; toolId: string; message: string }
  | { type: 'change'; file: FileChange }
  | { type: 'error'; message: string }
  | { type: 'done'; note?: string };

const OPEN_CHAT_COMMAND = 'workbench.action.chat.open';
const COPY_ALL_CHAT_COMMAND = 'workbench.action.chat.copyAll';
const SEND_PROMPT_COMMAND = 'deveCopilotRemote.sendPromptToChat';
const SUMMARIZE_ACTIVE_FILE_COMMAND = 'deveCopilotRemote.summarizeActiveFile';
const OPEN_WEB_UI_COMMAND = 'deveCopilotRemote.openWebUi';
const COPY_WEB_UI_URL_COMMAND = 'deveCopilotRemote.copyWebUiUrl';
const SWITCH_AUTH_MODE_COMMAND = 'deveCopilotRemote.switchAuthMode';

let webUiState: WebUiState | undefined;
let webUiStartup: Promise<WebUiState> | undefined;

// ── Global document change tracker ──
const changeListeners = new Set<ChangeListener>();

// Lightweight snapshot cache: only open-tab documents, cleaned up on close.
const documentSnapshots = new Map<string, string>();

function onFileChange(change: FileChange): void {
  for (const listener of changeListeners) {
    listener(change);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('DeveCopilotRemote');

  context.subscriptions.push(output);

  // Seed snapshot cache with already-open documents
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.uri.scheme === 'file' && !doc.isUntitled) {
      documentSnapshots.set(doc.uri.toString(), doc.getText());
    }
  }

  // Cache documents when they are opened in a tab
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc.uri.scheme === 'file' && !doc.isUntitled) {
        documentSnapshots.set(doc.uri.toString(), doc.getText());
      }
    })
  );

  // Clean up when a document is closed
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      documentSnapshots.delete(doc.uri.toString());
    })
  );

  // Listen for all document changes from the start
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.contentChanges.length === 0) {
        return;
      }
      const doc = event.document;
      if (doc.uri.scheme !== 'file' || doc.isUntitled) {
        return;
      }

      const key = doc.uri.toString();
      const previousText = documentSnapshots.get(key);
      const previousLines = previousText?.split('\n');

      // Always update snapshot to the new content right away
      documentSnapshots.set(key, doc.getText());

      if (changeListeners.size === 0) {
        return;
      }

      const relativePath = vscode.workspace.asRelativePath(doc.uri, false);
      const diffLines = event.contentChanges.map(c => {
        const parts: string[] = [];

        // Extract actual removed text from snapshot if available
        if (c.rangeLength > 0) {
          if (previousLines) {
            const startLine = c.range.start.line;
            const endLine = c.range.end.line;
            const removedLines = previousLines.slice(startLine, endLine + 1);
            // Trim partial first/last lines to match the exact range
            if (removedLines.length > 0) {
              removedLines[0] = removedLines[0].substring(c.range.start.character);
              removedLines[removedLines.length - 1] = removedLines[removedLines.length - 1].substring(0, c.range.end.character);
            }
            for (const line of removedLines) {
              parts.push(`-${line}`);
            }
          } else {
            // Fallback: no snapshot available, show line numbers
            const label = c.range.start.line !== c.range.end.line
              ? `Lines ${c.range.start.line + 1}-${c.range.end.line + 1}`
              : `Line ${c.range.start.line + 1}`;
            parts.push(`-${label} removed`);
          }
        }

        if (c.text) {
          for (const line of c.text.split('\n')) {
            parts.push(`+${line}`);
          }
        }
        return parts.join('\n');
      });

      onFileChange({
        path: relativePath,
        status: 'modified',
        diff: diffLines.join('\n')
      });
    })
  );

  // Listen for file creation
  context.subscriptions.push(
    vscode.workspace.onDidCreateFiles((event) => {
      if (changeListeners.size === 0) {
        return;
      }
      for (const file of event.files) {
        onFileChange({
          path: vscode.workspace.asRelativePath(file, false),
          status: 'added',
          diff: '+[new file]'
        });
      }
    })
  );

  // Listen for file deletion
  context.subscriptions.push(
    vscode.workspace.onDidDeleteFiles((event) => {
      if (changeListeners.size === 0) {
        return;
      }
      for (const file of event.files) {
        onFileChange({
          path: vscode.workspace.asRelativePath(file, false),
          status: 'deleted',
          diff: '-[file deleted]'
        });
      }
    })
  );

  // Listen for file rename
  context.subscriptions.push(
    vscode.workspace.onDidRenameFiles((event) => {
      if (changeListeners.size === 0) {
        return;
      }
      for (const file of event.files) {
        onFileChange({
          path: vscode.workspace.asRelativePath(file.newUri, false),
          status: 'renamed',
          diff: `-${vscode.workspace.asRelativePath(file.oldUri, false)}\n+${vscode.workspace.asRelativePath(file.newUri, false)}`
        });
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(SEND_PROMPT_COMMAND, async () => {
      await sendPromptToNativeChat(output);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(SUMMARIZE_ACTIVE_FILE_COMMAND, async () => {
      await summarizeActiveFile(output);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(OPEN_WEB_UI_COMMAND, async () => {
      const state = await ensureWebUiServerStarted(context, output);
      const urls = getWebUiUrls(state);
      await vscode.env.openExternal(vscode.Uri.parse(urls.localUrl));
      vscode.window.showInformationMessage('DeveCopilotRemote web UI opened in your browser.');
      warnIfHttp(urls.localUrl);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COPY_WEB_UI_URL_COMMAND, async () => {
      const state = await ensureWebUiServerStarted(context, output);
      const urls = getWebUiUrls(state);
      const bestUrl = urls.externalUrl ?? urls.localUrl;
      await vscode.env.clipboard.writeText(bestUrl);
      vscode.window.showInformationMessage(`Copied DeveCopilotRemote URL: ${bestUrl}`);
      warnIfHttp(bestUrl);
    })
  );

  // ── Auth mode status bar & command ──
  const authModeItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  updateAuthModeStatusBar(authModeItem);
  authModeItem.command = SWITCH_AUTH_MODE_COMMAND;
  authModeItem.show();
  context.subscriptions.push(authModeItem);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('deveCopilotRemote.webUi.authMode') ||
          e.affectsConfiguration('deveCopilotRemote.webUi.password')) {
        updateAuthModeStatusBar(authModeItem);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(SWITCH_AUTH_MODE_COMMAND, async () => {
      const configuration = vscode.workspace.getConfiguration('deveCopilotRemote');
      const current = configuration.get<string>('webUi.authMode', 'token');

      const pick = await vscode.window.showQuickPick([
        { label: 'Token', description: 'Generate a new random token each session (default)', detail: current === 'token' ? '$(check) Currently active' : undefined },
        { label: 'Password', description: 'Use a static password that persists across sessions', detail: current === 'password' ? '$(check) Currently active' : undefined }
      ], { title: 'DeveCopilotRemote: Authentication Mode' });

      if (!pick) {
        return;
      }

      const newMode = pick.label.toLowerCase();
      await configuration.update('webUi.authMode', newMode, vscode.ConfigurationTarget.Global);

      if (newMode === 'password') {
        const existingPassword = configuration.get<string>('webUi.password', '');
        if (!existingPassword) {
          const newPassword = await vscode.window.showInputBox({
            prompt: 'Set a password for the web UI',
            password: true,
            ignoreFocusOut: true,
            validateInput: (v) => v.trim().length < 4 ? 'Password must be at least 4 characters' : undefined
          });
          if (newPassword) {
            await configuration.update('webUi.password', newPassword, vscode.ConfigurationTarget.Global);
          } else {
            // Cancelled, revert to token mode
            await configuration.update('webUi.authMode', 'token', vscode.ConfigurationTarget.Global);
          }
        }
      }

      updateAuthModeStatusBar(authModeItem);
      const finalMode = vscode.workspace.getConfiguration('deveCopilotRemote').get<string>('webUi.authMode', 'token');
      vscode.window.showInformationMessage(`DeveCopilotRemote auth mode set to: ${finalMode}`);

      // Re-print URLs to output so user sees the updated links
      if (webUiState) {
        const urls = getWebUiUrls(webUiState);
        output.appendLine(`Auth mode changed to: ${finalMode}`);
        output.appendLine(`Local URL: ${urls.localUrl}`);
        if (urls.externalUrl) {
          output.appendLine(`Mobile URL: ${urls.externalUrl}`);
        }
        output.show(true);
      }
    })
  );

  context.subscriptions.push({
    dispose: () => {
      if (webUiState?.server.listening) {
        webUiState.server.close();
      }
    }
  });

  const configuration = vscode.workspace.getConfiguration('deveCopilotRemote');
  const autoStartWebUi = configuration.get<boolean>('webUi.autoStart', true);

  if (autoStartWebUi) {
    void ensureWebUiServerStarted(context, output);
  }
}

function getWebUiUrls(state: WebUiState): { localUrl: string; externalUrl?: string } {
  const configuration = vscode.workspace.getConfiguration('deveCopilotRemote');
  const authMode = configuration.get<string>('webUi.authMode', 'token');

  if (authMode === 'password') {
    const localUrl = `http://localhost:${state.port}/`;
    const nets = networkInterfaces();
    let externalUrl: string | undefined;

    for (const addresses of Object.values(nets)) {
      const networkAddresses = (addresses ?? []) as Array<{
        address: string;
        family: string | number;
        internal: boolean;
      }>;
      for (const address of networkAddresses) {
        const isIpv4 = typeof address.family === 'string' ? address.family === 'IPv4' : address.family === 4;
        if (isIpv4 && !address.internal) {
          externalUrl = `http://${address.address}:${state.port}/`;
          break;
        }
      }
      if (externalUrl) {
        break;
      }
    }

    return { localUrl, externalUrl };
  }

  return getServerUrls(state.port, state.token);
}

function updateAuthModeStatusBar(item: vscode.StatusBarItem): void {
  const configuration = vscode.workspace.getConfiguration('deveCopilotRemote');
  const authMode = configuration.get<string>('webUi.authMode', 'token');
  item.text = `$(key) Auth: ${authMode}`;
  item.tooltip = `DeveCopilotRemote authentication mode: ${authMode}. Click to change.`;
}

function warnIfHttp(url: string): void {
  if (url.startsWith('http://')) {
    vscode.window.showWarningMessage(
      'DeveCopilotRemote: The web UI is served over HTTP. Credentials are not encrypted in transit. Use a VPN or SSH tunnel for secure access over untrusted networks.'
    );
  }
}

export function deactivate(): void {
  if (webUiState) {
    for (const listener of changeListeners) {
      changeListeners.delete(listener);
    }
    webUiState.server.close();
    webUiState = undefined;
  }
}

async function sendPromptToNativeChat(output: vscode.OutputChannel): Promise<void> {
  const prompt = await vscode.window.showInputBox({
    prompt: 'Prompt to send to the native chat panel',
    placeHolder: 'Explain the current file, suggest a refactor, debug an error...'
  });

  if (!prompt) {
    return;
  }

  const attachActiveFile = await askYesNo('Attach the active file as chat context?');
  const options = await buildChatOptions(prompt, attachActiveFile);

  await openNativeChat(output, options);
}

async function summarizeActiveFile(output: vscode.OutputChannel): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    vscode.window.showWarningMessage('Open a file before using this command.');
    return;
  }

  const languageId = editor.document.languageId;
  const fileName = vscode.workspace.asRelativePath(editor.document.uri, false);
  const prompt = `Summarize the active file ${fileName} written in ${languageId}. Focus on purpose, main components, and any obvious risks.`;

  const options = await buildChatOptions(prompt, true);
  await openNativeChat(output, options);
}

async function buildChatOptions(prompt: string, attachActiveFile: boolean, requestedMode?: RequestedChatMode, modelId?: string): Promise<ChatOpenOptions> {
  const configuration = vscode.workspace.getConfiguration('deveCopilotRemote');
  const defaultMode = configuration.get<RequestedChatMode>('defaultMode', 'current');
  const blockOnResponse = configuration.get<boolean>('blockOnResponse', true);
  const editor = vscode.window.activeTextEditor;
  const mode = requestedMode ?? defaultMode;

  const options: ChatOpenOptions = {
    query: prompt,
    blockOnResponse
  };

  if (mode !== 'current') {
    options.mode = mode;
  }

  if (modelId) {
    options.modelSelector = { id: modelId };
  }

  if (attachActiveFile && editor) {
    const selection = editor.selection;

    if (!selection.isEmpty) {
      options.attachFiles = [
        {
          uri: editor.document.uri,
          range: new vscode.Range(selection.start, selection.end)
        }
      ];
    } else {
      options.attachFiles = [editor.document.uri];
    }
  }

  return options;
}

async function openNativeChat(output: vscode.OutputChannel, options: ChatOpenOptions): Promise<unknown> {
  output.appendLine(`Submitting prompt to native chat. Mode=${String(options.mode)} Attachments=${options.attachFiles?.length ?? 0}`);
  output.show(true);

  try {
    const result = await vscode.commands.executeCommand(OPEN_CHAT_COMMAND, options);
    output.appendLine(`chat.open resolved with: ${safeStringify(result)}`);

    if (result && typeof result === 'object' && 'type' in (result as Record<string, unknown>)) {
      const type = String((result as Record<string, unknown>).type);
      vscode.window.showInformationMessage(`Native chat request completed with result type: ${type}`);
      return result;
    }

    vscode.window.showInformationMessage('Prompt submitted to the native chat panel.');
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.appendLine(`chat.open failed: ${message}`);
    vscode.window.showErrorMessage(`Failed to open native chat: ${message}`);
    throw error;
  }
}

async function ensureWebUiServerStarted(context: vscode.ExtensionContext, output: vscode.OutputChannel): Promise<WebUiState> {
  if (webUiState) {
    return webUiState;
  }

  if (webUiStartup) {
    return webUiStartup;
  }

  webUiStartup = startWebUiServer(context, output);

  try {
    webUiState = await webUiStartup;
    return webUiState;
  } finally {
    webUiStartup = undefined;
  }
}

async function startWebUiServer(context: vscode.ExtensionContext, output: vscode.OutputChannel): Promise<WebUiState> {
  const configuration = vscode.workspace.getConfiguration('deveCopilotRemote');
  const host = configuration.get<string>('webUi.host', '0.0.0.0');
  const port = configuration.get<number>('webUi.port', 3210);
  const token = randomBytes(16).toString('hex');
  const mediaRoot = vscode.Uri.joinPath(context.extensionUri, 'media', 'web').fsPath;

  const server = http.createServer(async (req, res) => {
    try {
      await handleHttpRequest(req, res, mediaRoot, output, token);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.appendLine(`Web UI request error: ${message}`);
      writeJson(res, 500, { ok: false, error: 'Internal server error.' });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const urls = getServerUrls(port, token);
  const state: WebUiState = {
    server,
    host,
    port,
    token,
    localUrl: urls.localUrl,
    externalUrl: urls.externalUrl
  };

  output.appendLine(`Web UI listening on ${host}:${port}`);
  output.appendLine(`Local URL: ${state.localUrl}`);
  if (state.externalUrl) {
    output.appendLine(`Mobile URL: ${state.externalUrl}`);
  }
  output.show(true);

  return state;
}

async function handleHttpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  mediaRoot: string,
  output: vscode.OutputChannel,
  token: string
): Promise<void> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (method === 'GET' && url.pathname === '/api/status') {
    const configuration = vscode.workspace.getConfiguration('deveCopilotRemote');
    const defaultMode = configuration.get<RequestedChatMode>('defaultMode', 'current');
    const authMode = configuration.get<string>('webUi.authMode', 'token');

    writeJson(res, 200, {
      ok: true,
      appName: 'DeveCopilotRemote',
      defaultMode,
      authMode,
      modeOptions: ['current', 'ask', 'edit', 'agent'],
      features: {
        chat: true,
        checkedOutFiles: true,
        files: false
      },
      nativeChatMirroring: false
    });
    return;
  }

  if (method === 'GET' && url.pathname === '/api/models') {
    if (!isAuthorized(req, url, token)) {
      writeJson(res, 401, { ok: false, error: 'Unauthorized.' });
      return;
    }

    try {
      const models = await vscode.lm.selectChatModels({});
      const list = models.map(m => ({
        id: m.id,
        name: m.name ?? m.id,
        vendor: m.vendor,
        family: m.family,
        version: m.version,
        maxInputTokens: m.maxInputTokens
      }));
      writeJson(res, 200, { ok: true, models: list });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeJson(res, 500, { ok: false, error: message });
    }
    return;
  }

  if (method === 'GET' && url.pathname === '/api/changes') {
    if (!isAuthorized(req, url, token)) {
      writeJson(res, 401, { ok: false, error: 'Unauthorized.' });
      return;
    }

    // SSE stream: push document changes in real time
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive'
    });
    res.flushHeaders?.();

    const listener: ChangeListener = (change) => {
      res.write(`data: ${JSON.stringify(change)}\n\n`);
    };
    changeListeners.add(listener);

    const cleanup = () => {
      changeListeners.delete(listener);
      if (!res.writableEnded) {
        res.end();
      }
    };
    req.on('close', cleanup);
    res.on('error', cleanup);
    return;
  }

  if (method === 'GET' && url.pathname === '/api/files') {
    if (!isAuthorized(req, url, token)) {
      writeJson(res, 401, { ok: false, error: 'Unauthorized.' });
      return;
    }
    await handleFilesRequest(url, res);
    return;
  }

  if (method === 'GET' && url.pathname === '/api/file') {
    if (!isAuthorized(req, url, token)) {
      writeJson(res, 401, { ok: false, error: 'Unauthorized.' });
      return;
    }
    await handleFileReadRequest(url, res);
    return;
  }

  if (method === 'GET' && url.pathname === '/api/git/status') {
    if (!isAuthorized(req, url, token)) {
      writeJson(res, 401, { ok: false, error: 'Unauthorized.' });
      return;
    }
    await handleGitStatusRequest(res);
    return;
  }

  if (method === 'GET' && url.pathname === '/api/git/diff') {
    if (!isAuthorized(req, url, token)) {
      writeJson(res, 401, { ok: false, error: 'Unauthorized.' });
      return;
    }
    await handleGitDiffRequest(url, res);
    return;
  }

  if (method === 'GET' && url.pathname === '/api/chat/history') {
    if (!isAuthorized(req, url, token)) {
      writeJson(res, 401, { ok: false, error: 'Unauthorized.' });
      return;
    }
    await handleChatHistoryRequest(res, output);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/chat/open') {
    if (!isAuthorized(req, url, token)) {
      writeJson(res, 401, { ok: false, error: 'Unauthorized.' });
      return;
    }

    const body = await readJsonBody<ChatRequestBody>(req);
    const prompt = (body.prompt ?? '').trim();

    if (!prompt) {
      writeJson(res, 400, { ok: false, error: 'Prompt is required.' });
      return;
    }

    if (prompt.length > 12000) {
      writeJson(res, 400, { ok: false, error: 'Prompt is too long.' });
      return;
    }

    const options = await buildChatOptions(prompt, Boolean(body.attachActiveFile), body.mode, body.model);
    const result = await openNativeChat(output, options);
    const extracted = extractChatResponse(result);

    writeJson(res, 200, {
      ok: true,
      submitted: true,
      result: normalizeResult(result),
      response: extracted.text || null,
      model: extracted.model || null,
      note: extracted.text ? undefined : 'The response is rendered in the native VS Code chat panel.'
    });
    return;
  }

  if (method === 'POST' && url.pathname === '/api/chat/stream') {
    if (!isAuthorized(req, url, token)) {
      writeJson(res, 401, { ok: false, error: 'Unauthorized.' });
      return;
    }

    const body = await readJsonBody<ChatRequestBody>(req);
    const prompt = (body.prompt ?? '').trim();

    if (!prompt) {
      writeJson(res, 400, { ok: false, error: 'Prompt is required.' });
      return;
    }

    if (prompt.length > 12000) {
      writeJson(res, 400, { ok: false, error: 'Prompt is too long.' });
      return;
    }

    await handleStreamingChatRequest(req, res, output, prompt, body.mode, Boolean(body.attachActiveFile), body.model);
    return;
  }

  if (method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    await serveStaticFile(res, path.join(mediaRoot, 'index.html'));
    return;
  }

  if (method === 'GET') {
    const requestedPath = path.resolve(path.join(mediaRoot, url.pathname.replace(/^\/+/, '')));
    if (!requestedPath.startsWith(mediaRoot + path.sep) && requestedPath !== mediaRoot) {
      writeJson(res, 403, { ok: false, error: 'Forbidden.' });
      return;
    }

    await serveStaticFile(res, requestedPath);
    return;
  }

  writeJson(res, 404, { ok: false, error: 'Not found.' });
}

function isAuthorized(req: http.IncomingMessage, url: URL, token: string): boolean {
  const configuration = vscode.workspace.getConfiguration('deveCopilotRemote');
  const authMode = configuration.get<string>('webUi.authMode', 'token');

  const headerValue = req.headers['x-devecopilotremote-token'] as string | undefined;

  if (authMode === 'password') {
    const password = configuration.get<string>('webUi.password', '');
    if (!password) {
      return false;
    }
    const expectedHash = createHash('sha256').update(password).digest('hex');
    const queryValue = url.searchParams.get('passwordHash') ?? url.searchParams.get('token');
    return headerValue === expectedHash || queryValue === expectedHash;
  }

  // Token mode
  const queryToken = url.searchParams.get('token');
  return headerValue === token || queryToken === token;
}

async function serveStaticFile(res: http.ServerResponse, filePath: string): Promise<void> {
  try {
    const content = await fs.readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    const contentType = getContentType(extension);

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store'
    });
    res.end(content);
  } catch {
    writeJson(res, 404, { ok: false, error: 'File not found.' });
  }
}

function getContentType(extension: string): string {
  switch (extension) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    default:
      return 'text/plain; charset=utf-8';
  }
}

function writeJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(body));
}

async function readJsonBody<T>(req: http.IncomingMessage): Promise<T> {
  const maxBytes = 64 * 1024;
  const chunks: Buffer[] = [];
  let total = 0;

  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on('end', () => resolve());
    req.on('error', reject);
  });

  const raw = Buffer.concat(chunks).toString('utf8');
  return (raw ? JSON.parse(raw) : {}) as T;
}

function getServerUrls(port: number, token: string): { localUrl: string; externalUrl?: string } {
  const localUrl = `http://localhost:${port}/?token=${token}`;
  const nets = networkInterfaces();
  const candidates: string[] = [];

  for (const addresses of Object.values(nets)) {
    const networkAddresses = (addresses ?? []) as Array<{
      address: string;
      family: string | number;
      internal: boolean;
    }>;
    for (const address of networkAddresses) {
      const isIpv4 = typeof address.family === 'string' ? address.family === 'IPv4' : address.family === 4;
      if (isIpv4 && !address.internal) {
        candidates.push(`http://${address.address}:${port}/?token=${token}`);
      }
    }
  }

  return {
    localUrl,
    externalUrl: candidates[0]
  };
}

function normalizeResult(result: unknown): unknown {
  if (result === undefined || result === null) {
    return null;
  }

  if (typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean') {
    return result;
  }

  return safeStringify(result);
}

async function askYesNo(message: string): Promise<boolean> {
  const selection = await vscode.window.showQuickPick(['Yes', 'No'], {
    title: 'DeveCopilotRemote',
    placeHolder: message,
    ignoreFocusOut: true
  });

  return selection === 'Yes';
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable result]';
  }
}

// ── Chat history helpers ──

async function handleChatHistoryRequest(res: http.ServerResponse, output: vscode.OutputChannel): Promise<void> {
  try {
    // 1. Save current clipboard
    const savedClipboard = await vscode.env.clipboard.readText();

    // 2. Clear clipboard so we can detect when copyAll writes to it
    await vscode.env.clipboard.writeText('');

    // 3. Execute the copy-all command
    await vscode.commands.executeCommand(COPY_ALL_CHAT_COMMAND);

    // 4. Small delay to allow clipboard to be written
    await new Promise(resolve => setTimeout(resolve, 200));

    // 5. Read the chat content
    const chatText = await vscode.env.clipboard.readText();

    // 6. Restore original clipboard
    await vscode.env.clipboard.writeText(savedClipboard);

    if (!chatText || chatText.trim().length === 0) {
      writeJson(res, 200, { ok: true, messages: [], note: 'No chat history found (chat panel may be empty or closed).' });
      return;
    }

    // 7. Parse into structured messages
    const messages = parseChatHistory(chatText);
    output.appendLine(`Chat history: parsed ${messages.length} messages from ${chatText.length} chars of clipboard text`);

    writeJson(res, 200, { ok: true, messages });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.appendLine(`Chat history error: ${message}`);
    writeJson(res, 500, { ok: false, error: `Failed to read chat history: ${message}` });
  }
}

function parseChatHistory(text: string): Array<{ role: 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const lines = text.split('\n');
  let currentRole: 'user' | 'assistant' | '' = '';
  let currentContent: string[] = [];
  let skipNextTimestamp = false;

  function pushCurrent() {
    if (currentRole && currentContent.length > 0) {
      const content = currentContent.join('\n').trim();
      if (content.length > 0) {
        messages.push({ role: currentRole, content });
      }
    }
    currentContent = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Role marker: standalone "You" line → user message starts
    if (/^You$/i.test(trimmed)) {
      pushCurrent();
      currentRole = 'user';
      skipNextTimestamp = true;
      continue;
    }

    // Role marker: standalone "GitHub Copilot" or "Copilot" → assistant starts
    if (/^(GitHub Copilot|Copilot)$/i.test(trimmed)) {
      pushCurrent();
      currentRole = 'assistant';
      skipNextTimestamp = true;
      continue;
    }

    // Skip timestamp lines right after role markers (e.g. "19:32" or "19:32:01")
    if (skipNextTimestamp && /^\d{1,2}:\d{2}(:\d{2})?$/.test(trimmed)) {
      skipNextTimestamp = false;
      continue;
    }
    skipNextTimestamp = false;

    // Inline format: "@workspace ..." starts a user message
    if (trimmed.startsWith('@workspace') && currentRole !== 'user') {
      pushCurrent();
      currentRole = 'user';
      currentContent = [line];
      continue;
    }

    // "User: ..." starts a user message, but ONLY when not already in a user message
    // (otherwise "User:" in content would incorrectly split the message)
    if (/^User:\s*/i.test(trimmed) && currentRole !== 'user') {
      pushCurrent();
      currentRole = 'user';
      const after = trimmed.replace(/^User:\s*/i, '');
      if (after) {
        currentContent = [after];
      }
      continue;
    }

    // "GitHub Copilot: ..." or "Copilot: ..." starts an assistant message
    // Only when not already in an assistant message (same guard)
    if (/^(GitHub Copilot|Copilot):\s*/i.test(trimmed) && currentRole !== 'assistant') {
      pushCurrent();
      currentRole = 'assistant';
      const after = trimmed.replace(/^(GitHub Copilot|Copilot|Assistant):\s*/i, '');
      if (after) {
        currentContent = [after];
      }
      continue;
    }

    // Accumulate content for the current role
    if (currentRole) {
      currentContent.push(line);
    }
  }

  // Push final message
  pushCurrent();

  return messages;
}

// ── File browser helpers ──

function getWorkspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
}

function resolveWorkspacePath(workspaceRoot: string, relativePath: string): string | null {
  const resolved = path.resolve(workspaceRoot, relativePath);
  // Prevent directory traversal
  if (!resolved.startsWith(workspaceRoot + path.sep) && resolved !== workspaceRoot) {
    return null;
  }
  return resolved;
}

async function handleFilesRequest(url: URL, res: http.ServerResponse): Promise<void> {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    writeJson(res, 400, { ok: false, error: 'No workspace folder is open.' });
    return;
  }

  const relativePath = url.searchParams.get('path') || '.';
  const resolved = resolveWorkspacePath(workspaceRoot, relativePath);

  if (!resolved) {
    writeJson(res, 403, { ok: false, error: 'Path is outside the workspace.' });
    return;
  }

  try {
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) {
      writeJson(res, 400, { ok: false, error: 'Path is not a directory.' });
      return;
    }

    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const items = entries
      .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
      .sort((a, b) => {
        // Directories first, then files
        if (a.isDirectory() && !b.isDirectory()) { return -1; }
        if (!a.isDirectory() && b.isDirectory()) { return 1; }
        return a.name.localeCompare(b.name);
      })
      .map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' : 'file',
        path: path.relative(workspaceRoot, path.join(resolved, e.name)).replace(/\\/g, '/')
      }));

    writeJson(res, 200, { ok: true, path: path.relative(workspaceRoot, resolved).replace(/\\/g, '/') || '.', items });
  } catch {
    writeJson(res, 404, { ok: false, error: 'Directory not found.' });
  }
}

async function handleFileReadRequest(url: URL, res: http.ServerResponse): Promise<void> {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    writeJson(res, 400, { ok: false, error: 'No workspace folder is open.' });
    return;
  }

  const relativePath = url.searchParams.get('path');
  if (!relativePath) {
    writeJson(res, 400, { ok: false, error: 'Path parameter is required.' });
    return;
  }

  const resolved = resolveWorkspacePath(workspaceRoot, relativePath);
  if (!resolved) {
    writeJson(res, 403, { ok: false, error: 'Path is outside the workspace.' });
    return;
  }

  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) {
      writeJson(res, 400, { ok: false, error: 'Path is not a file.' });
      return;
    }

    // Limit file size to 512KB for safety
    if (stat.size > 512 * 1024) {
      writeJson(res, 413, { ok: false, error: 'File too large (max 512 KB).' });
      return;
    }

    const content = await fs.readFile(resolved, 'utf8');
    const extension = path.extname(resolved).toLowerCase().replace('.', '');

    writeJson(res, 200, {
      ok: true,
      path: relativePath,
      name: path.basename(resolved),
      extension,
      size: stat.size,
      content
    });
  } catch {
    writeJson(res, 404, { ok: false, error: 'File not found.' });
  }
}

async function handleGitStatusRequest(res: http.ServerResponse): Promise<void> {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    writeJson(res, 400, { ok: false, error: 'No workspace folder is open.' });
    return;
  }

  try {
    const gitExt = vscode.extensions.getExtension('vscode.git');
    if (!gitExt) {
      writeJson(res, 200, { ok: true, branch: '', files: [], error: 'Git extension is not available.' });
      return;
    }

    const git = gitExt.isActive ? gitExt.exports.getAPI(1) : (await gitExt.activate()).getAPI(1);
    if (!git.repositories.length) {
      writeJson(res, 200, { ok: true, repos: [], error: 'No git repository found.' });
      return;
    }

    const repos: Array<{ repoName: string; branch: string; files: Array<{ path: string; status: string }> }> = [];

    for (const repo of git.repositories) {
      const repoRoot = repo.rootUri.fsPath;
      const repoName = vscode.workspace.asRelativePath(repoRoot, false);
      const branch = repo.state.HEAD?.name ?? '';

      const files: Array<{ path: string; status: string }> = [];

      // Index (staged) changes
      for (const change of repo.state.indexChanges) {
        files.push({
          path: vscode.workspace.asRelativePath(change.uri, false),
          status: gitStatusFromCode(change.status, true)
        });
      }

      // Working tree (unstaged) changes
      for (const change of repo.state.workingTreeChanges) {
        files.push({
          path: vscode.workspace.asRelativePath(change.uri, false),
          status: gitStatusFromCode(change.status, false)
        });
      }

      // Untracked
      for (const change of repo.state.untrackedChanges ?? []) {
        files.push({
          path: vscode.workspace.asRelativePath(change.uri, false),
          status: 'untracked'
        });
      }

      // Merge changes
      for (const change of repo.state.mergeChanges) {
        files.push({
          path: vscode.workspace.asRelativePath(change.uri, false),
          status: 'conflict'
        });
      }

      repos.push({ repoName, branch, files });
    }

    writeJson(res, 200, { ok: true, repos });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeJson(res, 200, { ok: true, repos: [], error: `Git query failed: ${message}` });
  }
}

/**
 * Find the git repository that contains `absoluteFilePath` and return
 * the repo root + a posix path relative to that root.
 */
async function findRepoAndRelativePath(
  absoluteFilePath: string
): Promise<{ repoRoot: string; repoRelPath: string; repo: GitRepository } | null> {
  const gitExt = vscode.extensions.getExtension('vscode.git');
  if (!gitExt) { return null; }

  const git = gitExt.isActive ? gitExt.exports.getAPI(1) : (await gitExt.activate()).getAPI(1);

  // Pick the repo whose rootUri is an ancestor of the file
  for (const repo of git.repositories) {
    const repoRoot: string = repo.rootUri.fsPath;
    const normalised = path.resolve(absoluteFilePath);
    if (normalised.startsWith(repoRoot + path.sep) || normalised === repoRoot) {
      const rel = path.relative(repoRoot, normalised).replace(/\\/g, '/');
      return { repoRoot, repoRelPath: rel, repo };
    }
  }

  // Fallback: first repo
  const repo = git.repositories[0];
  if (repo) {
    const repoRoot: string = repo.rootUri.fsPath;
    const rel = path.relative(repoRoot, path.resolve(absoluteFilePath)).replace(/\\/g, '/');
    return { repoRoot, repoRelPath: rel, repo };
  }
  return null;
}

async function handleGitDiffRequest(url: URL, res: http.ServerResponse): Promise<void> {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    writeJson(res, 400, { ok: false, error: 'No workspace folder is open.' });
    return;
  }

  const filePath = url.searchParams.get('path');
  if (!filePath) {
    writeJson(res, 400, { ok: false, error: 'Path parameter is required.' });
    return;
  }

  // Prevent directory traversal
  const resolved = resolveWorkspacePath(workspaceRoot, filePath);
  if (!resolved) {
    writeJson(res, 403, { ok: false, error: 'Path is outside the workspace.' });
    return;
  }

  try {
    // Resolve the git repo root and the path relative to it
    const info = await findRepoAndRelativePath(resolved);
    const repoRoot = info?.repoRoot ?? workspaceRoot;
    const repoRelPath = info?.repoRelPath ?? filePath.replace(/\\/g, '/');

    // Try git diff CLI first, produces correct unified diff output
    let diff = await gitDiffCli(repoRoot, repoRelPath);

    if (!diff) {
      // Fallback: build diff manually via the git extension API
      diff = await gitDiffViaApi(repoRelPath, resolved, info?.repo);
    }

    writeJson(res, 200, { ok: true, path: filePath, diff });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeJson(res, 200, { ok: false, error: `Diff failed: ${message}` });
  }
}

async function gitDiffCli(repoRoot: string, repoRelPath: string): Promise<string> {
  const tryCommands: string[][] = [
    // Working tree vs HEAD (covers staged + unstaged)
    ['diff', 'HEAD', '--', repoRelPath],
    // Staged (cached) changes only, catches newly added files
    ['diff', '--cached', '--', repoRelPath],
  ];

  for (const args of tryCommands) {
    try {
      const { stdout } = await execFileAsync('git', args, {
        cwd: repoRoot,
        maxBuffer: 5 * 1024 * 1024,
      });
      if (stdout.trim()) {
        return stdout;
      }
    } catch {
      // Command failed, try next variant
    }
  }
  return '';
}

async function gitDiffViaApi(repoRelPath: string, resolved: string, repo: GitRepository | undefined): Promise<string> {
  if (!repo) {
    return '';
  }

  let currentContent = '';
  try {
    currentContent = await fs.readFile(resolved, 'utf8');
  } catch {
    // File may have been deleted
  }

  let headContent = '';
  try {
    headContent = await repo.show(`HEAD:${repoRelPath}`);
  } catch {
    // New file, not yet in HEAD
  }

  return buildLcsDiff(headContent, currentContent, repoRelPath);
}

type DiffOp = { type: 'equal' | 'remove' | 'add'; text: string };

function buildLcsDiff(oldText: string, newText: string, filePath: string): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const diffParts: string[] = [];

  diffParts.push(`--- a/${filePath}`);
  diffParts.push(`+++ b/${filePath}`);

  if (oldText === newText) {
    return diffParts.join('\n');
  }

  const ops = computeLcsDiff(oldLines, newLines);
  const hunkLines = formatHunks(ops, 3);
  diffParts.push(...hunkLines);

  return diffParts.join('\n');
}

function computeLcsDiff(oldLines: string[], newLines: string[]): DiffOp[] {
  const n = oldLines.length;
  const m = newLines.length;

  // For very large files, fall back to full remove + add
  if (n > 0 && m > 0 && n * m > 10_000_000) {
    const ops: DiffOp[] = [];
    for (const line of oldLines) { ops.push({ type: 'remove', text: line }); }
    for (const line of newLines) { ops.push({ type: 'add', text: line }); }
    return ops;
  }

  // Standard LCS dynamic-programming table
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack to produce edit operations
  const reversed: DiffOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      reversed.push({ type: 'equal', text: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      reversed.push({ type: 'add', text: newLines[j - 1] });
      j--;
    } else {
      reversed.push({ type: 'remove', text: oldLines[i - 1] });
      i--;
    }
  }
  reversed.reverse();
  return reversed;
}

function formatHunks(ops: DiffOp[], contextSize: number): string[] {
  // Pre-compute old/new line numbers at each op index
  const oldLineAt = new Array<number>(ops.length + 1);
  const newLineAt = new Array<number>(ops.length + 1);
  oldLineAt[0] = 0;
  newLineAt[0] = 0;
  for (let k = 0; k < ops.length; k++) {
    oldLineAt[k + 1] = oldLineAt[k] + (ops[k].type !== 'add' ? 1 : 0);
    newLineAt[k + 1] = newLineAt[k] + (ops[k].type !== 'remove' ? 1 : 0);
  }

  // Find indices of all changed ops
  const changePos: number[] = [];
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].type !== 'equal') {
      changePos.push(k);
    }
  }
  if (changePos.length === 0) { return []; }

  // Group changes into hunk ranges, merging when the gap is small
  const ranges: Array<{ from: number; to: number }> = [];
  let from = changePos[0];
  let to = changePos[0];
  for (let k = 1; k < changePos.length; k++) {
    if (changePos[k] - to <= contextSize * 2) {
      to = changePos[k];
    } else {
      ranges.push({ from, to });
      from = changePos[k];
      to = changePos[k];
    }
  }
  ranges.push({ from, to });

  // Format each hunk
  const result: string[] = [];
  for (const range of ranges) {
    const start = Math.max(0, range.from - contextSize);
    const end = Math.min(ops.length - 1, range.to + contextSize);

    let oldCount = 0;
    let newCount = 0;
    const lines: string[] = [];

    for (let k = start; k <= end; k++) {
      const op = ops[k];
      if (op.type === 'equal') {
        lines.push(` ${op.text}`);
        oldCount++;
        newCount++;
      } else if (op.type === 'remove') {
        lines.push(`-${op.text}`);
        oldCount++;
      } else {
        lines.push(`+${op.text}`);
        newCount++;
      }
    }

    const oldStart = oldLineAt[start] + 1;
    const newStart = newLineAt[start] + 1;
    result.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    result.push(...lines);
  }

  return result;
}

// VS Code Git extension status codes (numeric enum from the git extension)
function gitStatusFromCode(status: number, staged: boolean): string {
  const prefix = staged ? 'staged ' : '';
  switch (status) {
    case 0:  return prefix + 'modified';   // INDEX_MODIFIED
    case 1:  return prefix + 'added';      // INDEX_ADDED
    case 2:  return prefix + 'deleted';    // INDEX_DELETED
    case 3:  return prefix + 'renamed';    // INDEX_RENAMED
    case 4:  return prefix + 'copied';     // INDEX_COPIED
    case 5:  return 'modified';
    case 6:  return 'deleted';
    case 7:  return 'untracked';
    case 8:  return 'ignored';
    case 9:  return 'intent-to-add';
    default: return 'changed';
  }
}

async function handleStreamingChatRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  output: vscode.OutputChannel,
  prompt: string,
  requestedMode: RequestedChatMode | undefined,
  attachActiveFile: boolean,
  modelId?: string
): Promise<void> {
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive'
  });

  res.flushHeaders?.();

  // Subscribe to live document changes and stream them immediately
  const listener: ChangeListener = (change) => {
    writeStreamEvent(res, { type: 'change', file: change });
  };
  changeListeners.add(listener);

  try {
    const nativeOptions = await buildChatOptions(prompt, attachActiveFile, requestedMode, modelId);

    writeStreamEvent(res, {
      type: 'status',
      stage: 'submitted',
      message: 'Prompt submitted to the native VS Code chat panel.'
    });

    const blockOnResponse = nativeOptions.blockOnResponse !== false;

    if (blockOnResponse) {
      writeStreamEvent(res, {
        type: 'status',
        stage: 'awaiting-response',
        message: 'Waiting for Copilot to finish responding in VS Code...'
      });
    }

    const chatResult = await openNativeChat(output, nativeOptions);

    // Check if Copilot returned a tool confirmation instead of a response
    const confirmation = extractConfirmation(chatResult);
    if (confirmation) {
      writeStreamEvent(res, {
        type: 'confirmation',
        toolId: confirmation.toolId,
        message: `Copilot wants to use "${confirmation.toolId}", please confirm on the desktop VS Code.`
      });

      writeStreamEvent(res, {
        type: 'status',
        stage: 'response-complete',
        message: 'Awaiting confirmation on desktop.'
      });

      writeStreamEvent(res, {
        type: 'done',
        note: 'A tool confirmation is pending in VS Code on the desktop.'
      });
    } else {
      // Extract the response text from the chat result when available
      const extracted = extractChatResponse(chatResult);
      if (extracted.text) {
        writeStreamEvent(res, {
          type: 'response',
          text: extracted.text,
          model: extracted.model,
          details: extracted.details
        });
      }

      writeStreamEvent(res, {
        type: 'status',
        stage: 'response-complete',
        message: extracted.text
          ? 'Response received.'
          : blockOnResponse
            ? 'Copilot has finished responding. Check the VS Code chat panel for the full answer.'
            : 'Prompt sent. Check the VS Code chat panel for the response.'
      });

      writeStreamEvent(res, {
        type: 'done',
        note: extracted.text ? undefined : 'The response is in the native VS Code chat panel on the desktop.'
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.appendLine(`Chat request failed: ${message}`);
    writeStreamEvent(res, { type: 'error', message });
    writeStreamEvent(res, { type: 'done' });
  } finally {
    changeListeners.delete(listener);
    res.end();
  }
}



function writeStreamEvent(res: http.ServerResponse, event: StreamEvent): void {
  res.write(`${JSON.stringify(event)}\n`);
}

function extractConfirmation(result: unknown): { toolId: string } | null {
  if (!result || typeof result !== 'object') {
    return null;
  }

  const obj = result as Record<string, unknown>;
  if (obj.type === 'confirmation' && typeof obj.toolId === 'string') {
    return { toolId: obj.toolId };
  }

  return null;
}

function extractChatResponse(result: unknown): { text: string; model?: string; details?: string } {
  const empty = { text: '' };
  if (!result || typeof result !== 'object') {
    return empty;
  }

  const obj = result as Record<string, unknown>;
  const metadata = obj.metadata as Record<string, unknown> | undefined;
  if (!metadata) {
    return empty;
  }

  const rounds = metadata.toolCallRounds as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(rounds) || rounds.length === 0) {
    return empty;
  }

  // Concatenate response text from all rounds
  const parts: string[] = [];
  for (const round of rounds) {
    if (typeof round.response === 'string' && round.response.trim()) {
      parts.push(round.response.trim());
    }
  }

  if (parts.length === 0) {
    return empty;
  }

  return {
    text: parts.join('\n\n'),
    model: typeof metadata.resolvedModel === 'string' ? metadata.resolvedModel : undefined,
    details: typeof obj.details === 'string' ? obj.details : undefined
  };
}

