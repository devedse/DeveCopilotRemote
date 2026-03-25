<script setup lang="ts">
defineProps<{
  filePath: string
  status: string
  selected?: boolean
}>()

const emit = defineEmits<{
  select: [path: string, status: string]
}>()

const statusClass: Record<string, string> = {
  modified: 'bg-yellow-900/50 text-yellow-300',
  added: 'bg-green-900/50 text-green-300',
  deleted: 'bg-red-900/50 text-red-300',
  renamed: 'bg-blue-900/50 text-blue-300',
  untracked: 'bg-gray-700/50 text-gray-300',
  conflict: 'bg-orange-900/50 text-orange-300',
}

function badgeClass(status: string): string {
  const base = status.replace(/^staged\s+/, '')
  return statusClass[base] ?? 'bg-gray-700/50 text-gray-400'
}
</script>

<template>
  <button
    type="button"
    class="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs transition-colors"
    :class="selected ? 'bg-brand-soft text-brand' : 'text-gray-300 hover:bg-surface-hover'"
    @click="emit('select', filePath, status)"
  >
    <span
      class="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold"
      :class="badgeClass(status)"
    >
      {{ status.replace(/^staged\s+/, '').charAt(0).toUpperCase() }}
    </span>
    <span class="min-w-0 flex-1 truncate">{{ filePath }}</span>
    <span class="shrink-0 text-[10px] text-gray-500">{{ status }}</span>
  </button>
</template>
