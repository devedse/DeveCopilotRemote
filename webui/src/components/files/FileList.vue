<script setup lang="ts">
import type { FileEntry } from '@/types'

defineProps<{
  entries: FileEntry[]
  currentPath: string
  selectedPath?: string
}>()

const emit = defineEmits<{
  openDir: [path: string]
  openFile: [path: string]
}>()

function parentPath(current: string): string {
  if (!current.includes('/')) return '.'
  return current.substring(0, current.lastIndexOf('/'))
}
</script>

<template>
  <div class="space-y-0.5 p-2">
    <!-- Parent directory -->
    <button
      v-if="currentPath !== '.'"
      type="button"
      class="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs text-gray-400 hover:bg-surface-hover hover:text-gray-200"
      @click="emit('openDir', parentPath(currentPath))"
    >
      <span class="text-base">📁</span>
      <span>..</span>
    </button>

    <button
      v-for="entry in entries"
      :key="entry.path"
      type="button"
      class="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs transition-colors"
      :class="selectedPath === entry.path ? 'bg-brand-soft text-brand' : 'text-gray-300 hover:bg-surface-hover hover:text-gray-100'"
      @click="entry.type === 'directory' ? emit('openDir', entry.path) : emit('openFile', entry.path)"
    >
      <span class="text-base">{{ entry.type === 'directory' ? '📁' : '📄' }}</span>
      <span class="truncate">{{ entry.name }}</span>
    </button>

    <p v-if="entries.length === 0" class="px-3 py-4 text-center text-xs text-gray-500">
      Empty directory
    </p>
  </div>
</template>
