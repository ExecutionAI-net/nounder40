#!/usr/bin/env python3
"""
Verification pass: re-test the authz_probe findings against personas built
through the REAL API flows, not the seeder. The seeder set `active_school` on
students, which self-registration never does — so the first run's "student
reads school admin data" hits had to be re-checked against an honest persona.
"""

import json
import os
import sys
import time

import requests

BASE = (sys.argv[1] if len(sys.argv) > 1 else
        os.environ.get("BASE", "http://host.docker.internal:8080")).rstrip("/")
PW = "LoadTest!2024"
S = requests.Session()
stamp = int(time.time())


def api(method, path, token=None, **kw):
    h = {"Authorization": f"Bearer {token}"} if token else {}
    h.update(kw.pop("headers", {}))
    return S.request(method, f"{BASE}{path}", headers=h, timeout=30, **kw)


def login(email, pw=PW):
    r = api("POST", "/api/auth/login/", json={"email": email, "password": pw})
    return r.json()["access"] if r.status_code == 200 else None


SCHOOL_ADMIN_PATHS = [
    "/api/school/students/", "/api/school/transactions/", "/api/school/reports/",
    "/api/school/teachers/", "/api/school/profile/", "/api/school/credits/grants/",
    "/api/school/compensation-summary/", "/api/school/lessons/", "/api/school/courses/",
    "/api/school/documents/", "/api/school/packages/", "/api/school/discount-codes/",
]

print(f"=== verification against {BASE} ===\n")

# ---------------------------------------------------------------------------
print("[A] realistic self-registered student (active_school never set)")
email = f"real-student-{stamp}@example.test"
r = api("POST", "/api/auth/register/", json={
    "email": email, "password": PW, "first_name": "Real", "last_name": "Student",
    "phone": "+390000000000", "language_preference": "en"})
print(f"    register -> HTTP {r.status_code}")
real_tok = r.json().get("access") if r.status_code in (200, 201) else login(email)

# Join a school the way the product does it (public list -> pick -> join).
pub = api("GET", "/api/schools/public/").json()
school_id = (pub[0]["id"] if isinstance(pub, list) and pub else None)
j = api("POST", "/api/student/school/", real_tok, json={"school_id": school_id})
print(f"    join school {school_id} -> HTTP {j.status_code}")

# Book a lesson too — the other path that links a student to a school.
les = api("GET", "/api/student/lessons/", real_tok)
lids = [x["id"] for x in les.json()] if les.status_code == 200 and isinstance(les.json(), list) else []
if lids:
    b = api("POST", "/api/bookings/", real_tok, json={"lesson": lids[0]})
    print(f"    book lesson -> HTTP {b.status_code}")

print("    -- school admin surface as this realistic student --")
leaked = []
for p in SCHOOL_ADMIN_PATHS:
    r = api("GET", p, real_tok)
    body = r.text[:100].replace("\n", " ")
    empty = body.strip() in ("[]", "{}", "")
    flag = "LEAK" if (r.status_code == 200 and not empty) else "ok  "
    if flag == "LEAK":
        leaked.append((p, r.status_code, body))
    print(f"      {flag} {p:42} HTTP {r.status_code}  {body[:70]}")

# ---------------------------------------------------------------------------
print("\n[B] seeded student (active_school WAS set — the artificial case)")
seed_tok = login("student.a@example.test")
seed_leaked = []
for p in SCHOOL_ADMIN_PATHS:
    r = api("GET", p, seed_tok)
    body = r.text[:100].replace("\n", " ")
    empty = body.strip() in ("[]", "{}", "")
    flag = "LEAK" if (r.status_code == 200 and not empty) else "ok  "
    if flag == "LEAK":
        seed_leaked.append((p, r.status_code, body))
    print(f"      {flag} {p:42} HTTP {r.status_code}  {body[:70]}")

# Can that student WRITE, not just read?
print("\n    -- write attempts as the active_school-bearing student --")
w = api("POST", "/api/school/locations/", seed_tok, json={"name": "pwned-location"})
print(f"      POST /api/school/locations/       HTTP {w.status_code}  {w.text[:110]}")
w2 = api("POST", "/api/school/credits/grant/", seed_tok,
         json={"student": "x", "credits": 999, "note": "probe"})
print(f"      POST /api/school/credits/grant/   HTTP {w2.status_code}  {w2.text[:110]}")

# ---------------------------------------------------------------------------
print("\n[C] teacher — does a teacher reach school admin data?")
t_tok = login("teacher.a@example.test")
for p in ["/api/school/transactions/", "/api/school/reports/",
          "/api/school/compensation-summary/", "/api/school/students/"]:
    r = api("GET", p, t_tok)
    print(f"      {p:42} HTTP {r.status_code}  {r.text[:80]}")

# ---------------------------------------------------------------------------
print("\n[D] student A lesson feed vs school B lessons (precise re-check)")
own_b = api("GET", "/api/school/lessons/", login("owner.b@example.test"))
b_ids = {x["id"] for x in own_b.json()} if own_b.status_code == 200 else set()
own_a = api("GET", "/api/school/lessons/", login("owner.a@example.test"))
a_ids = {x["id"] for x in own_a.json()} if own_a.status_code == 200 else set()
feed = api("GET", "/api/student/lessons/", login("student.a@example.test"))
f_ids = {x["id"] for x in feed.json()} if feed.status_code == 200 else set()
print(f"      school A lessons: {len(a_ids)}   school B lessons: {len(b_ids)}")
print(f"      student A feed  : {len(f_ids)}")
print(f"      feed ∩ school B : {len(f_ids & b_ids)}  <-- must be 0")
print(f"      feed ∩ school A : {len(f_ids & a_ids)}")

# Realistic student's feed, too.
feed2 = api("GET", "/api/student/lessons/", real_tok)
f2 = {x["id"] for x in feed2.json()} if feed2.status_code == 200 else set()
print(f"      realistic student feed: {len(f2)}  ∩ school B: {len(f2 & b_ids)}")

# ---------------------------------------------------------------------------
print("\n[E] /media/private/ — follow the 308 redirect")
for p in ["/media/private/", "/media/private", "/media/private/../../etc/passwd"]:
    r = S.get(f"{BASE}{p}", timeout=30, allow_redirects=True)
    print(f"      {p:38} final={r.status_code} url={r.url[-60:]} len={len(r.content)}")

# ---------------------------------------------------------------------------
print("\n[F] /admin/ exposure — prod nginx vs local")
for p in ["/admin/", "/admin/login/"]:
    r = S.get(f"{BASE}{p}", timeout=30, allow_redirects=False)
    print(f"      {p:20} HTTP {r.status_code}  loc={r.headers.get('Location')}")

# ---------------------------------------------------------------------------
print("\n[G] HQ brand-settings readable by a school admin — by design?")
r = api("GET", "/api/hq/brand-settings/", login("owner.a@example.test"))
print(f"      school admin GET /api/hq/brand-settings/  HTTP {r.status_code}  {r.text[:160]}")
r = api("GET", "/api/hq/brand-settings/", real_tok)
print(f"      student     GET /api/hq/brand-settings/  HTTP {r.status_code}  {r.text[:160]}")
r = api("PATCH", "/api/hq/brand-settings/", login("owner.a@example.test"), json={"primary_color": "#000000"})
print(f"      school admin PATCH                        HTTP {r.status_code}  {r.text[:160]}")

# ---------------------------------------------------------------------------
print("\n[H] rate limiting re-confirm (login + reset + register)")
for label, path, payload in [
    ("login", "/api/auth/login/", lambda i: {"email": "student.a@example.test", "password": f"w{i}"}),
    ("reset", "/api/auth/password-reset/", lambda i: {"email": f"n{i}@example.test"}),
    ("register", "/api/auth/register/", lambda i: {
        "email": f"rl-{stamp}-{i}@example.test", "password": PW, "first_name": "A",
        "last_name": "B", "phone": "+390000000000"}),
]:
    codes = []
    t0 = time.time()
    for i in range(20):
        rr = api("POST", path, json=payload(i))
        codes.append(rr.status_code)
        if rr.status_code == 429:
            break
    print(f"      {label:9} {len(codes)} reqs in {time.time()-t0:5.1f}s  "
          f"statuses={sorted(set(codes))}  429={'YES' if 429 in codes else 'NO'}")

print("\n" + "=" * 72)
print("VERDICT")
print(f"  realistic student leaks : {len(leaked)} endpoint(s)")
for p, c, b in leaked:
    print(f"      {p} -> {c} {b[:70]}")
print(f"  seeded student  leaks : {len(seed_leaked)} endpoint(s)")
print("=" * 72)

with open(os.environ.get("OUT", "/out/verify_findings.json"), "w", encoding="utf-8") as fh:
    json.dump({"realistic_leaks": leaked, "seeded_leaks": seed_leaked}, fh, indent=2)
