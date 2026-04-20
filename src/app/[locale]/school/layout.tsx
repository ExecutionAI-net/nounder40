import { createClient } from '@/lib/supabase/server'
import SchoolLayout from '@/components/layouts/SchoolLayout'

export default async function Layout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let userName: string | null = null
  let userEmail: string | null = user?.email ?? null
  let schoolSubRole: string | null = null

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('name, school_sub_role')
      .eq('id', user.id)
      .single()
    userName = profile?.name ?? null
    schoolSubRole = profile?.school_sub_role ?? null
  }

  return (
    <SchoolLayout userName={userName} userEmail={userEmail} schoolSubRole={schoolSubRole}>
      {children}
    </SchoolLayout>
  )
}
