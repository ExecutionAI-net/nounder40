from django.db import connection
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .auth import SupabaseJWTAuthentication
from .models import Profiles


@api_view(['GET'])
def health(request):
    with connection.cursor() as cur:
        cur.execute('SELECT 1')
        cur.fetchone()
    return Response({'status': 'ok', 'database': 'connected'})


@api_view(['GET'])
@authentication_classes([SupabaseJWTAuthentication])
@permission_classes([IsAuthenticated])
def whoami(request):
    user = request.user
    profile = Profiles.objects.filter(id=user.id).first()
    roles = profile.roles if (profile and profile.roles) else ([profile.role] if profile else [])
    return Response({
        'id': str(user.id),
        'email': user.email,
        'profile_name': profile.name if profile else None,
        'roles': roles,
    })
