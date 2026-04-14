import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiFetch, getToken } from '@/composables/useApi'
import type { StatusResponse, ChatMode, ChatModel, ModelsResponse, AuthMode } from '@/types'

export const useConnectionStore = defineStore('connection', () => {
  const connected = ref(false)
  const authenticated = ref(false)
  const authMode = ref<AuthMode>('token')
  const defaultMode = ref<ChatMode>('current')
  const modeOptions = ref<ChatMode[]>(['current', 'ask', 'edit', 'agent'])
  const models = ref<ChatModel[]>([])

  /** Fetch public status info (no auth required). */
  async function fetchAuthInfo() {
    try {
      const resp = await fetch('/api/status')
      const data = await resp.json() as StatusResponse
      authMode.value = data.authMode ?? 'token'
      defaultMode.value = data.defaultMode ?? 'current'
      modeOptions.value = data.modeOptions ?? ['current', 'ask', 'edit', 'agent']
    } catch {
      // Defaults are fine
    }
  }

  /** Verify stored credential and connect. Returns true if authenticated. */
  async function verifyAndConnect(): Promise<boolean> {
    const credential = getToken()
    if (!credential) {
      authenticated.value = false
      connected.value = false
      return false
    }

    try {
      const data = await apiFetch<ModelsResponse>('/api/models')
      if (data.ok) {
        authenticated.value = true
        connected.value = true
        if (data.models) {
          models.value = data.models
        }
        return true
      }
    } catch {
      // 401 or network error
    }

    authenticated.value = false
    connected.value = false
    return false
  }

  /** Full initialization: fetch auth info, then verify credentials. */
  async function initialize() {
    await fetchAuthInfo()
    await verifyAndConnect()
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

  function logout() {
    authenticated.value = false
    connected.value = false
  }

  return { connected, authenticated, authMode, defaultMode, modeOptions, models, fetchAuthInfo, verifyAndConnect, initialize, loadModels, logout }
})
