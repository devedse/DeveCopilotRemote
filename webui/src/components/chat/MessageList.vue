<script setup lang="ts">
import { ref, nextTick, watch } from 'vue'
import { useChatStore } from '@/stores/chatStore'
import ChatMessage from './ChatMessage.vue'

const chatStore = useChatStore()
const scrollContainer = ref<HTMLElement>()

function scrollToBottom() {
  nextTick(() => {
    if (scrollContainer.value) {
      scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight
    }
  })
}

watch(
  () => chatStore.messages.length,
  () => scrollToBottom(),
)

// Also scroll when the last message content updates (streaming)
watch(
  () => {
    const msgs = chatStore.messages
    const last = msgs[msgs.length - 1]
    return last?.content?.length ?? 0
  },
  () => scrollToBottom(),
)
</script>

<template>
  <div ref="scrollContainer" class="flex-1 overflow-y-auto">
    <div v-if="chatStore.messages.length === 0" class="flex h-full items-center justify-center p-8">
      <div class="text-center">
        <p class="text-lg font-medium text-gray-400">No prompts yet</p>
        <p class="mt-1 text-sm text-gray-500">
          Send a prompt from the composer below to start.
        </p>
      </div>
    </div>
    <div v-else class="divide-y divide-border-default">
      <ChatMessage
        v-for="msg in chatStore.messages"
        :key="msg.id"
        :message="msg"
      />
    </div>
  </div>
</template>
