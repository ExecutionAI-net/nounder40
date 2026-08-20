from django.db import connection
from django.http import JsonResponse


def health_check(request):
    """Liveness + DB readiness in one endpoint (used by Docker healthcheck)."""
    db_ok = True
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except Exception:
        db_ok = False

    status = 200 if db_ok else 503
    return JsonResponse(
        {"status": "ok" if db_ok else "degraded", "database": "up" if db_ok else "down"},
        status=status,
    )
