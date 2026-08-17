"""
Faz 2, third pilot resource: HQ's country/city reference catalog.
Mirrors 5 existing Next.js routes exactly (same URLs, same shapes):
  GET    /api/locations                    (public, optional ?withSchools=1)
  POST   /api/hq/locations/countries        (HQ only)
  DELETE /api/hq/locations/countries/<id>   (HQ only)
  POST   /api/hq/locations/cities           (HQ only)
  DELETE /api/hq/locations/cities/<id>      (HQ only)

RLS being replaced (hq_countries / hq_cities, both tables):
  *_public_read: SELECT true
  *_hq_write: ALL using EXISTS(profiles WHERE id = auth.uid() AND role = 'hq')

The existing routes actually check `role === 'hq' || roles.includes('hq')`
(multi-role aware) rather than the bare RLS condition -- replicated as-is,
since that's the real current behavior.
"""
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .auth import SupabaseJWTAuthentication
from .models import HqCities, HqCountries, Profiles, Schools


def _is_hq(user_id):
    profile = Profiles.objects.filter(id=user_id).only('role', 'roles').first()
    if not profile:
        return False
    return profile.role == 'hq' or (profile.roles and 'hq' in profile.roles)


def _require_hq(request):
    if not request.user or not request.user.is_authenticated:
        return Response({'error': 'Forbidden'}, status=403)
    if not _is_hq(request.user.id):
        return Response({'error': 'Forbidden'}, status=403)
    return None


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def locations_list(request):
    countries = list(HqCountries.objects.values('id', 'name', 'code').order_by('name'))
    cities = list(HqCities.objects.values('id', 'country_id', 'name').order_by('name'))

    if request.query_params.get('withSchools') != '1':
        return Response({'countries': countries, 'cities': cities})

    # Only countries/cities where at least one ACTIVE school actually exists
    # (booking filters should reflect the real network, not the whole catalog)
    schools = Schools.objects.filter(active=True).values_list('country', 'city')
    norm = lambda v: (v or '').strip().lower()
    school_countries = {norm(c) for c, _ in schools}
    school_cities = {norm(ci) for _, ci in schools}

    # schools store country as name ("Italy") or code ("IT"): match both
    real_countries = [
        c for c in countries
        if norm(c['name']) in school_countries or norm(c['code']) in school_countries
    ]
    real_country_ids = {c['id'] for c in real_countries}
    real_cities = [
        c for c in cities
        if norm(c['name']) in school_cities and c['country_id'] in real_country_ids
    ]
    return Response({'countries': real_countries, 'cities': real_cities})


@api_view(['POST'])
@authentication_classes([SupabaseJWTAuthentication])
@permission_classes([AllowAny])
def countries_create(request):
    denied = _require_hq(request)
    if denied:
        return denied

    name = (request.data.get('name') or '').strip()
    code = (request.data.get('code') or '').strip().upper()
    if not name or not code:
        return Response({'error': 'name and code required'}, status=400)

    row = HqCountries.objects.create(name=name, code=code)
    return Response({'id': str(row.id), 'name': row.name, 'code': row.code})


@api_view(['DELETE'])
@authentication_classes([SupabaseJWTAuthentication])
@permission_classes([AllowAny])
def countries_delete(request, id):
    denied = _require_hq(request)
    if denied:
        return denied
    HqCountries.objects.filter(id=id).delete()
    return Response({'ok': True})


@api_view(['POST'])
@authentication_classes([SupabaseJWTAuthentication])
@permission_classes([AllowAny])
def cities_create(request):
    denied = _require_hq(request)
    if denied:
        return denied

    country_id = request.data.get('country_id')
    name = (request.data.get('name') or '').strip()
    if not country_id or not name:
        return Response({'error': 'country_id and name required'}, status=400)

    row = HqCities.objects.create(country_id=country_id, name=name)
    return Response({'id': str(row.id), 'country_id': str(row.country_id), 'name': row.name})


@api_view(['DELETE'])
@authentication_classes([SupabaseJWTAuthentication])
@permission_classes([AllowAny])
def cities_delete(request, id):
    denied = _require_hq(request)
    if denied:
        return denied
    HqCities.objects.filter(id=id).delete()
    return Response({'ok': True})
