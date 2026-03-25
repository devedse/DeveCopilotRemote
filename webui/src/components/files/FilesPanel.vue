<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue'
import { useFilesStore } from '@/stores/filesStore'
import Breadcrumb from './Breadcrumb.vue'
import FileList from './FileList.vue'
import FileViewer from './FileViewer.vue'

const filesStore = useFilesStore()
const fileListContainer = ref<HTMLElement | null>(null)
let savedScrollTop = 0

// Preserve scroll position when the container resizes due to viewer opening
watch(() => filesStore.viewerFile, async (newVal, oldVal) => {
  if (newVal && !oldVal) {
    // Viewer opening — save scroll position before resize
    savedScrollTop = fileListContainer.value?.scrollTop ?? 0
    await nextTick()
    if (fileListContainer.value) {
      fileListContainer.value.scrollTop = savedScrollTop
    }
  }
})

onMounted(() => {
  filesStore.loadDirectory('.')
})
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Panel header -->
    <header class="border-b border-border-default px-4 py-3">
      <p class="text-[10px] font-medium uppercase tracking-wider text-gray-500">Workspace</p>
      <h2 class="text-sm font-semibold text-gray-100">Files</h2>
    </header>

    <!-- Breadcrumb -->
    <Breadcrumb :path="filesStore.currentPath" @navigate="filesStore.loadDirectory" />

    <!-- Directory listing (always visible) -->
    <div ref="fileListContainer" class="overflow-y-auto border-b border-border-default" :class="filesStore.viewerFile ? 'max-h-48 sm:max-h-64' : 'flex-1'">
      <div v-if="filesStore.isLoading" class="p-4 text-xs text-gray-500">Loading...</div>
      <div v-else-if="filesStore.error" class="p-4 text-xs text-gray-500">{{ filesStore.error }}</div>
      <FileList
        v-else
        :entries="filesStore.entries"
        :current-path="filesStore.currentPath"
        :selected-path="filesStore.viewerFile?.path ?? ''"
        @open-dir="(p) => { filesStore.closeViewer(); filesStore.loadDirectory(p) }"
        @open-file="filesStore.openFile"
      />
    </div>

    <!-- File viewer (below) -->
    <FileViewer
      v-if="filesStore.viewerFile"
      class="flex-1"
      :file="filesStore.viewerFile"
      @close="filesStore.closeViewer()"
    />
  </div>
</template>
