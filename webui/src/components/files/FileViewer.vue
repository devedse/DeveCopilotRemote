<script setup lang="ts">
import type { FileContentResponse } from '@/types'

defineProps<{
  file: FileContentResponse
}>()

const emit = defineEmits<{
  close: []
}>()
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex items-center justify-between border-b border-border-default px-4 py-2">
      <div class="flex items-center gap-2">
        <span class="text-xs font-medium text-gray-200">{{ file.name }}</span>
        <span class="text-[10px] text-gray-500">{{ (file.size / 1024).toFixed(1) }} KB</span>
      </div>
      <button
        type="button"
        class="rounded-md px-2 py-1 text-xs text-gray-400 hover:bg-surface-hover hover:text-gray-200"
        @click="emit('close')"
      >
        ✕
      </button>
    </div>
    <pre class="flex-1 overflow-auto p-4 text-xs leading-relaxed text-gray-300">{{ file.content }}</pre>
  </div>
</template>
