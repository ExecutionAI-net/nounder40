import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

// Catalogo pubblico: consultabile anche senza login (solo prodotti attivi).
// Il client admin evita che le policy RLS blocchino i visitatori anonimi.
export async function GET(request: Request) {
  const db = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  const { searchParams } = new URL(request.url)
  const category = searchParams.get('category')

  let query = db
    .from('shop_products')
    // Varianti incluse: taglie/colori mostrati solo se disponibili a stock
    .select('*, shop_product_variants(id, size, color, stock)')
    .eq('active', true)
    .order('created_at', { ascending: false })

  if (category && category !== 'all') query = query.eq('category', category)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
