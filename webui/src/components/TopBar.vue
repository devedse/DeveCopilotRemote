<script setup lang="ts">
import { useConnectionStore } from '@/stores/connectionStore'

const connection = useConnectionStore()
</script>

<template>
  <header class="flex items-center justify-between gap-4 rounded-xl border border-border-default bg-surface-alt px-4 py-3 shadow-lg">
    <div class="flex items-center gap-3">
      <div class="grid h-10 w-10 place-items-center rounded-lg bg-gradient-to-br from-blue-600 to-brand font-extrabold tracking-wide text-white">
        DC
      </div>
      <div>
        <p class="text-xs font-medium uppercase tracking-wider text-gray-500">Remote control</p>
        <h1 class="text-sm font-semibold text-gray-100">DeveCopilotRemote</h1>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <span
        class="inline-block h-2 w-2 rounded-full"
        :class="connection.connected ? 'bg-success animate-pulse' : 'bg-danger'"
      />
      <span class="text-xs text-gray-400">
        {{ connection.connected ? 'Connected' : 'Connecting...' }}
      </span>
    </div>
  </header>
</template>
