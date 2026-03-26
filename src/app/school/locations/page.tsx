'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Room = { id: string; name: string; capacity: number }
type Location = { id: string; name: string; address: string | null; google_maps_url: string | null; rooms: Room[] }

export default function LocationsPage() {
  const supabase = createClient()
  const [schoolId, setSchoolId] = useState<string | null>(null)
  const [locations, setLocations] = useState<Location[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddLocation, setShowAddLocation] = useState(false)
  const [newLocation, setNewLocation] = useState({ name: '', address: '', google_maps_url: '' })
  const [addingLocation, setAddingLocation] = useState(false)
  const [newRoom, setNewRoom] = useState<Record<string, { name: string; capacity: string }>>({})
  const [addingRoom, setAddingRoom] = useState<string | null>(null)

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
  }, [])

  async function fetchLocations(sid: string) {
    const { data } = await supabase
      .from('school_locations')
      .select('id, name, address, google_maps_url')
      .eq('school_id', sid)
      .order('created_at')

    if (!data) return
    const withRooms = await Promise.all(data.map(async (loc) => {
      const { data: rooms } = await supabase.from('school_rooms').select('id, name, capacity').eq('location_id', loc.id)
      return { ...loc, rooms: rooms ?? [] }
    }))
    setLocations(withRooms)
  }

  async function addLocation() {
    if (!schoolId || !newLocation.name) return
    setAddingLocation(true)
    const { error } = await supabase.from('school_locations').insert({ school_id: schoolId, ...newLocation })
    if (!error) {
      await fetchLocations(schoolId)
      setNewLocation({ name: '', address: '', google_maps_url: '' })
      setShowAddLocation(false)
    }
    setAddingLocation(false)
  }

  async function deleteLocation(id: string) {
    if (!schoolId) return
    await supabase.from('school_locations').delete().eq('id', id)
    await fetchLocations(schoolId)
  }

  async function addRoom(locationId: string) {
    const room = newRoom[locationId]
    if (!room?.name) return
    setAddingRoom(locationId)
    const { error } = await supabase.from('school_rooms').insert({
      location_id: locationId,
      name: room.name,
      capacity: Number(room.capacity) || 20,
    })
    if (!error && schoolId) {
      await fetchLocations(schoolId)
      setNewRoom((r) => ({ ...r, [locationId]: { name: '', capacity: '20' } }))
    }
    setAddingRoom(null)
  }

  async function deleteRoom(id: string) {
    if (!schoolId) return
    await supabase.from('school_rooms').delete().eq('id', id)
    await fetchLocations(schoolId)
  }

  if (loading) return <div className="text-sm text-gray-400">Loading...</div>

  return (
    <div className="max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Locations & Rooms</h1>
          <p className="text-gray-500 text-sm mt-1">Manage your school&apos;s locations and rooms.</p>
        </div>
        <button
          onClick={() => setShowAddLocation(true)}
          className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition"
        >
          + Add Location
        </button>
      </div>

      {showAddLocation && (
        <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4 space-y-3">
          <h3 className="font-medium text-gray-900 text-sm">New Location</h3>
          <input
            placeholder="Location name *"
            value={newLocation.name}
            onChange={(e) => setNewLocation((l) => ({ ...l, name: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
          />
          <input
            placeholder="Address"
            value={newLocation.address}
            onChange={(e) => setNewLocation((l) => ({ ...l, address: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
          />
          <input
            placeholder="Google Maps URL"
            value={newLocation.google_maps_url}
            onChange={(e) => setNewLocation((l) => ({ ...l, google_maps_url: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
          />
          <div className="flex gap-2">
            <button onClick={addLocation} disabled={addingLocation || !newLocation.name} className="px-4 py-2 bg-[#6B1F3A] text-white rounded-lg text-sm disabled:opacity-50">
              {addingLocation ? 'Adding...' : 'Add'}
            </button>
            <button onClick={() => setShowAddLocation(false)} className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600">
              Cancel
            </button>
          </div>
        </div>
      )}

      {!locations.length ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
          No locations yet. Add your first location.
        </div>
      ) : (
        <div className="space-y-4">
          {locations.map((loc) => (
            <div key={loc.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="px-5 py-4 flex items-center justify-between border-b border-gray-50">
                <div>
                  <p className="font-medium text-gray-900">{loc.name}</p>
                  {loc.address && <p className="text-xs text-gray-400 mt-0.5">{loc.address}</p>}
                </div>
                <button onClick={() => deleteLocation(loc.id)} className="text-xs text-red-400 hover:text-red-600">Delete</button>
              </div>

              <div className="p-4">
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Rooms</p>
                {loc.rooms.length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    {loc.rooms.map((room) => (
                      <div key={room.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                        <span className="text-sm text-gray-700">{room.name}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-gray-400">{room.capacity} cap.</span>
                          <button onClick={() => deleteRoom(room.id)} className="text-xs text-red-400 hover:text-red-600">×</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <input
                    placeholder="Room name"
                    value={newRoom[loc.id]?.name ?? ''}
                    onChange={(e) => setNewRoom((r) => ({ ...r, [loc.id]: { ...r[loc.id], name: e.target.value } }))}
                    className="flex-1 px-3 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                  />
                  <input
                    placeholder="Cap."
                    type="number"
                    value={newRoom[loc.id]?.capacity ?? '20'}
                    onChange={(e) => setNewRoom((r) => ({ ...r, [loc.id]: { ...r[loc.id], capacity: e.target.value } }))}
                    className="w-16 px-3 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none"
                  />
                  <button
                    onClick={() => addRoom(loc.id)}
                    disabled={addingRoom === loc.id || !newRoom[loc.id]?.name}
                    className="px-3 py-1.5 bg-gray-900 text-white rounded-lg text-sm disabled:opacity-50"
                  >
                    + Room
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
