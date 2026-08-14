import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          if (typeof document === 'undefined') return []
          return document.cookie.split('; ').map(cookie => {
            const idx = cookie.indexOf('=')
            return { name: cookie.slice(0, idx), value: cookie.slice(idx + 1) }
          })
        },
        setAll(cookies) {
          if (typeof document === 'undefined') return
          cookies.forEach(({ name, value, options }) => {
            const expires = options?.maxAge
              ? new Date(Date.now() + options.maxAge * 1000).toUTCString()
              : options?.expires?.toUTCString()
            document.cookie = `${name}=${value}${expires ? `; expires=${expires}` : ''}; path=/`
          })
        },
      },
    }
  )
}
