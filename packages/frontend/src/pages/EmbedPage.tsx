import { useEffect, useCallback } from 'react'
import { usePostMessage, sendToParent } from '../hooks/usePostMessage'
import { App } from '../App'

/**
 * Entry point do modo iframe embed.
 * Lê o token da query string e o injeta no cookie via API.
 * Expõe a postMessage API para comunicação com o host.
 */
export function EmbedPage() {
  const params = new URLSearchParams(window.location.search)
  const theme = params.get('theme') ?? 'dark'
  const hideModules = params.get('hide-modules')?.split(',') ?? []
  const readOnly = params.get('read-only') === 'true'

  useEffect(() => {
    // Aplica tema
    document.documentElement.setAttribute('data-theme', theme)

    // Notifica o host que o painel está pronto
    sendToParent({ type: 'rcs:ready' })
  }, [theme])

  const handleMessage = useCallback((event: any) => {
    if (event.type === 'rcs:set-token') {
      // Token injetado via postMessage — faz login com o token
      fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${event.token}` },
        credentials: 'include',
      })
    }
  }, [])

  usePostMessage(handleMessage)

  return <App embedMode hideModules={hideModules} readOnly={readOnly} />
}
