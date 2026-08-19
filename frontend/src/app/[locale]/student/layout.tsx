import { createClient } from '@/lib/supabase/server'
import StudentLayout from '@/components/layouts/StudentLayout'
import { getBrandSettings } from '@/lib/api/brand-settings'

export default async function Layout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const brand = await getBrandSettings()

  let userName: string | null = null
  const userEmail: string | null = user?.email ?? null

  if (user) {
    // Nel pannello allieve vale il nome della scheda allieva: è quello che
    // l'allieva vede e modifica nel proprio profilo. profiles.name resta come
    // ripiego (utenti senza scheda, es. staff che sbircia il pannello).
    const [{ data: student }, { data: profile }] = await Promise.all([
      supabase.from('students').select('name').eq('user_id', user.id).maybeSingle(),
      supabase.from('profiles').select('name').eq('id', user.id).maybeSingle(),
    ])
    userName = student?.name || profile?.name || null
  }

  return (
    <StudentLayout userName={userName} userEmail={userEmail} isAuthenticated={!!user} brand={brand}>
      {children}
    </StudentLayout>
  )
}
