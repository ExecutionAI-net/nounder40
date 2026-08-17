"""
Faz 2 pilot resource. Mirrors src/app/api/translations/route.ts exactly
(same URL, same request/response shapes) so that route becomes a thin
proxy to here instead of talking to Supabase directly -- nothing else
in the Next.js app has to change.

RLS being replaced (supabase/migrations/029_translations.sql):
  translations_read_all: SELECT true (public)
  translations_hq_write: ALL using get_my_role() = 'hq'
"""
from django.utils import timezone
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .auth import SupabaseJWTAuthentication
from .models import Profiles, Translations


def _is_hq(user_id):
    profile = Profiles.objects.filter(id=user_id).only('role').first()
    return bool(profile and profile.role == 'hq')


def _list():
    """GET -> [{key, en, it, es, fr, de}, ...], public read."""
    rows = Translations.objects.values('key', 'locale', 'value').order_by('key')
    by_key = {}
    for row in rows:
        by_key.setdefault(row['key'], {})[row['locale']] = row['value'] or ''
    return Response([{'key': key, **locales} for key, locales in by_key.items()])


def _require_hq(request):
    """Returns a 401/403 Response if the caller isn't HQ, else None."""
    if not request.user or not request.user.is_authenticated:
        return Response({'error': 'Unauthorized'}, status=401)
    if not _is_hq(request.user.id):
        return Response({'error': 'Forbidden'}, status=403)
    return None


def _upsert(request):
    """POST {key, locale, value} -> upsert, HQ only."""
    denied = _require_hq(request)
    if denied:
        return denied

    key = request.data.get('key')
    locale = request.data.get('locale')
    value = request.data.get('value')
    if not key or not locale or value is None:
        return Response({'error': 'key, locale, and value are required'}, status=400)

    Translations.objects.update_or_create(
        key=key, locale=locale,
        defaults={'value': value, 'updated_at': timezone.now()},
    )
    return Response({'ok': True})


def _delete(request):
    """DELETE {key} -> delete all locales for key, HQ only."""
    denied = _require_hq(request)
    if denied:
        return denied

    key = request.data.get('key')
    if not key:
        return Response({'error': 'key is required'}, status=400)

    Translations.objects.filter(key=key).delete()
    return Response({'ok': True})


@api_view(['GET', 'POST', 'DELETE'])
@authentication_classes([SupabaseJWTAuthentication])
@permission_classes([AllowAny])
def translations(request):
    if request.method == 'GET':
        return _list()
    if request.method == 'POST':
        return _upsert(request)
    return _delete(request)
