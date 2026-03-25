<script setup lang="ts">
import { ref, computed } from 'vue'
import { useConnectionStore } from '@/stores/connectionStore'
import { useChatStore } from '@/stores/chatStore'
import type { ChatMode, SendPromptPayload } from '@/types'

const connection = useConnectionStore()
const chatStore = useChatStore()

const prompt = ref('')
const mode = ref<ChatMode>(connection.defaultMode)
const model = ref('')
const attachActiveFile = ref(false)

const charCount = computed(() => `${prompt.value.length} / 12000`)
const canSend = computed(() => prompt.value.trim().length > 0 && !chatStore.isSending)

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    submit()
  }
}

function submit() {
  const text = prompt.value.trim()
  if (!text || chatStore.isSending) return

  const payload: SendPromptPayload = {
    prompt: text,
    mode: mode.value,
    attachActiveFile: attachActiveFile.value,
    model: model.value || undefined,
  }

  prompt.value = ''
  chatStore.sendPrompt(payload)
}

function clear() {
  prompt.value = ''
}
</script>

<template>
  <form class="border-t border-border-default bg-surface-alt p-3" @submit.prevent="submit">
    <!-- Toolbar -->
    <div class="mb-2 flex flex-wrap items-center gap-2">
      <label class="flex items-center gap-1.5 text-xs text-gray-400">
        <span>Mode</span>
        <select
          v-model="mode"
          class="rounded-md border border-border-default bg-surface px-2 py-1 text-xs text-gray-200 outline-none focus:border-brand"
        >
          <option v-for="opt in connection.modeOptions" :key="opt" :value="opt">
            {{ opt === 'current' ? 'VS Code current' : opt.charAt(0).toUpperCase() + opt.slice(1) }}
          </option>
        </select>
      </label>

      <label v-if="connection.models.length > 0" class="flex items-center gap-1.5 text-xs text-gray-400">
        <span>Model</span>
        <select
          v-model="model"
          class="rounded-md border border-border-default bg-surface px-2 py-1 text-xs text-gray-200 outline-none focus:border-brand"
        >
          <option value="">Default</option>
          <option v-for="m in connection.models" :key="m.id" :value="m.id">
            {{ m.name || m.id }}
          </option>
        </select>
      </label>

      <label class="flex cursor-pointer items-center gap-1.5 text-xs text-gray-400">
        <input
          v-model="attachActiveFile"
          type="checkbox"
          class="h-3.5 w-3.5 rounded border-border-default bg-surface text-brand accent-brand"
        />
        <span>Attach active file</span>
      </label>
    </div>

    <!-- Input -->
    <textarea
      v-model="prompt"
      rows="2"
      maxlength="12000"
      placeholder="Message Copilot Chat..."
      class="w-full resize-y rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-gray-200 placeholder-gray-500 outline-none focus:border-brand"
      @keydown="onKeydown"
    />

    <!-- Footer -->
    <div class="mt-2 flex items-center justify-between">
      <span class="text-[10px] text-gray-500">{{ charCount }}</span>
      <div class="flex gap-2">
        <button
          type="button"
          class="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:bg-surface-hover hover:text-gray-200"
          :disabled="chatStore.isSending"
          @click="clear"
        >
          Clear
        </button>
        <button
          type="submit"
          class="rounded-lg bg-brand px-4 py-1.5 text-xs font-semibold text-white transition-opacity disabled:opacity-40"
          :disabled="!canSend"
        >
          {{ chatStore.isSending ? 'Sending...' : 'Send' }}
        </button>
      </div>
    </div>
  </form>
</template>
