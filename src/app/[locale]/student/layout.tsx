import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import StudentLayout from '@/components/layouts/StudentLayout'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default async function Layout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let userName: string | null = null
  let userEmail: string | null = user?.email ?? null

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('name')
      .eq('id', user.id)
      .single()
    userName = profile?.name ?? null
  }

  return (
    <StudentLayout userName={userName} userEmail={userEmail}>
      {children}
    </StudentLayout>
  )
}
