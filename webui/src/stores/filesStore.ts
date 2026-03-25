import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiFetch } from '@/composables/useApi'
import type { FileEntry, DirectoryResponse, FileContentResponse } from '@/types'

export const useFilesStore = defineStore('files', () => {
  const currentPath = ref('.')
  const entries = ref<FileEntry[]>([])
  const isLoading = ref(false)
  const error = ref('')

  // File viewer state
  const viewerFile = ref<FileContentResponse | null>(null)
  const viewerLoading = ref(false)

  async function loadDirectory(dirPath: string = '.') {
    isLoading.value = true
    error.value = ''
    try {
      const data = await apiFetch<DirectoryResponse>(`/api/files?path=${encodeURIComponent(dirPath)}`)
      if (data.ok) {
        currentPath.value = data.path
        entries.value = data.items
      } else {
        error.value = data.error ?? 'Failed to load directory.'
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load directory.'
    } finally {
      isLoading.value = false
    }
  }

  async function openFile(filePath: string) {
    viewerLoading.value = true
    viewerFile.value = null
    try {
      const data = await apiFetch<FileContentResponse>(`/api/file?path=${encodeURIComponent(filePath)}`)
      if (data.ok) {
        viewerFile.value = data
      }
    } catch {
      // File not available
    } finally {
      viewerLoading.value = false
    }
  }

  function closeViewer() {
    viewerFile.value = null
  }

  return { currentPath, entries, isLoading, error, viewerFile, viewerLoading, loadDirectory, openFile, closeViewer }
})
