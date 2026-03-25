import { ref, onUnmounted } from 'vue'
import { apiUrl } from './useApi'

export function useSse(path: string) {
  const events = ref<MessageEvent[]>([])
  let source: EventSource | null = null
  let lastCallback: ((data: unknown) => void) | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined

  function start(onMessage: (data: unknown) => void) {
    lastCallback = onMessage
    stop()
    source = new EventSource(apiUrl(path))
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        onMessage(data)
      } catch {
        // Ignore parse errors
      }
    }
    source.onerror = () => {
      // Auto-reconnect after 3 seconds
      if (source) {
        source.close()
        source = null
      }
      reconnectTimer = setTimeout(() => {
        if (lastCallback) start(lastCallback)
      }, 3000)
    }
  }

  function stop() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = undefined
    }
    if (source) {
      source.close()
      source = null
    }
  }

  onUnmounted(stop)

  return { events, start, stop }
}
