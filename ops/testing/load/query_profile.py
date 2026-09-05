"""
Per-endpoint latency AND SQL query count, measured in-process with the Django
test client. Query count is what explains the latency: a page that costs 400
queries is an N+1, not a slow database.

Run:  docker compose exec -T django python manage.py shell < ops/testing/load/query_profile.py
"""

import time

from django.db import connection, reset_queries
from django.test import Client
from django.conf import settings

settings.DEBUG = True  # required for connection.queries to be populated

PW = "LoadTest!2024"
c = Client()


def token(email):
    r = c.post("/api/auth/login/", data={"email": email, "password": PW},
               content_type="application/json")
    return r.json()["access"] if r.status_code == 200 else None


stu = token("load001@example.test")
own = token("owner.a@example.test")

ENDPOINTS = [
    ("public", "/api/schools/public/", None),
    ("public", "/api/student/lessons/", None),
    ("public", "/api/translations/", None),
    ("public", "/api/platform-stats/", None),
    ("public", "/api/locations/", None),
    ("student", "/api/auth/me/", stu),
    ("student", "/api/student/credits/", stu),
    ("student", "/api/student/bookings/", stu),
    ("student", "/api/student/packages/", stu),
    ("student", "/api/student/school-packages/", stu),
    ("student", "/api/student/credit-history/", stu),
    ("school", "/api/school/reports/", own),
    ("school", "/api/school/reports/detailed/", own),
    ("school", "/api/school/students/", own),
    ("school", "/api/school/lessons/", own),
    ("school", "/api/school/lessons-feed/", own),
    ("school", "/api/school/courses/", own),
    ("school", "/api/school/courses-overview/", own),
    ("school", "/api/school/transactions/", own),
    ("school", "/api/school/compensation-summary/", own),
    ("school", "/api/school/documents/", own),
    ("school", "/api/school/teachers/", own),
]

print(f"{'group':8} {'endpoint':42} {'ms':>8} {'queries':>8} {'kb':>7}  status")
print("-" * 88)
rows = []
for group, path, tok in ENDPOINTS:
    headers = {"HTTP_AUTHORIZATION": f"Bearer {tok}"} if tok else {}
    # warm once so import/lazy-load cost is not charged to the measurement
    c.get(path, **headers)
    reset_queries()
    t0 = time.perf_counter()
    r = c.get(path, **headers)
    ms = (time.perf_counter() - t0) * 1000
    n = len(connection.queries)
    kb = len(r.content) / 1024
    rows.append((group, path, ms, n, kb, r.status_code))
    print(f"{group:8} {path:42} {ms:8.0f} {n:8} {kb:7.1f}  {r.status_code}")

print("\n=== worst by query count (N+1 candidates) ===")
for g, p, ms, n, kb, s in sorted(rows, key=lambda x: -x[3])[:8]:
    print(f"  {n:5} queries  {ms:7.0f} ms  {p}")

print("\n=== worst by latency ===")
for g, p, ms, n, kb, s in sorted(rows, key=lambda x: -x[2])[:8]:
    print(f"  {ms:7.0f} ms  {n:5} queries  {kb:7.1f} kb  {p}")

print("\n=== largest payloads ===")
for g, p, ms, n, kb, s in sorted(rows, key=lambda x: -x[4])[:5]:
    print(f"  {kb:7.1f} kb  {p}")

print(f"\ncontext: users={__import__('django.contrib.auth', fromlist=['get_user_model']).get_user_model().objects.count()}")
