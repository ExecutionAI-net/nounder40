'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useTranslations } from 'next-intl'
import Tooltip from '@/components/ui/Tooltip'
import ErrorBanner from '@/components/ui/ErrorBanner'

type Room = { id: string; name: string; capacity: number; cost: number }
type Location = { id: string; name: string; address: string | null; google_maps_url: string | null; rooms: Room[] }

export default function LocationsPage() {
  const t = useTranslations('school.locations')
  const supabase = createClient()
  const [schoolId, setSchoolId] = useState<string | null>(null)
  const [locations, setLocations] = useState<Location[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddLocation, setShowAddLocation] = useState(false)
  const [newLocation, setNewLocation] = useState({ name: '', address: '', google_maps_url: '' })
  const [addingLocation, setAddingLocation] = useState(false)
  const [newRoom, setNewRoom] = useState<Record<string, { name: string; capacity: string; cost: string }>>({})
  const [addingRoom, setAddingRoom] = useState<string | null>(null)

  // Edit location state
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null)
  const [editLocationForm, setEditLocationForm] = useState({ name: '', address: '', google_maps_url: '' })
  const [savingLocation, setSavingLocation] = useState(false)

  // Edit room state
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null)
  const [editRoomForm, setEditRoomForm] = useState({ name: '', capacity: '', cost: '' })
  const [savingRoom, setSavingRoom] = useState(false)

  // Surface Supabase/RLS errors instead of failing silently
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
      if (!profile?.school_id) return
      setSchoolId(profile.school_id)
      await fetchLocations(profile.school_id)
      setLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchLocations(sid: string) {
    const { data } = await supabase
      .from('school_locations')
      .select('id, name, address, google_maps_url')
      .eq('school_id', sid)
      .order('created_at')

    if (!data) return
    const withRooms = await Promise.all(data.map(async (loc) => {
      const { data: rooms } = await supabase.from('school_rooms').select('id, name, capacity, cost').eq('location_id', loc.id)
      return { ...loc, rooms: rooms ?? [] }
    }))
    setLocations(withRooms)
  }

  async function addLocation() {
    if (!schoolId || !newLocation.name) return
    setAddingLocation(true)
    setErrorMsg(null)
    const { error } = await supabase.from('school_locations').insert({ school_id: schoolId, ...newLocation })
    if (!error) {
      await fetchLocations(schoolId)
      setNewLocation({ name: '', address: '', google_maps_url: '' })
      setShowAddLocation(false)
    } else {
      setErrorMsg(error.message)
    }
    setAddingLocation(false)
  }

  async function deleteLocation(id: string) {
    if (!schoolId) return
    if (!confirm(t('confirmDeleteLocation'))) return
    setErrorMsg(null)
    const { error, count } = await supabase.from('school_locations').delete({ count: 'exact' }).eq('id', id)
    if (error) setErrorMsg(error.message)
    else if (count === 0) setErrorMsg(t('deleteBlocked'))
    await fetchLocations(schoolId)
  }

  function startEditLocation(loc: Location) {
    setEditingLocationId(loc.id)
    setEditLocationForm({ name: loc.name, address: loc.address ?? '', google_maps_url: loc.google_maps_url ?? '' })
  }

  async function saveLocation(id: string) {
    if (!schoolId || !editLocationForm.name) return
    setSavingLocation(true)
    setErrorMsg(null)
    const { error } = await supabase.from('school_locations').update({
      name: editLocationForm.name,
      address: editLocationForm.address || null,
      google_maps_url: editLocationForm.google_maps_url || null,
    }).eq('id', id)
    if (error) setErrorMsg(error.message)
    await fetchLocations(schoolId)
    setEditingLocationId(null)
    setSavingLocation(false)
  }

  async function addRoom(locationId: string) {
    const room = newRoom[locationId]
    if (!room?.name) return
    setAddingRoom(locationId)
    setErrorMsg(null)
    const { error } = await supabase.from('school_rooms').insert({
      location_id: locationId,
      name: room.name,
      capacity: Number(room.capacity) || 20,
      cost: Number(room.cost) || 0,
    })
    if (!error && schoolId) {
      await fetchLocations(schoolId)
      setNewRoom((r) => ({ ...r, [locationId]: { name: '', capacity: '20', cost: '0' } }))
    } else if (error) {
      setErrorMsg(error.message)
    }
    setAddingRoom(null)
  }

  async function deleteRoom(id: string) {
    if (!schoolId) return
    setErrorMsg(null)
    const { error, count } = await supabase.from('school_rooms').delete({ count: 'exact' }).eq('id', id)
    if (error) setErrorMsg(error.message)
    else if (count === 0) setErrorMsg(t('deleteBlocked'))
    await fetchLocations(schoolId)
  }

  function startEditRoom(room: Room) {
    setEditingRoomId(room.id)
    setEditRoomForm({ name: room.name, capacity: String(room.capacity), cost: String(room.cost ?? 0) })
  }

  async function saveRoom(id: string) {
    if (!schoolId || !editRoomForm.name) return
    setSavingRoom(true)
    setErrorMsg(null)
    const { error, count } = await supabase.from('school_rooms')
      .update({
        name: editRoomForm.name,
        capacity: Number(editRoomForm.capacity) || 20,
        cost: Number(editRoomForm.cost) || 0,
      }, { count: 'exact' })
      .eq('id', id)
    if (error) setErrorMsg(error.message)
    else if (count === 0) setErrorMsg(t('saveBlocked'))
    await fetchLocations(schoolId)
    setEditingRoomId(null)
    setSavingRoom(false)
  }

  const inputCls = 'w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20'

  if (loading) return <div className="text-sm text-gray-400">{t('loading')}</div>

  return (
    <div className="max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
          <p className="text-gray-500 text-sm mt-1">{t('subtitle')}</p>
        </div>
        <button
          onClick={() => setShowAddLocation(true)}
          className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition"
        >
          {t('addLocation')}
        </button>
      </div>

      <ErrorBanner message={errorMsg} onDismiss={() => setErrorMsg(null)} />

      {showAddLocation && (
        <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4 space-y-3">
          <h3 className="font-medium text-gray-900 text-sm">{t('newLocation')}</h3>
          <input placeholder={t('locationNamePlaceholder')} value={newLocation.name}
            onChange={(e) => setNewLocation((l) => ({ ...l, name: e.target.value }))}
            className={inputCls} />
          <input placeholder={t('addressPlaceholder')} value={newLocation.address}
            onChange={(e) => setNewLocation((l) => ({ ...l, address: e.target.value }))}
            className={inputCls} />
          <input placeholder={t('googleMapsPlaceholder')} value={newLocation.google_maps_url}
            onChange={(e) => setNewLocation((l) => ({ ...l, google_maps_url: e.target.value }))}
            className={inputCls} />
          <div className="flex gap-2">
            <button onClick={addLocation} disabled={addingLocation || !newLocation.name}
              className="px-4 py-2 bg-[#6B1F3A] text-white rounded-lg text-sm disabled:opacity-50">
              {addingLocation ? t('adding') : t('add')}
            </button>
            <button onClick={() => setShowAddLocation(false)}
              className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600">
              {t('cancel')}
            </button>
          </div>
        </div>
      )}

      {!locations.length ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
          {t('noLocations')}
        </div>
      ) : (
        <div className="space-y-4">
          {locations.map((loc) => (
            <div key={loc.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">

              {/* Location header */}
              {editingLocationId === loc.id ? (
                <div className="px-5 py-4 border-b border-gray-50 space-y-2">
                  <input value={editLocationForm.name}
                    onChange={e => setEditLocationForm(f => ({ ...f, name: e.target.value }))}
                    placeholder={t('locationNamePlaceholder')}
                    className={inputCls} />
                  <input value={editLocationForm.address}
                    onChange={e => setEditLocationForm(f => ({ ...f, address: e.target.value }))}
                    placeholder="Address"
                    className={inputCls} />
                  <input value={editLocationForm.google_maps_url}
                    onChange={e => setEditLocationForm(f => ({ ...f, google_maps_url: e.target.value }))}
                    placeholder="Google Maps URL"
                    className={inputCls} />
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => saveLocation(loc.id)} disabled={savingLocation || !editLocationForm.name}
                      className="px-4 py-1.5 bg-[#6B1F3A] text-white rounded-lg text-sm disabled:opacity-50">
                      {savingLocation ? t('saving') : t('save')}
                    </button>
                    <button onClick={() => setEditingLocationId(null)}
                      className="px-4 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-600">
                      {t('cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="px-5 py-4 flex items-center justify-between border-b border-gray-50">
                  <div>
                    <p className="font-medium text-gray-900">{loc.name}</p>
                    {loc.address && <p className="text-xs text-gray-400 mt-0.5">{loc.address}</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={() => startEditLocation(loc)}
                      className="text-xs text-gray-400 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-50">
                      {t('edit')}
                    </button>
                    <button onClick={() => deleteLocation(loc.id)}
                      className="text-xs text-red-400 hover:text-red-600">
                      {t('delete')}
                    </button>
                  </div>
                </div>
              )}

              {/* Rooms */}
              <div className="p-4">
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">{t('rooms')}</p>
                {loc.rooms.length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    {loc.rooms.map((room) => (
                      <div key={room.id}>
                        {editingRoomId === room.id ? (
                          <div className="flex gap-2 items-center bg-gray-50 rounded-lg px-3 py-2">
                            <input value={editRoomForm.name}
                              onChange={e => setEditRoomForm(f => ({ ...f, name: e.target.value }))}
                              placeholder="Room name"
                              className="flex-1 px-2 py-1 rounded border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20" />
                            <Tooltip text={t('capacityTooltip')}>
                              <input value={editRoomForm.capacity} type="number"
                                onChange={e => setEditRoomForm(f => ({ ...f, capacity: e.target.value }))}
                                className="w-16 px-2 py-1 rounded border border-gray-200 text-sm focus:outline-none" />
                            </Tooltip>
                            <Tooltip text={t('costTooltip')}>
                              <div className="relative">
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">€</span>
                                <input value={editRoomForm.cost} type="number" min="0" step="0.01"
                                  onChange={e => setEditRoomForm(f => ({ ...f, cost: e.target.value }))}
                                  className="w-20 pl-5 pr-2 py-1 rounded border border-gray-200 text-sm focus:outline-none" />
                              </div>
                            </Tooltip>
                            <button onClick={() => saveRoom(room.id)} disabled={savingRoom}
                              className="px-2 py-1 bg-[#6B1F3A] text-white rounded text-xs disabled:opacity-50">
                              {savingRoom ? '...' : t('save')}
                            </button>
                            <button onClick={() => setEditingRoomId(null)}
                              className="px-2 py-1 text-gray-400 rounded text-xs hover:bg-gray-100">
                              {t('cancel')}
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                            <span className="text-sm text-gray-700">{room.name}</span>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-gray-400">{room.capacity} {t('cap')}</span>
                              <span className="text-xs text-gray-400">€{Number(room.cost).toFixed(2)}</span>
                              <button onClick={() => startEditRoom(room)}
                                className="text-xs text-gray-400 hover:text-gray-700">
                                {t('edit')}
                              </button>
                              <button onClick={() => deleteRoom(room.id)}
                                className="text-xs text-red-400 hover:text-red-600">
                                ×
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <input placeholder="Room name"
                    value={newRoom[loc.id]?.name ?? ''}
                    onChange={(e) => setNewRoom((r) => ({ ...r, [loc.id]: { ...r[loc.id], name: e.target.value } }))}
                    className="flex-1 px-3 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20" />
                  <Tooltip text={t('capacityTooltip')}>
                    <input placeholder={t('capPlaceholder')} type="number"
                      value={newRoom[loc.id]?.capacity ?? '20'}
                      onChange={(e) => setNewRoom((r) => ({ ...r, [loc.id]: { ...r[loc.id], capacity: e.target.value } }))}
                      className="w-16 px-3 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none" />
                  </Tooltip>
                  <Tooltip text={t('costTooltip')}>
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">€</span>
                      <input placeholder={t('costPlaceholder')} type="number" min="0" step="0.01"
                        value={newRoom[loc.id]?.cost ?? '0'}
                        onChange={(e) => setNewRoom((r) => ({ ...r, [loc.id]: { ...r[loc.id], cost: e.target.value } }))}
                        className="w-24 pl-6 pr-2 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none" />
                    </div>
                  </Tooltip>
                  <button onClick={() => addRoom(loc.id)}
                    disabled={addingRoom === loc.id || !newRoom[loc.id]?.name}
                    className="px-3 py-1.5 bg-gray-900 text-white rounded-lg text-sm disabled:opacity-50">
                    {t('addRoom')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
