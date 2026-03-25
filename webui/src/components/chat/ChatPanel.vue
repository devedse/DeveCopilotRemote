<script setup lang="ts">
import { useChatStore } from '@/stores/chatStore'
import MessageList from './MessageList.vue'
import ChatComposer from './ChatComposer.vue'

const chatStore = useChatStore()
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Panel header -->
    <header class="flex items-center justify-between border-b border-border-default px-4 py-3">
      <div>
        <p class="text-[10px] font-medium uppercase tracking-wider text-gray-500">Session</p>
        <h2 class="text-sm font-semibold text-gray-100">Chat</h2>
      </div>
      <div class="flex items-center gap-1.5">
        <button
          type="button"
          class="rounded-md px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-surface-hover hover:text-gray-200 disabled:opacity-40"
          :disabled="chatStore.isSending || chatStore.isLoadingHistory"
          @click="chatStore.loadHistory()"
        >
          {{ chatStore.isLoadingHistory ? 'Loading…' : '↻ History' }}
        </button>
        <button
          type="button"
          class="rounded-md px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-surface-hover hover:text-gray-200 disabled:opacity-40"
          :disabled="chatStore.messages.length === 0"
          @click="chatStore.keepLastN(5)"
        >
          Keep 5
        </button>
        <button
          type="button"
          class="rounded-md px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-surface-hover hover:text-gray-200 disabled:opacity-40"
          :disabled="chatStore.messages.length === 0"
          @click="chatStore.clearMessages()"
        >
          Clear
        </button>
      </div>
    </header>

    <!-- History error -->
    <div v-if="chatStore.historyError" class="border-b border-border-default bg-yellow-900/20 px-4 py-2 text-xs text-yellow-300">
      {{ chatStore.historyError }}
    </div>

    <!-- Messages -->
    <MessageList />

    <!-- Composer -->
    <ChatComposer />
  </div>
</template>
