import { randomBytes } from 'crypto';
import * as http from 'http';
import { networkInterfaces } from 'os';
import * as path from 'path';
import { promises as fs } from 'fs';
import * as vscode from 'vscode';

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

type FileChange = {
  path: string;
  status: string;
  diff: string;
};

type ChangeListener = (change: FileChange) => void;

type StreamEvent =
  | { type: 'status'; stage: 'submitted' | 'awaiting-response' | 'response-complete'; message: string }
  | { type: 'change'; file: FileChange }
  | { type: 'error'; message: string }
  | { type: 'done'; note?: string };

const OPEN_CHAT_COMMAND = 'workbench.action.chat.open';
const SEND_PROMPT_COMMAND = 'deveCopilotRemote.sendPromptToChat';
const SUMMARIZE_ACTIVE_FILE_COMMAND = 'deveCopilotRemote.summarizeActiveFile';
const OPEN_WEB_UI_COMMAND = 'deveCopilotRemote.openWebUi';
const COPY_WEB_UI_URL_COMMAND = 'deveCopilotRemote.copyWebUiUrl';

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
      await vscode.env.openExternal(vscode.Uri.parse(state.localUrl));
      vscode.window.showInformationMessage('DeveCopilotRemote web UI opened in your browser.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COPY_WEB_UI_URL_COMMAND, async () => {
      const state = await ensureWebUiServerStarted(context, output);
      const bestUrl = state.externalUrl ?? state.localUrl;
      await vscode.env.clipboard.writeText(bestUrl);
      vscode.window.showInformationMessage(`Copied DeveCopilotRemote URL: ${bestUrl}`);
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

export function deactivate(): void {}

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

    writeJson(res, 200, {
      ok: true,
      appName: 'DeveCopilotRemote',
      defaultMode,
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

    req.on('close', () => {
      changeListeners.delete(listener);
      res.end();
    });
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

    writeJson(res, 200, {
      ok: true,
      submitted: true,
      result: normalizeResult(result),
      note: 'The response is rendered in the native VS Code chat panel.'
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
    const requestedPath = path.normalize(path.join(mediaRoot, url.pathname.replace(/^\/+/, '')));
    if (!requestedPath.startsWith(mediaRoot)) {
      writeJson(res, 403, { ok: false, error: 'Forbidden.' });
      return;
    }

    await serveStaticFile(res, requestedPath);
    return;
  }

  writeJson(res, 404, { ok: false, error: 'Not found.' });
}

function isAuthorized(req: http.IncomingMessage, url: URL, token: string): boolean {
  const headerToken = req.headers['x-devecopilotremote-token'];
  const queryToken = url.searchParams.get('token');

  return headerToken === token || queryToken === token;
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

    await openNativeChat(output, nativeOptions);

    writeStreamEvent(res, {
      type: 'status',
      stage: 'response-complete',
      message: blockOnResponse
        ? 'Copilot has finished responding. Check the VS Code chat panel for the full answer.'
        : 'Prompt sent. Check the VS Code chat panel for the response.'
    });

    writeStreamEvent(res, {
      type: 'done',
      note: 'The response is in the native VS Code chat panel on the desktop.'
    });
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

