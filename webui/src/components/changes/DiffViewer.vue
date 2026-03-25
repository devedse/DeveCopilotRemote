<script setup lang="ts">
defineProps<{
  diff: string
}>()
</script>

<template>
  <pre class="overflow-auto rounded-md bg-gray-950/60 px-3 py-2 text-xs leading-relaxed"><span
      v-for="(line, i) in diff.split('\n')"
      :key="i"
      class="block"
      :class="{
        'diff-line--added': line.startsWith('+') && !line.startsWith('+++'),
        'diff-line--removed': line.startsWith('-') && !line.startsWith('---'),
        'diff-line--hunk': line.startsWith('@@'),
        'diff-line--meta': line.startsWith('+++') || line.startsWith('---'),
      }"
    >{{ line }}</span></pre>
</template>
