const TOKEN_KEY = 'deveCopilotRemoteToken'

export function getToken(): string {
  // Check URL params first (initial auth)
  const params = new URLSearchParams(window.location.search)
  const urlToken = params.get('token')
  if (urlToken) {
    localStorage.setItem(TOKEN_KEY, urlToken)
    return urlToken
  }
  const urlPasswordHash = params.get('passwordHash')
  if (urlPasswordHash) {
    localStorage.setItem(TOKEN_KEY, urlPasswordHash)
    return urlPasswordHash
  }
  return localStorage.getItem(TOKEN_KEY) ?? ''
}

export function setCredential(credential: string): void {
  localStorage.setItem(TOKEN_KEY, credential)
}

export function clearCredential(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  const headers = new Headers(init?.headers)

  if (!headers.has('X-DeveCopilotRemote-Token')) {
    headers.set('X-DeveCopilotRemote-Token', token)
  }

  const response = await fetch(path, { ...init, headers })

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? `Request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}

export function apiUrl(path: string): string {
  const token = getToken()
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}token=${encodeURIComponent(token)}`
}
