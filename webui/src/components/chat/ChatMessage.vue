<script setup lang="ts">
import { computed } from 'vue'
import { useMarkdown } from '@/composables/useMarkdown'
import { useChatStore } from '@/stores/chatStore'
import type { ChatMessage } from '@/types'

const props = defineProps<{
  message: ChatMessage
}>()

const chatStore = useChatStore()
const { render } = useMarkdown()

const renderedContent = computed(() => {
  if (props.message.role === 'assistant') {
    return render(props.message.content)
  }
  return ''
})

const formattedTime = computed(() => {
  try {
    return new Date(props.message.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
})
</script>

<template>
  <article
    class="flex gap-3 px-4 py-3"
    :class="{
      'bg-surface/40': message.role === 'assistant',
    }"
  >
    <!-- Avatar -->
    <div
      class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold"
      :class="
        message.role === 'user'
          ? 'bg-blue-900/50 text-blue-300'
          : 'bg-purple-900/50 text-purple-300'
      "
    >
      {{ message.role === 'user' ? 'You' : '✦' }}
    </div>

    <!-- Body -->
    <div class="min-w-0 flex-1">
      <!-- Header -->
      <div class="mb-1 flex items-center gap-2">
        <span class="text-xs font-semibold text-gray-200">
          {{ message.role === 'user' ? 'You' : 'GitHub Copilot' }}
        </span>
        <span v-if="message.source === 'native'" class="rounded bg-indigo-900/50 px-1.5 py-0.5 text-[10px] text-indigo-300">
          native
        </span>
        <span class="text-[10px] text-gray-500">{{ formattedTime }}</span>
        <span
          v-if="message.status === 'streaming'"
          class="text-[10px] text-brand animate-pulse"
        >
          Streaming...
        </span>
        <span v-if="message.model" class="text-[10px] text-gray-500">
          {{ message.model }}
        </span>
      </div>

      <!-- Content -->
      <div v-if="message.role === 'user'" class="text-sm text-gray-200 whitespace-pre-wrap">
        {{ message.content }}
      </div>
      <div
        v-else
        class="markdown-body text-sm text-gray-300"
        v-html="renderedContent"
      />

      <!-- Error -->
      <div v-if="message.status === 'error' && message.error" class="mt-2 rounded-md bg-red-950/50 px-3 py-2 text-xs text-red-300">
        <span>{{ message.error }}</span>
        <button
          v-if="message.role === 'assistant'"
          type="button"
          class="ml-2 inline-flex items-center gap-1 rounded bg-red-900/60 px-2 py-0.5 font-medium text-red-200 transition-colors hover:bg-red-800/70 disabled:opacity-40"
          :disabled="chatStore.isLoadingHistory"
          @click="chatStore.loadHistory()"
        >
          {{ chatStore.isLoadingHistory ? 'Loading…' : '↻ History' }}
        </button>
      </div>

      <!-- File changes -->
      <div v-if="message.changes?.length" class="mt-2 space-y-1">
        <details
          v-for="(change, i) in message.changes"
          :key="i"
          class="rounded-md border border-border-default bg-gray-950/50"
        >
          <summary class="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs">
            <span
              class="inline-flex h-4 w-4 items-center justify-center rounded text-[10px] font-bold"
              :class="{
                'bg-green-900/50 text-green-300': change.status === 'added',
                'bg-red-900/50 text-red-300': change.status === 'deleted',
                'bg-yellow-900/50 text-yellow-300': change.status === 'modified',
                'bg-blue-900/50 text-blue-300': change.status === 'renamed',
              }"
            >
              {{ change.status.charAt(0).toUpperCase() }}
            </span>
            <span class="text-gray-300">{{ change.path }}</span>
          </summary>
          <pre class="max-h-60 overflow-auto px-3 py-2 text-xs leading-relaxed"><span
              v-for="(line, j) in change.diff.split('\n')"
              :key="j"
              class="block"
              :class="{
                'diff-line--added': line.startsWith('+') && !line.startsWith('+++'),
                'diff-line--removed': line.startsWith('-') && !line.startsWith('---'),
                'diff-line--hunk': line.startsWith('@@'),
                'diff-line--meta': line.startsWith('+++') || line.startsWith('---'),
              }"
            >{{ line }}</span></pre>
        </details>
      </div>
    </div>
  </article>
</template>
