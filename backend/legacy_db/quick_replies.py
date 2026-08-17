"""
Faz 2, second pilot resource. Mirrors src/app/api/chat/quick-replies/route.ts
exactly (same URL, same request/response shapes).

RLS being replaced (quick_replies_school policy): ALL using
school_id = get_my_school_id(). The existing route additionally requires
role == 'school' in application code -- replicated here as-is, not just
the bare RLS condition, to keep 1:1 behavioral parity.
"""
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .auth import SupabaseJWTAuthentication
from .models import Profiles, QuickReplyTemplates


def _school_profile_or_none(user_id):
    profile = Profiles.objects.filter(id=user_id).only('role', 'school_id').first()
    if not profile or profile.role != 'school' or not profile.school_id:
        return None
    return profile


def _list(profile):
    rows = QuickReplyTemplates.objects.filter(school_id=profile.school_id).order_by('title')
    return Response([{'id': str(r.id), 'title': r.title, 'content': r.content} for r in rows])


def _create(request, profile):
    title = request.data.get('title')
    content = request.data.get('content')
    if not title or not content:
        return Response({'error': 'title and content required'}, status=400)

    row = QuickReplyTemplates.objects.create(school_id=profile.school_id, title=title, content=content)
    return Response({'id': str(row.id), 'title': row.title, 'content': row.content})


def _delete(request, profile):
    row_id = request.data.get('id')
    QuickReplyTemplates.objects.filter(id=row_id, school_id=profile.school_id).delete()
    return Response({'deleted': True})


@api_view(['GET', 'POST', 'DELETE'])
@authentication_classes([SupabaseJWTAuthentication])
@permission_classes([AllowAny])
def quick_replies(request):
    if not request.user or not request.user.is_authenticated:
        return Response({'error': 'Unauthorized'}, status=401)

    profile = _school_profile_or_none(request.user.id)
    if profile is None:
        return Response({'error': 'Forbidden'}, status=403)

    if request.method == 'GET':
        return _list(profile)
    if request.method == 'POST':
        return _create(request, profile)
    return _delete(request, profile)
