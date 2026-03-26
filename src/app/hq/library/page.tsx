'use client'

import { useEffect, useState } from 'react'

type LibraryItem = {
  id: string
  title: string
  description: string | null
  type: 'video' | 'pdf'
  level: string
  language: string
  duration_seconds: number | null
  file_url: string | null
  thumbnail_url: string | null
  visible_to_students: boolean
  student_access: string
  price: number | null
  active: boolean
  created_at: string
  lesson_types: { name_en: string } | null
}

const EMPTY_FORM = {
  title: '',
  type: 'video',
  level: 'all',
  language: 'en',
  description: '',
  file_url: '',
  thumbnail_url: '',
  duration_seconds: '',
  visible_to_students: false,
  student_access: 'included',
  price: '',
}

const inputCls = 'w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function getEmbedUrl(url: string | null): string | null {
  if (!url) return null
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?/]+)/)
  if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`
  return url
}

function getYouTubeEmbedUrl(url: string | null): string | null {
  if (!url) return null
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?/]+)/)
  if (match) return `https://www.youtube.com/embed/${match[1]}`
  return null
}

export default function HQLibraryPage() {
  const [items, setItems] = useState<LibraryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<LibraryItem | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [filterType, setFilterType] = useState('all')
  const [filterLevel, setFilterLevel] = useState('all')
  const [filterLang, setFilterLang] = useState('all')

  useEffect(() => { fetchItems() }, [filterType, filterLevel, filterLang])

  async function fetchItems() {
    setLoading(true)
    const params = new URLSearchParams()
    if (filterType !== 'all') params.set('type', filterType)
    if (filterLevel !== 'all') params.set('level', filterLevel)
    if (filterLang !== 'all') params.set('language', filterLang)
    const res = await fetch(`/api/hq/library?${params}`)
    if (res.ok) setItems(await res.json())
    setLoading(false)
  }

  function openNew() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setError(null)
    setShowForm(true)
  }

  function openEdit(item: LibraryItem) {
    setEditing(item)
    setForm({
      title: item.title,
      type: item.type,
      level: item.level,
      language: item.language,
      description: item.description ?? '',
      file_url: item.file_url ?? '',
      thumbnail_url: item.thumbnail_url ?? '',
      duration_seconds: item.duration_seconds ? String(item.duration_seconds) : '',
      visible_to_students: item.visible_to_students,
      student_access: item.student_access,
      price: item.price ? String(item.price) : '',
    })
    setError(null)
    setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    const payload = {
      ...form,
      duration_seconds: form.duration_seconds ? Number(form.duration_seconds) : null,
      price: form.price ? Number(form.price) : null,
    }

    let res: Response
    if (editing) {
      res = await fetch(`/api/hq/library/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } else {
      res = await fetch('/api/hq/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    }

    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? 'Something went wrong')
    } else {
      setShowForm(false)
      await fetchItems()
    }
    setSubmitting(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this content item?')) return
    await fetch(`/api/hq/library/${id}`, { method: 'DELETE' })
    setItems((prev) => prev.filter((x) => x.id !== id))
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Metodo Library</h1>
          <p className="text-gray-500 text-sm mt-1">Official HQ content — {items.length} items</p>
        </div>
        <button
          onClick={openNew}
          className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition"
        >
          + Upload Content
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex gap-3 mb-6 flex-wrap">
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 bg-white"
        >
          <option value="all">All Types</option>
          <option value="video">Video</option>
          <option value="pdf">PDF</option>
        </select>
        <select
          value={filterLevel}
          onChange={(e) => setFilterLevel(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 bg-white"
        >
          <option value="all">All Levels</option>
          <option value="entry">Entry</option>
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
        </select>
        <select
          value={filterLang}
          onChange={(e) => setFilterLang(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 bg-white"
        >
          <option value="all">All Languages</option>
          <option value="en">English</option>
          <option value="it">Italian</option>
          <option value="fr">French</option>
          <option value="es">Spanish</option>
        </select>
      </div>

      {/* Upload / Edit form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-100 p-6 mb-6 space-y-4">
          <h3 className="font-semibold text-gray-900">{editing ? 'Edit Content' : 'Upload New Content'}</h3>
          {error && <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={labelCls}>Title *</label>
              <input
                required
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                className={inputCls}
                placeholder="e.g. Flexibility Fundamentals — Week 1"
              />
            </div>
            <div>
              <label className={labelCls}>Type *</label>
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                className={inputCls}
              >
                <option value="video">Video</option>
                <option value="pdf">PDF</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Level</label>
              <select
                value={form.level}
                onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}
                className={inputCls}
              >
                <option value="all">All Levels</option>
                <option value="entry">Entry</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Language</label>
              <select
                value={form.language}
                onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}
                className={inputCls}
              >
                <option value="en">English</option>
                <option value="it">Italian</option>
                <option value="fr">French</option>
                <option value="es">Spanish</option>
              </select>
            </div>
            {form.type === 'video' && (
              <div>
                <label className={labelCls}>Duration (seconds)</label>
                <input
                  type="number"
                  min="0"
                  value={form.duration_seconds}
                  onChange={(e) => setForm((f) => ({ ...f, duration_seconds: e.target.value }))}
                  className={inputCls}
                  placeholder="e.g. 3600"
                />
              </div>
            )}
            <div className="col-span-2">
              <label className={labelCls}>File URL</label>
              <input
                value={form.file_url}
                onChange={(e) => setForm((f) => ({ ...f, file_url: e.target.value }))}
                className={inputCls}
                placeholder="https://..."
              />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Thumbnail URL</label>
              <input
                value={form.thumbnail_url}
                onChange={(e) => setForm((f) => ({ ...f, thumbnail_url: e.target.value }))}
                className={inputCls}
                placeholder="https://..."
              />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
                className={inputCls}
                placeholder="Short description of this content..."
              />
            </div>
            <div className="col-span-2 flex items-center gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.visible_to_students}
                  onChange={(e) => setForm((f) => ({ ...f, visible_to_students: e.target.checked }))}
                  className="w-4 h-4 accent-[#6B1F3A]"
                />
                <span className="text-sm text-gray-700">Visible to students</span>
              </label>
              {form.visible_to_students && (
                <div className="flex items-center gap-3">
                  <label className={labelCls + ' mb-0'}>Student access</label>
                  <select
                    value={form.student_access}
                    onChange={(e) => setForm((f) => ({ ...f, student_access: e.target.value }))}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none"
                  >
                    <option value="included">Included</option>
                    <option value="paid">Paid</option>
                  </select>
                  {form.student_access === 'paid' && (
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.price}
                      onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                      className="w-28 px-3 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none"
                      placeholder="€ price"
                    />
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-[#5a1930] transition"
            >
              {submitting ? 'Saving...' : editing ? 'Save Changes' : 'Upload Content'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Content grid */}
      {loading ? (
        <div className="text-sm text-gray-400">Loading...</div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-gray-400 text-sm">No content yet. Upload the first item.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((item) => (
            <div key={item.id} className="bg-white rounded-xl border border-gray-100 p-4 flex flex-col gap-3">
              {getEmbedUrl(item.file_url) ? (
                <div className="w-full rounded-lg overflow-hidden bg-gray-100 aspect-video">
                  <iframe
                    src={getEmbedUrl(item.file_url)!}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              ) : item.thumbnail_url ? (
                <div className="w-full h-32 rounded-lg overflow-hidden bg-gray-100">
                  <img src={item.thumbnail_url} alt={item.title} className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="w-full h-32 rounded-lg bg-gray-100 flex items-center justify-center">
                  <span className="text-gray-300 text-3xl">{item.type === 'video' ? '▶' : '📄'}</span>
                </div>
              )}
              <div className="flex-1">
                <div className="flex items-start gap-2 mb-1">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${item.type === 'video' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                    {item.type.toUpperCase()}
                  </span>
                  {item.visible_to_students && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                      Students
                    </span>
                  )}
                </div>
                <p className="font-medium text-gray-900 text-sm leading-snug">{item.title}</p>
                {item.description && (
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">{item.description}</p>
                )}
                <div className="flex gap-3 mt-2 text-xs text-gray-400">
                  <span className="capitalize">{item.level}</span>
                  <span className="uppercase">{item.language}</span>
                  {item.duration_seconds && <span>{formatDuration(item.duration_seconds)}</span>}
                  {item.student_access === 'paid' && item.price && (
                    <span className="text-[#6B1F3A]">€{Number(item.price).toFixed(2)}</span>
                  )}
                </div>
              </div>
              <div className="flex gap-2 pt-1 border-t border-gray-50">
                <button
                  onClick={() => openEdit(item)}
                  className="flex-1 text-xs text-gray-500 hover:text-gray-800 py-1 transition"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(item.id)}
                  className="flex-1 text-xs text-red-400 hover:text-red-600 py-1 transition"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
