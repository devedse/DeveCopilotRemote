// ── Chat ──

export type MessageRole = 'user' | 'assistant'
export type MessageStatus = 'streaming' | 'done' | 'error'
export type MessageSource = 'webui' | 'native'

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  timestamp: string
  mode?: string
  model?: string
  attachedFile?: boolean
  status: MessageStatus
  error?: string
  changes?: FileChange[]
  source: MessageSource
}

export type ChatMode = 'current' | 'ask' | 'edit' | 'agent'

export interface ChatModel {
  id: string
  name: string
  vendor?: string
  family?: string
  version?: string
  maxInputTokens?: number
}

export interface SendPromptPayload {
  prompt: string
  mode: ChatMode
  attachActiveFile: boolean
  model?: string
}

// ── Stream events (from server NDJSON) ──

export type StreamEvent =
  | { type: 'status'; stage: 'submitted' | 'awaiting-response' | 'response-complete'; message: string }
  | { type: 'response'; text: string; model?: string; details?: string }
  | { type: 'confirmation'; toolId: string; message: string }
  | { type: 'change'; file: FileChange }
  | { type: 'error'; message: string }
  | { type: 'done'; note?: string }

// ── Changes ──

export interface FileChange {
  path: string
  status: string
  diff: string
}

export interface GitRepoStatus {
  repoName: string
  branch: string
  files: Array<{ path: string; status: string }>
}

export interface GitStatusResponse {
  ok: boolean
  repos?: GitRepoStatus[]
  error?: string
}

// ── Files ──

export interface FileEntry {
  name: string
  type: 'file' | 'directory'
  path: string
}

export interface DirectoryResponse {
  ok: boolean
  path: string
  items: FileEntry[]
  error?: string
}

export interface FileContentResponse {
  ok: boolean
  path: string
  name: string
  extension: string
  size: number
  content: string
  error?: string
}

// ── Status ──

export type AuthMode = 'token' | 'password'

export interface StatusResponse {
  ok: boolean
  appName: string
  defaultMode: ChatMode
  authMode: AuthMode
  modeOptions: ChatMode[]
  features: {
    chat: boolean
    checkedOutFiles: boolean
    files: boolean
  }
}

export interface ModelsResponse {
  ok: boolean
  models: ChatModel[]
}
