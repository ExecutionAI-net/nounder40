"""
Faz 2, fourth pilot resource: HQ's library content catalog. Mirrors 3
existing Next.js routes exactly:
  GET    /api/teacher/library      (any authenticated user, despite the URL)
  GET    /api/hq/library           (public -- the original route has no
                                     auth check at all on GET, only POST)
  POST   /api/hq/library           (HQ only)
  PATCH  /api/hq/library/<id>      (HQ only)
  DELETE /api/hq/library/<id>      (HQ only)

RLS being replaced (library_content):
  library_hq_all: ALL using get_my_role() = 'hq'
  library_read_active: SELECT using active = true AND (school_id IS NULL
    OR school_id = get_my_school_id())
  library_school_own: ALL using school_id = get_my_school_id() AND
    get_my_role() = 'school' (not exercised by any current route -- no
    school-facing write endpoint exists yet, so not built here either)

Bug fixed while porting: the original POST/PATCH set title_en/it/fr/es
from the incoming `title` but never the plain NOT-NULL `title` column
itself. POST would have hit a NOT NULL constraint violation on every
call (confirmed: all 3 existing HQ rows have title_en=NULL, meaning
this path has never actually succeeded); PATCH silently left `title`
stale. Both now also write the plain `title` column.
"""
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .auth import SupabaseJWTAuthentication
from .models import LibraryContent, Profiles


def _is_hq(user_id):
    profile = Profiles.objects.filter(id=user_id).only('role', 'roles').first()
    if not profile:
        return False
    return profile.role == 'hq' or (profile.roles and 'hq' in profile.roles)


def _require_hq(request):
    if not request.user or not request.user.is_authenticated or not _is_hq(request.user.id):
        return Response({'error': 'Forbidden'}, status=403)
    return None


def _serialize(row, full=False):
    data = {
        'id': str(row.id),
        'school_id': str(row.school_id) if row.school_id else None,
        'lesson_type_id': str(row.lesson_type_id) if row.lesson_type_id else None,
        'title_en': row.title_en,
        'title_it': row.title_it,
        'title_fr': row.title_fr,
        'title_es': row.title_es,
        'description': row.description,
        'file_url': row.file_url,
        'thumbnail_url': row.thumbnail_url,
        'type': row.type,
        'duration_seconds': row.duration_seconds,
        'level': row.level,
        'language': row.language,
        'visible_to_students': row.visible_to_students,
        'student_access': row.student_access,
        'price': str(row.price) if row.price is not None else None,
        'active': row.active,
        'created_at': row.created_at.isoformat(),
        'lesson_types': {'name_en': row.lesson_type.name_en} if row.lesson_type_id else None,
    }
    if full:
        data['title'] = row.title
    else:
        data['title'] = row.title_en or row.title_it or row.title_fr or row.title_es or ''
    return data


def _apply_filters(qs, request):
    type_ = request.query_params.get('type')
    level = request.query_params.get('level')
    language = request.query_params.get('language')
    if type_ and type_ != 'all':
        qs = qs.filter(type=type_)
    if level and level != 'all':
        qs = qs.filter(level=level)
    if language and language != 'all':
        qs = qs.filter(language=language)
    return qs


@api_view(['GET'])
@authentication_classes([SupabaseJWTAuthentication])
@permission_classes([AllowAny])
def teacher_library_list(request):
    if not request.user or not request.user.is_authenticated:
        return Response({'error': 'Unauthorized'}, status=401)

    qs = LibraryContent.objects.select_related('lesson_type').filter(
        active=True, school_id__isnull=True,
    ).order_by('-created_at')
    qs = _apply_filters(qs, request)
    # teacher/library selects '*' with no title normalization -- raw title column
    return Response([_serialize(r, full=True) for r in qs])


@api_view(['GET', 'POST'])
@authentication_classes([SupabaseJWTAuthentication])
@permission_classes([AllowAny])
def hq_library_list(request):
    if request.method == 'GET':
        qs = LibraryContent.objects.select_related('lesson_type').filter(
            school_id__isnull=True,
        ).order_by('-created_at')
        qs = _apply_filters(qs, request)
        return Response([_serialize(r) for r in qs])

    denied = _require_hq(request)
    if denied:
        return denied

    title = request.data.get('title')
    type_ = request.data.get('type')
    if not title or not type_:
        return Response({'error': 'title and type are required'}, status=400)

    row = LibraryContent.objects.create(
        title=title,
        title_en=title, title_it=title, title_fr=title, title_es=title,
        type=type_,
        level=request.data.get('level') or 'all',
        language=request.data.get('language') or 'en',
        description=request.data.get('description'),
        file_url=request.data.get('file_url'),
        thumbnail_url=request.data.get('thumbnail_url'),
        duration_seconds=request.data.get('duration_seconds') or None,
        visible_to_students=request.data.get('visible_to_students') or False,
        student_access=request.data.get('student_access') or 'included',
        price=request.data.get('price') or None,
        school_id=None,
    )
    return Response(_serialize(row, full=True))


@api_view(['PATCH', 'DELETE'])
@authentication_classes([SupabaseJWTAuthentication])
@permission_classes([AllowAny])
def hq_library_detail(request, id):
    denied = _require_hq(request)
    if denied:
        return denied

    if request.method == 'DELETE':
        LibraryContent.objects.filter(id=id, school_id__isnull=True).delete()
        return Response({'success': True})

    row = LibraryContent.objects.filter(id=id, school_id__isnull=True).first()
    if not row:
        return Response({'error': 'Not found'}, status=404)

    body = dict(request.data)
    if body.get('title'):
        title = body.pop('title')
        body['title_en'] = body['title_it'] = body['title_fr'] = body['title_es'] = title
        body['title'] = title  # bug fix: keep the plain column in sync too

    for field, value in body.items():
        setattr(row, field, value)
    row.save()
    return Response(_serialize(row, full=True))
