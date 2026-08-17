"""
Faz 2, sixth pilot resource: school_rooms, the one part of that table
actually written from the app (school/locations/page.tsx, a client
component talking to Supabase directly today). Everywhere else that
reads school_rooms (bookings, calendar, attendance, reports -- 12
files) does so as a read-only join and is NOT touched by this pilot;
this only covers the room CRUD surface itself.

RLS being replaced (supabase/migrations/030_school_rooms_write_fk.sql
and the original table's SELECT policy):
  rooms_school_select: SELECT using location_id IN (own school's
    locations) OR get_my_role() = 'hq'  -- no role='school' requirement,
    replicated as-is (whoever's profile.school_id matches can read)
  rooms_school_admin_write: ALL using (location_id IN (own school's
    locations) AND get_my_role() = 'school') OR get_my_role() = 'hq'
"""
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .auth import SupabaseJWTAuthentication
from .models import Profiles, SchoolLocations, SchoolRooms


def _profile(user_id):
    return Profiles.objects.filter(id=user_id).only('role', 'school_id').first()


def _can_read(profile, location):
    if not profile:
        return False
    if profile.role == 'hq':
        return True
    return location.school_id == profile.school_id


def _can_write(profile, location):
    if not profile:
        return False
    if profile.role == 'hq':
        return True
    return profile.role == 'school' and location.school_id == profile.school_id


def _serialize(room):
    return {'id': str(room.id), 'name': room.name, 'capacity': room.capacity, 'cost': str(room.cost)}


@api_view(['GET', 'POST'])
@authentication_classes([SupabaseJWTAuthentication])
@permission_classes([AllowAny])
def rooms_list(request):
    if not request.user or not request.user.is_authenticated:
        return Response({'error': 'Unauthorized'}, status=401)
    profile = _profile(request.user.id)

    location_id = request.query_params.get('location_id') if request.method == 'GET' else request.data.get('location_id')
    if not location_id:
        return Response({'error': 'location_id is required'}, status=400)
    location = SchoolLocations.objects.filter(id=location_id).first()
    if not location:
        return Response({'error': 'Not found'}, status=404)

    if request.method == 'GET':
        if not _can_read(profile, location):
            return Response({'error': 'Forbidden'}, status=403)
        rooms = SchoolRooms.objects.filter(location_id=location_id)
        return Response([_serialize(r) for r in rooms])

    if not _can_write(profile, location):
        return Response({'error': 'Forbidden'}, status=403)

    name = request.data.get('name')
    if not name:
        return Response({'error': 'name is required'}, status=400)
    room = SchoolRooms.objects.create(
        location_id=location_id,
        name=name,
        capacity=int(request.data.get('capacity') or 20),
        cost=request.data.get('cost') or 0,
    )
    return Response(_serialize(room))


@api_view(['PATCH', 'DELETE'])
@authentication_classes([SupabaseJWTAuthentication])
@permission_classes([AllowAny])
def rooms_detail(request, id):
    if not request.user or not request.user.is_authenticated:
        return Response({'error': 'Unauthorized'}, status=401)
    profile = _profile(request.user.id)

    # Mirrors the original: RLS silently matches 0 rows on both UPDATE and
    # DELETE rather than raising -- the frontend checks `count === 0` for
    # both operations, so both stay 200 here too.
    room = SchoolRooms.objects.select_related('location').filter(id=id).first()
    if not room or not _can_write(profile, room.location):
        return Response({'count': 0})

    if request.method == 'DELETE':
        room.delete()
        return Response({'count': 1})

    if request.data.get('name'):
        room.name = request.data['name']
    if request.data.get('capacity') is not None:
        room.capacity = int(request.data['capacity'])
    if request.data.get('cost') is not None:
        room.cost = request.data['cost']
    room.save()
    return Response({'count': 1, **_serialize(room)})
