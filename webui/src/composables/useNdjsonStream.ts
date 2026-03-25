import type { StreamEvent } from '@/types'
import { getToken } from './useApi'

export async function consumeNdjsonStream(
  response: Response,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  const body = response.body
  if (!body) throw new Error('No response body for streaming')

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        onEvent(JSON.parse(trimmed) as StreamEvent)
      } catch {
        // Skip malformed lines
      }
    }
  }

  // Process remaining buffer
  if (buffer.trim()) {
    try {
      onEvent(JSON.parse(buffer.trim()) as StreamEvent)
    } catch {
      // Ignore
    }
  }
}

export async function postChatStream(
  prompt: string,
  mode: string,
  attachActiveFile: boolean,
  model?: string,
): Promise<Response> {
  const token = getToken()
  const body: Record<string, unknown> = { prompt, mode, attachActiveFile }
  if (model) body.model = model

  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-DeveCopilotRemote-Token': token,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error((payload as { error?: string }).error ?? 'Failed to submit prompt.')
  }

  return response
}
