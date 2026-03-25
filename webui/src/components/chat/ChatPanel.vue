<script setup lang="ts">
import MessageList from './MessageList.vue'
import ChatComposer from './ChatComposer.vue'
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Panel header -->
    <header class="flex items-center justify-between border-b border-border-default px-4 py-3">
      <div>
        <p class="text-[10px] font-medium uppercase tracking-wider text-gray-500">Session</p>
        <h2 class="text-sm font-semibold text-gray-100">Chat</h2>
      </div>
      <div class="flex gap-1.5">
        <span class="rounded-md bg-surface-hover px-2 py-0.5 text-[10px] text-gray-400">Native panel</span>
        <span class="rounded-md bg-surface px-2 py-0.5 text-[10px] text-gray-500">Ask, Edit, Agent</span>
      </div>
    </header>

    <!-- Messages -->
    <MessageList />

    <!-- Composer -->
    <ChatComposer />
  </div>
</template>
