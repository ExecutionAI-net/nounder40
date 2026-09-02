'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Google Identity Services — loaded imperatively so the caller keeps its own
// custom-styled button (matches the old UI exactly) and just calls prompt()
// from its existing onClick, instead of embedding Google's own rendered button.

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: { client_id: string; callback: (resp: { credential: string }) => void }) => void
          prompt: () => void
        }
      }
    }
  }
}

export function useGoogleIdentity(onCredential: (idToken: string) => void) {
  const [ready, setReady] = useState(false)
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
  const onCredentialRef = useRef(onCredential)
  onCredentialRef.current = onCredential

  useEffect(() => {
    if (!clientId) return
    if (window.google) {
      window.google.accounts.id.initialize({ client_id: clientId, callback: (r) => onCredentialRef.current(r.credential) })
      setReady(true)
      return
    }
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => {
      window.google?.accounts.id.initialize({ client_id: clientId, callback: (r) => onCredentialRef.current(r.credential) })
      setReady(true)
    }
    document.head.appendChild(script)
  }, [clientId])

  const prompt = useCallback(() => {
    window.google?.accounts.id.prompt()
  }, [])

  return { ready: ready && !!clientId, prompt, enabled: !!clientId }
}
