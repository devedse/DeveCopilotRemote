<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'

const props = defineProps<{
  message: string
  type: 'success' | 'error'
}>()

const visible = ref(true)
let timer: ReturnType<typeof setTimeout>

function hide() {
  visible.value = false
}

watch(
  () => props.message,
  () => {
    visible.value = true
    clearTimeout(timer)
    timer = setTimeout(hide, 3200)
  },
  { immediate: true },
)

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <Transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="translate-y-2 opacity-0"
    enter-to-class="translate-y-0 opacity-100"
    leave-active-class="transition duration-150 ease-in"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div
      v-if="visible"
      role="status"
      class="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm font-medium shadow-lg"
      :class="type === 'error' ? 'bg-red-900/90 text-red-200' : 'bg-green-900/90 text-green-200'"
    >
      {{ message }}
    </div>
  </Transition>
</template>
