import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// Scheda prodotto pubblica: consultabile anche senza login (solo prodotti attivi).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data, error } = await createAdminClient()
    .from('shop_products')
    .select('*, shop_product_variants(id, size, color, stock)')
    .eq('id', id)
    .eq('active', true)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json(data)
}
