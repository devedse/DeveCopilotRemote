<script setup lang="ts">
export interface Tab {
  id: string
  label: string
  icon: string
}

defineProps<{
  tabs: Tab[]
  activeTab: string
}>()

const emit = defineEmits<{
  select: [id: string]
}>()
</script>

<template>
  <aside class="flex gap-1 rounded-xl border border-border-default bg-surface-alt p-1 shadow-lg sm:flex-col sm:w-auto">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      type="button"
      class="flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors sm:flex-initial sm:justify-start"
      :class="
        activeTab === tab.id
          ? 'bg-brand-soft text-brand'
          : 'text-gray-400 hover:bg-surface-hover hover:text-gray-200'
      "
      @click="emit('select', tab.id)"
    >
      <span class="text-base">{{ tab.icon }}</span>
      <span>{{ tab.label }}</span>
    </button>
  </aside>
</template>
