import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { revalidateAll } from '@/lib/revalidate'

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, roles').eq('id', user.id).single()
  if (!(profile?.role === 'hq' || profile?.roles?.includes('hq'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()

  const { data, error } = await supabase
    .from('shop_products')
    .update(body)
    .eq('id', params.id)
    .is('school_id', null)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  revalidateAll()
  return NextResponse.json(data)
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, roles').eq('id', user.id).single()
  if (!(profile?.role === 'hq' || profile?.roles?.includes('hq'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { error } = await supabase
    .from('shop_products')
    .delete()
    .eq('id', params.id)
    .is('school_id', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  revalidateAll()
  return NextResponse.json({ success: true })
}
