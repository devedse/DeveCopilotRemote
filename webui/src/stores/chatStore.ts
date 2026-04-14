import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ChatMessage, ChatMode, SendPromptPayload, StreamEvent, FileChange } from '@/types'
import { postChatStream, consumeNdjsonStream } from '@/composables/useNdjsonStream'
import { apiFetch } from '@/composables/useApi'

let nextId = 1
function genId(): string {
  return `msg-${nextId++}-${Date.now()}`
}

export const useChatStore = defineStore('chat', () => {
  const messages = ref<ChatMessage[]>([])
  const isSending = ref(false)
  const isLoadingHistory = ref(false)
  const historyError = ref('')

  function addUserMessage(payload: SendPromptPayload): ChatMessage {
    const msg: ChatMessage = {
      id: genId(),
      role: 'user',
      content: payload.prompt,
      timestamp: new Date().toISOString(),
      mode: payload.mode,
      attachedFile: payload.attachActiveFile,
      status: 'done',
      source: 'webui',
    }
    messages.value.push(msg)
    return messages.value[messages.value.length - 1]!
  }

  function addAssistantMessage(): ChatMessage {
    const msg: ChatMessage = {
      id: genId(),
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      status: 'streaming',
      source: 'webui',
      changes: [],
    }
    messages.value.push(msg)
    return messages.value[messages.value.length - 1]!
  }

  function addNativeMessages(parsed: Array<{ role: 'user' | 'assistant'; content: string }>) {
    for (const entry of parsed) {
      messages.value.push({
        id: genId(),
        role: entry.role,
        content: entry.content,
        timestamp: new Date().toISOString(),
        status: 'done',
        source: 'native',
      })
    }
  }

  async function sendPrompt(payload: SendPromptPayload) {
    if (isSending.value) return

    isSending.value = true
    addUserMessage(payload)
    const assistant = addAssistantMessage()

    try {
      const response = await postChatStream(
        payload.prompt,
        payload.mode,
        payload.attachActiveFile,
        payload.model,
      )

      await consumeNdjsonStream(response, (event: StreamEvent) => {
        handleStreamEvent(assistant, event)
      })

      if (assistant.status === 'streaming') {
        assistant.status = 'done'
      }
    } catch (err) {
      assistant.status = 'error'
      assistant.error = err instanceof Error ? err.message : String(err)
      if (!assistant.content) {
        assistant.content = 'Connection lost, the response may have completed in VS Code.'
      }
    } finally {
      isSending.value = false
    }
  }

  function handleStreamEvent(assistant: ChatMessage, event: StreamEvent) {
    switch (event.type) {
      case 'response':
        assistant.content = event.text
        if (event.model) assistant.model = event.model
        break
      case 'status':
        if (event.stage === 'response-complete') {
          assistant.status = 'done'
        }
        break
      case 'confirmation':
        assistant.content = event.message
        assistant.status = 'done'
        break
      case 'change':
        if (!assistant.changes) assistant.changes = []
        assistant.changes.push(event.file)
        break
      case 'error':
        assistant.status = 'error'
        assistant.error = event.message
        if (!assistant.content) {
          assistant.content = 'Failed to submit prompt to VS Code.'
        }
        break
      case 'done':
        if (event.note && !assistant.content) {
          assistant.content = event.note
        }
        if (assistant.status === 'streaming') {
          assistant.status = 'done'
        }
        break
    }
  }

  function clearMessages() {
    messages.value = []
  }

  function keepLastN(n: number) {
    if (messages.value.length > n) {
      messages.value = messages.value.slice(-n)
    }
  }

  async function loadHistory() {
    if (isSending.value || isLoadingHistory.value) return

    isLoadingHistory.value = true
    historyError.value = ''

    try {
      const data = await apiFetch<{
        ok: boolean
        messages?: Array<{ role: 'user' | 'assistant'; content: string }>
        error?: string
        note?: string
      }>('/api/chat/history')

      if (!data.ok) {
        historyError.value = data.error ?? 'Failed to load history.'
        return
      }

      const parsed = data.messages ?? []
      if (parsed.length === 0) {
        historyError.value = data.note ?? 'No chat history found.'
        return
      }

      // Full replace: native chat is the source of truth
      messages.value = parsed.map(entry => ({
        id: genId(),
        role: entry.role,
        content: entry.content,
        timestamp: new Date().toISOString(),
        status: 'done' as const,
        source: 'native' as const,
      }))
    } catch (err) {
      historyError.value = err instanceof Error ? err.message : String(err)
    } finally {
      isLoadingHistory.value = false
    }
  }

  return { messages, isSending, isLoadingHistory, historyError, sendPrompt, addNativeMessages, loadHistory, clearMessages, keepLastN }
})
