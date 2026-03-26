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
  lesson_types: { name_en: string } | null
}

type VideoProgress = {
  content_id: string
  progress_seconds: number
  completed: boolean
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function progressPercent(item: LibraryItem, progress: VideoProgress | undefined) {
  if (!progress || !item.duration_seconds) return 0
  return Math.min(100, Math.round((progress.progress_seconds / item.duration_seconds) * 100))
}

export default function TeacherLibraryPage() {
  const [items, setItems] = useState<LibraryItem[]>([])
  const [progress] = useState<VideoProgress[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [filterType, setFilterType] = useState('all')
  const [filterLevel, setFilterLevel] = useState('all')
  const [filterLang, setFilterLang] = useState('all')

  // Viewer modal
  const [viewing, setViewing] = useState<LibraryItem | null>(null)

  useEffect(() => { fetchItems() }, [filterType, filterLevel, filterLang])

  async function fetchItems() {
    setLoading(true)
    const params = new URLSearchParams()
    if (filterType !== 'all') params.set('type', filterType)
    if (filterLevel !== 'all') params.set('level', filterLevel)
    if (filterLang !== 'all') params.set('language', filterLang)
    const res = await fetch(`/api/teacher/library?${params}`)
    if (res.ok) setItems(await res.json())
    setLoading(false)
  }

  function openItem(item: LibraryItem) {
    if (item.type === 'pdf' && item.file_url) {
      window.open(item.file_url, '_blank')
      return
    }
    setViewing(item)
  }

  const getProgress = (id: string) => progress.find((p) => p.content_id === id)

  const inputCls = 'px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 bg-white'

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Metodo Library</h1>
        <p className="text-gray-500 text-sm mt-1">Official HQ content and school-uploaded materials</p>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-6 flex-wrap">
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className={inputCls}>
          <option value="all">All Types</option>
          <option value="video">Video</option>
          <option value="pdf">PDF</option>
        </select>
        <select value={filterLevel} onChange={(e) => setFilterLevel(e.target.value)} className={inputCls}>
          <option value="all">All Levels</option>
          <option value="entry">Entry</option>
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
        </select>
        <select value={filterLang} onChange={(e) => setFilterLang(e.target.value)} className={inputCls}>
          <option value="all">All Languages</option>
          <option value="en">English</option>
          <option value="it">Italian</option>
          <option value="fr">French</option>
          <option value="es">Spanish</option>
        </select>
      </div>

      {loading ? (
        <div className="text-sm text-gray-400">Loading...</div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-gray-400 text-sm">No content available yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((item) => {
            const prog = getProgress(item.id)
            const pct = progressPercent(item, prog)
            return (
              <button
                key={item.id}
                onClick={() => openItem(item)}
                className="bg-white rounded-xl border border-gray-100 p-4 text-left hover:border-[#6B1F3A]/30 hover:shadow-sm transition flex flex-col gap-3"
              >
                {item.thumbnail_url ? (
                  <div className="w-full h-32 rounded-lg overflow-hidden bg-gray-100">
                    <img src={item.thumbnail_url} alt={item.title} className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="w-full h-32 rounded-lg bg-gray-100 flex items-center justify-center">
                    <span className="text-gray-300 text-3xl">{item.type === 'video' ? '▶' : '📄'}</span>
                  </div>
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${item.type === 'video' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                      {item.type.toUpperCase()}
                    </span>
                    {prog?.completed && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Done</span>
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
                  </div>
                  {item.type === 'video' && item.duration_seconds && pct > 0 && (
                    <div className="mt-2">
                      <div className="flex justify-between text-xs text-gray-400 mb-0.5">
                        <span>{pct}% watched</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div
                          className="bg-[#6B1F3A] h-1.5 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* Video viewer modal */}
      {viewing && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-3xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">{viewing.title}</h3>
              <button onClick={() => setViewing(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <div className="p-5">
              {viewing.file_url ? (
                <video
                  controls
                  className="w-full rounded-lg bg-black"
                  src={viewing.file_url}
                  style={{ maxHeight: '400px' }}
                >
                  Your browser does not support the video tag.
                </video>
              ) : (
                <div className="w-full h-48 rounded-lg bg-gray-100 flex items-center justify-center">
                  <p className="text-gray-400 text-sm">No video URL available.</p>
                </div>
              )}
              {viewing.description && (
                <p className="text-sm text-gray-600 mt-4">{viewing.description}</p>
              )}
              <div className="flex gap-3 mt-3 text-xs text-gray-400">
                <span className="capitalize">{viewing.level}</span>
                <span className="uppercase">{viewing.language}</span>
                {viewing.duration_seconds && <span>{formatDuration(viewing.duration_seconds)}</span>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
