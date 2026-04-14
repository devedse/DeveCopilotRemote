<script setup lang="ts">
import { ref } from 'vue'
import { hashPassword } from '@/composables/useApi'
import type { AuthMode } from '@/types'

const props = defineProps<{
  authMode: AuthMode
  error?: string
}>()

const emit = defineEmits<{
  authenticate: [credential: string]
}>()

const input = ref('')
const loading = ref(false)

async function submit() {
  const value = input.value.trim()
  if (!value) return

  loading.value = true

  try {
    let credential: string

    if (props.authMode === 'password') {
      credential = hashPassword(value)

      // Put hash in URL so the link can be bookmarked
      const url = new URL(window.location.href)
      url.searchParams.delete('token')
      url.searchParams.set('passwordHash', credential)
      window.history.replaceState({}, '', url.toString())
    } else {
      credential = value

      const url = new URL(window.location.href)
      url.searchParams.delete('passwordHash')
      url.searchParams.set('token', credential)
      window.history.replaceState({}, '', url.toString())
    }

    emit('authenticate', credential)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex min-h-dvh items-center justify-center p-4">
    <div class="w-full max-w-sm rounded-xl border border-border-default bg-surface-alt p-6 shadow-lg">
      <div class="mb-6 flex flex-col items-center gap-3">
        <img src="/icon.png" alt="DeveCopilotRemote" class="h-14 w-14 rounded-lg" />
        <h1 class="text-lg font-semibold text-gray-100">DeveCopilotRemote</h1>
        <p class="text-center text-sm text-gray-400">
          {{ authMode === 'password' ? 'Enter the password to connect' : 'Enter the access token to connect' }}
        </p>
      </div>

      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <input
          v-model="input"
          :type="authMode === 'password' ? 'password' : 'text'"
          :placeholder="authMode === 'password' ? 'Password' : 'Access token'"
          autocomplete="off"
          autofocus
          class="w-full rounded-lg border border-border-strong bg-surface px-4 py-3 text-sm text-gray-100 placeholder-gray-500 outline-none transition focus:border-brand focus:ring-1 focus:ring-brand"
        />
        <button
          type="submit"
          :disabled="loading || !input.trim()"
          class="rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50 disabled:hover:brightness-100"
        >
          {{ loading ? 'Connecting...' : 'Connect' }}
        </button>
      </form>

      <p v-if="props.error" class="mt-3 text-center text-sm text-danger">{{ props.error }}</p>
    </div>
  </div>
</template>
