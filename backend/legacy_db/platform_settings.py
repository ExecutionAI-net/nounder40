"""
Faz 2, fifth pilot resource: the generic platform_settings key/value
store. Three existing Next.js routes (brand-settings, homepage-settings,
platform-stats) all read/write this same table under their own key
namespaces (brand_*, stat_*) -- so one generic endpoint replaces the
read/write plumbing in all three; each route keeps its own
feature-specific validation/shaping on top.

RLS being replaced (platform_settings):
  platform_settings_public_read: SELECT true
  platform_settings_hq_write: ALL using get_my_role() = 'hq'
"""
from django.utils import timezone
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .auth import SupabaseJWTAuthentication
from .models import PlatformSettings, Profiles


def _is_hq(user_id):
    profile = Profiles.objects.filter(id=user_id).only('role', 'roles').first()
    if not profile:
        return False
    return profile.role == 'hq' or (profile.roles and 'hq' in profile.roles)


@api_view(['GET', 'POST'])
@authentication_classes([SupabaseJWTAuthentication])
@permission_classes([AllowAny])
def platform_settings(request):
    if request.method == 'GET':
        keys = request.query_params.get('keys')
        qs = PlatformSettings.objects.all()
        if keys:
            qs = qs.filter(key__in=keys.split(','))
        return Response({row['key']: row['value'] for row in qs.values('key', 'value')})

    if not request.user or not request.user.is_authenticated or not _is_hq(request.user.id):
        return Response({'error': 'Forbidden'}, status=403)

    if not isinstance(request.data, dict):
        return Response({'error': 'expected a {key: value} object'}, status=400)

    now = timezone.now()
    for key, value in request.data.items():
        PlatformSettings.objects.update_or_create(
            key=key, defaults={'value': str(value), 'updated_at': now},
        )
    return Response({'success': True})
