import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/api/guards'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// Tipi di documento richiesti dalla scuola (Impostazioni → Documenti).
// L'elenco è per scuola: ognuna decide cosa chiedere e cosa è obbligatorio.

function cleanVariants(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input.map(v => String(v).trim()).filter(Boolean).slice(0, 10)
}

export async function GET() {
  const auth = await requireRole('school')
  if (!auth?.profile.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await createAdminClient()
    .from('school_document_types')
    .select('*')
    .eq('school_id', auth.profile.school_id)
    .order('sort_order')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(request: Request) {
  const auth = await requireRole('school')
  if (!auth?.profile.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const name = String(body.name ?? '').trim()
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: last } = await admin
    .from('school_document_types')
    .select('sort_order')
    .eq('school_id', auth.profile.school_id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Codice stabile derivato dal nome: serve a legare i documenti già caricati
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '') || 'doc'

  const { data, error } = await admin
    .from('school_document_types')
    .insert({
      school_id: auth.profile.school_id,
      code: `${base}_${Date.now().toString(36)}`,
      name,
      variants: cleanVariants(body.variants),
      has_expiry: body.has_expiry !== false,
      required: body.required === true,
      sort_order: (last?.sort_order ?? 0) + 1,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(request: Request) {
  const auth = await requireRole('school')
  if (!auth?.profile.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  if (!body.id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.name = String(body.name).trim()
  if (body.variants !== undefined) patch.variants = cleanVariants(body.variants)
  if (body.has_expiry !== undefined) patch.has_expiry = !!body.has_expiry
  if (body.required !== undefined) patch.required = !!body.required
  if (body.active !== undefined) patch.active = !!body.active
  if (body.sort_order !== undefined) patch.sort_order = Number(body.sort_order)

  const { data, error } = await createAdminClient()
    .from('school_document_types')
    .update(patch)
    .eq('id', body.id)
    .eq('school_id', auth.profile.school_id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// Il tipo si elimina solo se nessuna allieva ha caricato quel documento:
// altrimenti si disattiva (i documenti già raccolti restano leggibili).
export async function DELETE(request: Request) {
  const auth = await requireRole('school')
  if (!auth?.profile.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  const admin = createAdminClient()
  const { count } = await admin
    .from('student_documents')
    .select('id', { count: 'exact', head: true })
    .eq('type_id', id)

  if (count && count > 0) {
    const { error } = await admin
      .from('school_document_types')
      .update({ active: false })
      .eq('id', id)
      .eq('school_id', auth.profile.school_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ deactivated: true, documents: count })
  }

  const { error } = await admin
    .from('school_document_types')
    .delete()
    .eq('id', id)
    .eq('school_id', auth.profile.school_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deleted: true })
}
