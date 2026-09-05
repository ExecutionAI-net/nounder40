#!/usr/bin/env python3
"""
Fills the gap the first probe skipped: student B had no bookings or documents,
so the object-level IDOR checks never ran. Create them, then try to reach them
as student A (a different tenant entirely).
"""

import os
import sys

import requests

BASE = (sys.argv[1] if len(sys.argv) > 1 else
        os.environ.get("BASE", "http://host.docker.internal:8080")).rstrip("/")
PW = "LoadTest!2024"
S = requests.Session()
out = []


def api(method, path, token=None, **kw):
    h = {"Authorization": f"Bearer {token}"} if token else {}
    h.update(kw.pop("headers", {}))
    return S.request(method, f"{BASE}{path}", headers=h, timeout=30, **kw)


def login(email):
    r = api("POST", "/api/auth/login/", json={"email": email, "password": PW})
    return r.json()["access"] if r.status_code == 200 else None


def record(ok, sev, title, detail):
    out.append((ok, sev, title, detail))
    print(f"  {'PASS' if ok else 'FAIL[' + sev + ']':12} {title}")
    if not ok:
        print(f"               -> {detail}")


a, b = login("student.a@example.test"), login("student.b@example.test")
owner_b = login("owner.b@example.test")

# --- make student B own a booking -----------------------------------------
lessons_b = api("GET", "/api/school/lessons/", owner_b).json()
booking_id = None
for les in lessons_b[:6]:
    r = api("POST", "/api/bookings/", b, json={"lesson": les["id"]})
    print(f"    student B books {les['id'][:8]} -> HTTP {r.status_code} {r.text[:110]}")
    if r.status_code in (200, 201):
        booking_id = r.json().get("id")
        break

if not booking_id:
    mine = api("GET", "/api/student/bookings/", b)
    ids = [x["id"] for x in mine.json()] if mine.status_code == 200 and isinstance(mine.json(), list) else []
    booking_id = ids[0] if ids else None

print(f"\n[*] student B booking id: {booking_id}\n")

if booking_id:
    print("[1] object-level IDOR on bookings")
    r = api("GET", f"/api/bookings/{booking_id}/", a)
    record(r.status_code in (403, 404), "CRITICAL",
           "student A cannot READ student B booking",
           f"HTTP {r.status_code}: {r.text[:200]}")

    r = api("PATCH", f"/api/bookings/{booking_id}/", a, json={"status": "cancelled"})
    record(r.status_code in (403, 404, 405), "CRITICAL",
           "student A cannot MODIFY student B booking",
           f"HTTP {r.status_code}: {r.text[:200]}")

    r = api("DELETE", f"/api/bookings/{booking_id}/", a)
    record(r.status_code in (403, 404, 405), "CRITICAL",
           "student A cannot CANCEL student B booking",
           f"HTTP {r.status_code}: {r.text[:200]}")

    # Unauthenticated too.
    r = api("GET", f"/api/bookings/{booking_id}/")
    record(r.status_code in (401, 403), "CRITICAL",
           "anonymous cannot read a booking by id",
           f"HTTP {r.status_code}: {r.text[:200]}")

    # A school admin from the OTHER school.
    r = api("GET", f"/api/bookings/{booking_id}/", login("owner.a@example.test"))
    record(r.status_code in (403, 404), "CRITICAL",
           "school A admin cannot read a school B booking",
           f"HTTP {r.status_code}: {r.text[:200]}")

    # Still there afterwards? (proves the writes above really were refused)
    chk = api("GET", "/api/student/bookings/", b)
    still = any(x["id"] == booking_id and x.get("status") != "cancelled"
                for x in chk.json()) if chk.status_code == 200 else False
    record(still, "CRITICAL", "student B booking survived student A's write attempts",
           f"booking no longer active after cross-tenant PATCH/DELETE: {chk.text[:200]}")

# --- documents -------------------------------------------------------------
print("\n[2] private document access")
docs_b = api("GET", "/api/school/documents/", owner_b)
doc_id = None
if docs_b.status_code == 200:
    data = docs_b.json()
    rows = data.get("students", data) if isinstance(data, dict) else data
    for s in (rows or []):
        for d in (s.get("documents") or []) if isinstance(s, dict) else []:
            doc_id = d.get("id")
            break
        if doc_id:
            break
print(f"    school B document id: {doc_id}")
if doc_id:
    for tok, who in [(a, "student A"), (None, "anonymous"),
                     (login("owner.a@example.test"), "school A admin")]:
        r = api("GET", f"/api/documents/{doc_id}/file/", tok)
        record(r.status_code in (401, 403, 404), "CRITICAL",
               f"{who} cannot fetch a school B private document",
               f"HTTP {r.status_code}, {len(r.content)} bytes")
else:
    print("    SKIP  no document exists to probe (upload path not exercised)")

# --- credit tampering via booking ------------------------------------------
print("\n[3] credit integrity")
before = api("GET", "/api/student/credits/", a).text
r = api("POST", "/api/bookings/", a, json={"lesson": lessons_b[0]["id"], "credits_deducted": 0})
print(f"    student A books school B lesson w/ credits_deducted=0 -> HTTP {r.status_code} {r.text[:150]}")
record(r.status_code not in (200, 201), "CRITICAL",
       "student A still cannot book across tenants with a forged credit field",
       f"HTTP {r.status_code}: {r.text[:200]}")
after = api("GET", "/api/student/credits/", a).text
record(before == after, "HIGH", "student A credit balance unchanged by the attempt",
       f"before={before[:90]} after={after[:90]}")

fails = [x for x in out if not x[0]]
print("\n" + "=" * 70)
print(f"PASSED: {len(out) - len(fails)}   FAILED: {len(fails)}")
for ok, sev, title, detail in fails:
    print(f"  [{sev}] {title}\n      {detail}")
print("=" * 70)
