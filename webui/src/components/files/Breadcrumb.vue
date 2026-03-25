<script setup lang="ts">
defineProps<{
  path: string
}>()

const emit = defineEmits<{
  navigate: [path: string]
}>()

function segments(p: string): Array<{ label: string; path: string }> {
  const parts = p.split('/')
  const result: Array<{ label: string; path: string }> = [{ label: 'root', path: '.' }]
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (part === '.' || !part) continue
    result.push({
      label: part,
      path: parts.slice(0, i + 1).join('/'),
    })
  }
  return result
}
</script>

<template>
  <nav class="flex flex-wrap items-center gap-1 px-4 py-2 text-xs">
    <template v-for="(seg, i) in segments(path)" :key="seg.path">
      <span v-if="i > 0" class="text-gray-600">/</span>
      <button
        type="button"
        class="rounded px-1.5 py-0.5 text-gray-400 transition-colors hover:bg-surface-hover hover:text-gray-200"
        @click="emit('navigate', seg.path)"
      >
        {{ seg.label }}
      </button>
    </template>
  </nav>
</template>
