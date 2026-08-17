from django.db import connection
from rest_framework.decorators import api_view
from rest_framework.response import Response


@api_view(['GET'])
def health(request):
    with connection.cursor() as cur:
        cur.execute('SELECT 1')
        cur.fetchone()
    return Response({'status': 'ok', 'database': 'connected'})
