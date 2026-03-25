import { ref, onUnmounted } from 'vue'
import { apiUrl } from './useApi'

export function useSse(path: string) {
  const events = ref<MessageEvent[]>([])
  let source: EventSource | null = null

  function start(onMessage: (data: unknown) => void) {
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
      stop()
    }
  }

  function stop() {
    if (source) {
      source.close()
      source = null
    }
  }

  onUnmounted(stop)

  return { events, start, stop }
}
