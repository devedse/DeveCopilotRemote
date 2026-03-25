import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiFetch } from '@/composables/useApi'
import type { FileChange, GitStatusResponse } from '@/types'

export const useChangesStore = defineStore('changes', () => {
  const branch = ref('')
  const gitFiles = ref<Array<{ path: string; status: string }>>([])
  const liveChanges = ref<FileChange[]>([])
  const gitError = ref('')
  const isLoading = ref(false)

  async function loadGitStatus() {
    isLoading.value = true
    gitError.value = ''
    try {
      const data = await apiFetch<GitStatusResponse>('/api/git/status')
      if (data.ok) {
        branch.value = data.branch ?? ''
        gitFiles.value = data.files ?? []
        if (data.error) gitError.value = data.error
      }
    } catch (err) {
      gitError.value = err instanceof Error ? err.message : 'Failed to load git status.'
    } finally {
      isLoading.value = false
    }
  }

  function addLiveChange(change: FileChange) {
    liveChanges.value.push(change)
  }

  function clearLiveChanges() {
    liveChanges.value = []
  }

  return { branch, gitFiles, liveChanges, gitError, isLoading, loadGitStatus, addLiveChange, clearLiveChanges }
})
