import { useEffect } from 'react'

type PostMessageEvent =
  | { type: 'rcs:set-token'; token: string }
  | { type: 'rcs:navigate'; module: 'auth' | 'contacts' | 'messages' | 'schedule' }

type OutboundEvent =
  | { type: 'rcs:ready' }
  | { type: 'rcs:campaign:started'; campaignId: string }
  | { type: 'rcs:campaign:progress'; sent: number; total: number; failed: number }
  | { type: 'rcs:error'; code: string; message: string }

export function usePostMessage(
  onMessage: (event: PostMessageEvent) => void
) {
  useEffect(() => {
    function handler(e: MessageEvent) {
      // Valida origem — apenas aceita mensagens com tipo reconhecido
      if (!e.data?.type?.startsWith('rcs:')) return
      onMessage(e.data as PostMessageEvent)
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [onMessage])
}

export function sendToParent(event: OutboundEvent) {
  if (window.parent !== window) {
    window.parent.postMessage(event, '*')
  }
}
