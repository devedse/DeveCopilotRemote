<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useConnectionStore } from '@/stores/connectionStore'
import { getToken, setCredential } from '@/composables/useApi'
import LoginScreen from '@/components/LoginScreen.vue'
import TopBar from '@/components/TopBar.vue'
import TabNav from '@/components/TabNav.vue'
import Toast from '@/components/Toast.vue'
import ChatPanel from '@/components/chat/ChatPanel.vue'
import ChangesPanel from '@/components/changes/ChangesPanel.vue'
import FilesPanel from '@/components/files/FilesPanel.vue'
import type { Tab } from '@/components/TabNav.vue'

const connection = useConnectionStore()

const ready = ref(false)
const authError = ref('')

const tabs: Tab[] = [
  { id: 'chat', label: 'Chat', icon: '✦' },
  { id: 'changes', label: 'Changes', icon: '≋' },
  { id: 'files', label: 'Files', icon: '⌘' },
]

const activeTab = ref('chat')

const toastMessage = ref('')
const toastType = ref<'success' | 'error'>('success')
const toastKey = ref(0)

function showToast(message: string, type: 'success' | 'error' = 'success') {
  toastMessage.value = message
  toastType.value = type
  toastKey.value++
}

// Expose globally so stores/composables can trigger toasts
;(window as unknown as { showToast: typeof showToast }).showToast = showToast

// Re-check connection when the page becomes visible again (e.g. phone wakes)
function onVisibilityChange() {
  if (document.visibilityState === 'visible' && connection.authenticated) {
    connection.verifyAndConnect()
  }
}

async function handleAuthenticate(credential: string) {
  setCredential(credential)
  const ok = await connection.verifyAndConnect()
  if (!ok) {
    authError.value = 'Authentication failed. Please check your credentials.'
  } else {
    authError.value = ''
  }
}

onMounted(async () => {
  document.addEventListener('visibilitychange', onVisibilityChange)

  // Fetch public status (auth mode)
  await connection.fetchAuthInfo()

  // If we have a credential, verify it
  const credential = getToken()
  if (credential) {
    await connection.verifyAndConnect()
  }

  ready.value = true
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<template>
  <div v-if="!ready" class="flex min-h-dvh items-center justify-center">
    <p class="text-sm text-gray-400">Loading...</p>
  </div>

  <LoginScreen
    v-else-if="!connection.authenticated"
    :auth-mode="connection.authMode"
    @authenticate="handleAuthenticate"
  />

  <div v-else class="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-2 p-2">
    <TopBar />

    <div class="flex flex-1 flex-col gap-2 sm:flex-row">
      <TabNav :tabs="tabs" :active-tab="activeTab" @select="activeTab = $event" />

      <main class="flex-1 overflow-hidden rounded-xl border border-border-default bg-surface-alt shadow-lg">
        <ChatPanel v-if="activeTab === 'chat'" />
        <ChangesPanel v-else-if="activeTab === 'changes'" />
        <FilesPanel v-else-if="activeTab === 'files'" />
      </main>
    </div>

    <Toast
      v-if="toastMessage"
      :key="toastKey"
      :message="toastMessage"
      :type="toastType"
    />
  </div>
</template>
