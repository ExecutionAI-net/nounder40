import { createClient } from '@/lib/supabase/server'
import HQLayout from '@/components/layouts/HQLayout'

export default async function Layout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let userName: string | null = null
  let userEmail: string | null = user?.email ?? null
  let hqSubRole: string | null = null

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('name, hq_sub_role')
      .eq('id', user.id)
      .single()
    userName = profile?.name ?? null
    hqSubRole = profile?.hq_sub_role ?? null
  }

  return (
    <HQLayout userName={userName} userEmail={userEmail} hqSubRole={hqSubRole}>
      {children}
    </HQLayout>
  )
}
