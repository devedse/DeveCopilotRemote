<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useChangesStore } from '@/stores/changesStore'
import { apiFetch } from '@/composables/useApi'
import { useSse } from '@/composables/useSse'
import ChangeRow from './ChangeRow.vue'
import DiffViewer from './DiffViewer.vue'
import type { FileChange } from '@/types'

const changesStore = useChangesStore()
const { start: startSse, stop: stopSse } = useSse('/api/changes')

const selectedPath = ref('')
const selectedStatus = ref('')
const diffContent = ref('')
const diffLoading = ref(false)

onMounted(() => {
  changesStore.loadGitStatus()
  startSse((data: unknown) => {
    changesStore.addLiveChange(data as FileChange)
  })
})

onUnmounted(() => {
  stopSse()
})

async function selectFile(path: string, status: string) {
  selectedPath.value = path
  selectedStatus.value = status
  diffLoading.value = true
  diffContent.value = ''

  try {
    const data = await apiFetch<{ ok: boolean; diff?: string; error?: string }>(
      `/api/git/diff?path=${encodeURIComponent(path)}`,
    )
    diffContent.value = data.diff ?? 'No diff available.'
  } catch {
    diffContent.value = 'Could not load diff.'
  } finally {
    diffLoading.value = false
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Panel header -->
    <header class="flex items-center justify-between border-b border-border-default px-4 py-3">
      <div>
        <p class="text-[10px] font-medium uppercase tracking-wider text-gray-500">Source control</p>
        <h2 class="text-sm font-semibold text-gray-100">Changes</h2>
      </div>
      <div class="flex items-center gap-2">
        <span v-if="changesStore.branch" class="rounded-md bg-surface px-2 py-0.5 text-[10px] text-gray-500">
          {{ changesStore.branch }}
        </span>
        <button
          type="button"
          class="rounded-md px-2 py-1 text-xs text-gray-400 hover:bg-surface-hover hover:text-gray-200"
          @click="changesStore.loadGitStatus()"
        >
          ↻
        </button>
      </div>
    </header>

    <!-- File list -->
    <div class="overflow-y-auto border-b border-border-default p-2" :class="selectedPath ? 'max-h-48 sm:max-h-64' : 'flex-1'">
      <!-- Git changes -->
      <p class="mb-1 px-2 text-[10px] font-medium uppercase tracking-wider text-gray-500">Uncommitted changes</p>
      <div v-if="changesStore.isLoading" class="px-3 py-2 text-xs text-gray-500">Loading...</div>
      <div v-else-if="changesStore.gitError" class="px-3 py-2 text-xs text-gray-500">{{ changesStore.gitError }}</div>
      <div v-else-if="changesStore.gitFiles.length === 0" class="px-3 py-2 text-xs text-gray-500">Working tree clean</div>
      <div v-else class="space-y-0.5">
        <ChangeRow
          v-for="file in changesStore.gitFiles"
          :key="file.path"
          :file-path="file.path"
          :status="file.status"
          :selected="selectedPath === file.path"
          @select="selectFile"
        />
      </div>

      <!-- Live edits -->
      <p class="mb-1 mt-4 flex items-center gap-1.5 px-2 text-[10px] font-medium uppercase tracking-wider text-gray-500">
        Live edits
        <span class="inline-block h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
      </p>
      <div v-if="changesStore.liveChanges.length === 0" class="px-3 py-2 text-xs text-gray-500">No live edits yet</div>
      <div v-else class="space-y-0.5">
        <ChangeRow
          v-for="(change, i) in changesStore.liveChanges"
          :key="i"
          :file-path="change.path"
          :status="change.status"
          :selected="selectedPath === change.path"
          @select="selectFile"
        />
      </div>
    </div>

    <!-- Diff viewer (always below) -->
    <div v-if="selectedPath" class="flex-1 overflow-y-auto p-3">
      <div class="mb-2 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-gray-200">{{ selectedPath }}</span>
          <span class="text-[10px] text-gray-500">{{ selectedStatus }}</span>
        </div>
        <button
          type="button"
          class="rounded-md px-2 py-1 text-xs text-gray-400 hover:bg-surface-hover hover:text-gray-200"
          @click="selectedPath = ''; diffContent = ''"
        >
          ✕
        </button>
      </div>
      <div v-if="diffLoading" class="text-xs text-gray-500">Loading diff...</div>
      <DiffViewer v-else :diff="diffContent" />
    </div>
  </div>
</template>
