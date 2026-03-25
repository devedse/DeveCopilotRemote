import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiFetch } from '@/composables/useApi'
import type { StatusResponse, ChatMode, ChatModel, ModelsResponse } from '@/types'

export const useConnectionStore = defineStore('connection', () => {
  const connected = ref(false)
  const defaultMode = ref<ChatMode>('current')
  const modeOptions = ref<ChatMode[]>(['current', 'ask', 'edit', 'agent'])
  const models = ref<ChatModel[]>([])

  async function initialize() {
    try {
      const status = await apiFetch<StatusResponse>('/api/status')
      if (status.ok) {
        connected.value = true
        defaultMode.value = status.defaultMode
        modeOptions.value = status.modeOptions
      }
    } catch {
      connected.value = false
    }
  }

  async function loadModels() {
    try {
      const data = await apiFetch<ModelsResponse>('/api/models')
      if (data.ok && data.models) {
        models.value = data.models
      }
    } catch {
      // Models not available
    }
  }

  return { connected, defaultMode, modeOptions, models, initialize, loadModels }
})
