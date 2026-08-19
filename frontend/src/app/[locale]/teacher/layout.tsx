import { createClient } from '@/lib/supabase/server'
import TeacherLayout from '@/components/layouts/TeacherLayout'

export default async function Layout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let userName: string | null = null
  const userEmail: string | null = user?.email ?? null

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('name')
      .eq('id', user.id)
      .single()
    userName = profile?.name ?? null
  }

  return (
    <TeacherLayout userName={userName} userEmail={userEmail}>
      {children}
    </TeacherLayout>
  )
}
