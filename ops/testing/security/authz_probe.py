#!/usr/bin/env python3
"""
Multi-tenant authorization / IDOR / JWT probe.

Every check states what SHOULD happen; anything else is reported as a finding.
Read-only by design except where a write is the only way to prove a boundary
(those use throwaway seed rows in the local stack).

Usage:
    python authz_probe.py [base_url]        # default http://host.docker.internal:8080
"""

import json
import os
import sys
import time
import urllib.parse

import requests

BASE = (sys.argv[1] if len(sys.argv) > 1 else
        os.environ.get("BASE", "http://host.docker.internal:8080")).rstrip("/")
PW = "LoadTest!2024"

S = requests.Session()
S.headers["User-Agent"] = "authz-probe/1.0"
findings = []
passed = []


def record(ok, severity, title, detail):
    (passed if ok else findings).append(
        {"severity": severity, "title": title, "detail": detail})
    mark = "PASS" if ok else f"FAIL[{severity}]"
    print(f"  {mark:12} {title}")
    if not ok:
        print(f"               -> {detail}")


def login(email, password=PW):
    r = S.post(f"{BASE}/api/auth/login/", json={"email": email, "password": password}, timeout=30)
    if r.status_code != 200:
        raise SystemExit(f"login failed for {email}: {r.status_code} {r.text[:200]}")
    return r.json()["access"]


def call(token, method, path, **kw):
    h = {"Authorization": f"Bearer {token}"} if token else {}
    h.update(kw.pop("headers", {}))
    return S.request(method, f"{BASE}{path}", headers=h, timeout=30, **kw)


def ids_of(resp):
    """Pull id values out of a list or paginated DRF response."""
    try:
        d = resp.json()
    except Exception:
        return []
    if isinstance(d, dict):
        d = d.get("results", d.get("data", []))
    if not isinstance(d, list):
        return []
    return [str(x.get("id")) for x in d if isinstance(x, dict) and x.get("id")]


print(f"\n=== target: {BASE} ===\n")

# ---------------------------------------------------------------- identities
print("[*] authenticating test identities")
tok = {
    "student_a": login("student.a@example.test"),
    "student_b": login("student.b@example.test"),
    "owner_a": login("owner.a@example.test"),
    "owner_b": login("owner.b@example.test"),
    "teacher_a": login("teacher.a@example.test"),
    "hq": login("hq.test@example.test"),
}
print(f"    ok ({len(tok)} identities)\n")

# Resolve each tenant's own object ids, from its own authorized view.
me_a = call(tok["student_a"], "GET", "/api/auth/me/").json()
me_b = call(tok["student_b"], "GET", "/api/auth/me/").json()

lessons_a = ids_of(call(tok["student_a"], "GET", "/api/student/lessons/"))
lessons_b = ids_of(call(tok["student_b"], "GET", "/api/student/lessons/"))
sch_lessons_a = ids_of(call(tok["owner_a"], "GET", "/api/school/lessons/"))
sch_lessons_b = ids_of(call(tok["owner_b"], "GET", "/api/school/lessons/"))
students_a = ids_of(call(tok["owner_a"], "GET", "/api/school/students/"))
students_b = ids_of(call(tok["owner_b"], "GET", "/api/school/students/"))
courses_b = ids_of(call(tok["owner_b"], "GET", "/api/school/courses/"))
packages_b = ids_of(call(tok["owner_b"], "GET", "/api/school/packages/"))

print(f"    school A: lessons={len(sch_lessons_a)} students={len(students_a)}")
print(f"    school B: lessons={len(sch_lessons_b)} students={len(students_b)} "
      f"courses={len(courses_b)} packages={len(packages_b)}\n")

# =========================================================== 1. role boundary
print("[1] role boundary — student/teacher must not reach admin surfaces")
STUDENT_FORBIDDEN = [
    ("GET", "/api/school/students/"), ("GET", "/api/school/transactions/"),
    ("GET", "/api/school/reports/"), ("GET", "/api/school/teachers/"),
    ("GET", "/api/school/profile/"), ("GET", "/api/school/credits/grants/"),
    ("GET", "/api/hq/schools/"), ("GET", "/api/hq/students/"),
    ("GET", "/api/hq/transactions/"), ("GET", "/api/hq/team/"),
    ("GET", "/api/hq/reports/"), ("GET", "/api/hq/email-settings/"),
    ("GET", "/api/hq/permissions/"), ("GET", "/api/hq/discount-codes/"),
    ("GET", "/api/school/compensation-summary/"),
    ("GET", "/api/teacher/compensation/"),
]
for m, p in STUDENT_FORBIDDEN:
    r = call(tok["student_a"], m, p)
    record(r.status_code in (401, 403, 404), "CRITICAL",
           f"student blocked from {p}",
           f"got HTTP {r.status_code}, body={r.text[:180]}")

TEACHER_FORBIDDEN = [
    ("GET", "/api/school/transactions/"), ("GET", "/api/school/reports/"),
    ("GET", "/api/school/credits/grants/"), ("GET", "/api/hq/schools/"),
    ("GET", "/api/hq/transactions/"), ("GET", "/api/hq/team/"),
    ("GET", "/api/school/compensation-summary/"),
]
for m, p in TEACHER_FORBIDDEN:
    r = call(tok["teacher_a"], m, p)
    record(r.status_code in (401, 403, 404), "HIGH",
           f"teacher blocked from {p}",
           f"got HTTP {r.status_code}, body={r.text[:180]}")

SCHOOL_FORBIDDEN = [
    ("GET", "/api/hq/schools/"), ("GET", "/api/hq/students/"),
    ("GET", "/api/hq/transactions/"), ("GET", "/api/hq/team/"),
    ("GET", "/api/hq/reports/"), ("GET", "/api/hq/permissions/"),
    ("GET", "/api/hq/email-settings/"), ("GET", "/api/hq/brand-settings/"),
]
for m, p in SCHOOL_FORBIDDEN:
    r = call(tok["owner_a"], m, p)
    record(r.status_code in (401, 403, 404), "CRITICAL",
           f"school-admin blocked from {p}",
           f"got HTTP {r.status_code}, body={r.text[:180]}")

# ==================================================== 2. cross-tenant reading
print("\n[2] cross-tenant — school A admin must not read school B objects")
for label, ids, tmpl in [
    ("lesson", sch_lessons_b, "/api/school/lessons/{}/"),
    ("course", courses_b, "/api/school/courses/{}/"),
    ("package", packages_b, "/api/school/packages/{}/"),
]:
    if not ids:
        print(f"  SKIP         no school-B {label} to probe")
        continue
    r = call(tok["owner_a"], "GET", tmpl.format(ids[0]))
    record(r.status_code in (403, 404), "CRITICAL",
           f"owner A cannot read school B {label} by id",
           f"HTTP {r.status_code} leaked: {r.text[:220]}")

# Attendance is keyed by lesson id straight from the URL — classic IDOR spot.
if sch_lessons_b:
    r = call(tok["owner_a"], "GET", f"/api/school/attendance/{sch_lessons_b[0]}/")
    record(r.status_code in (403, 404), "CRITICAL",
           "owner A cannot read school B attendance",
           f"HTTP {r.status_code} leaked: {r.text[:220]}")
    r = call(tok["teacher_a"], "GET", f"/api/teacher/attendance/{sch_lessons_b[0]}/")
    record(r.status_code in (403, 404), "CRITICAL",
           "teacher A cannot read school B attendance",
           f"HTTP {r.status_code} leaked: {r.text[:220]}")

# Tenant scoping must ignore attacker-supplied school hints.
if students_b:
    for qp in ("school", "school_id"):
        r = call(tok["owner_a"], "GET",
                 f"/api/school/students/?{qp}=" + urllib.parse.quote(
                     call(tok["owner_b"], "GET", "/api/school/profile/").json().get("id", "")))
        leaked = set(ids_of(r)) & set(students_b)
        record(not leaked, "CRITICAL",
               f"school students list ignores ?{qp}= override",
               f"HTTP {r.status_code}; leaked school-B student ids: {list(leaked)[:5]}")

# Student-level cross-tenant
r = call(tok["student_a"], "GET", "/api/student/lessons/")
leaked = set(ids_of(r)) & set(lessons_b)
record(not leaked, "CRITICAL", "student A lesson feed excludes school B lessons",
       f"leaked lesson ids: {list(leaked)[:5]}")

r = call(tok["student_a"], "GET", "/api/student/school-packages/")
pkg_leak = set(ids_of(r)) & set(packages_b)
record(not pkg_leak, "HIGH", "student A package list excludes school B packages",
       f"leaked package ids: {list(pkg_leak)[:5]}")

# ============================================== 3. IDOR on student-owned rows
print("\n[3] IDOR — object ids belonging to another user")
sid_b = me_b.get("student_id") or me_b.get("id")
uid_b = me_b.get("id")

bookings_b = ids_of(call(tok["student_b"], "GET", "/api/student/bookings/"))
if bookings_b:
    r = call(tok["student_a"], "GET", f"/api/bookings/{bookings_b[0]}/")
    record(r.status_code in (403, 404), "CRITICAL",
           "student A cannot read student B booking by id",
           f"HTTP {r.status_code} leaked: {r.text[:220]}")
    r = call(tok["student_a"], "DELETE", f"/api/bookings/{bookings_b[0]}/")
    record(r.status_code in (403, 404, 405), "CRITICAL",
           "student A cannot cancel student B booking",
           f"HTTP {r.status_code} body: {r.text[:220]}")
else:
    print("  SKIP         student B has no bookings to probe")

docs_b = ids_of(call(tok["student_b"], "GET", "/api/student/documents/"))
if docs_b:
    r = call(tok["student_a"], "GET", f"/api/documents/{docs_b[0]}/file/")
    record(r.status_code in (403, 404), "CRITICAL",
           "student A cannot fetch student B private document",
           f"HTTP {r.status_code}")
else:
    print("  SKIP         student B has no documents to probe")

# Booking a lesson that belongs to a school the student is not enrolled in.
if lessons_b or sch_lessons_b:
    target = (sch_lessons_b or lessons_b)[0]
    r = call(tok["student_a"], "POST", "/api/bookings/", json={"lesson": target})
    record(r.status_code not in (200, 201), "CRITICAL",
           "student A cannot book a school B lesson",
           f"HTTP {r.status_code} body: {r.text[:220]}")

# Profile tampering: can a student rewrite identity fields the server owns?
r = call(tok["student_a"], "PATCH", "/api/student/profile/",
         json={"credits": 99999, "school": None, "badge": "vip"})
if r.status_code in (200, 202):
    after = call(tok["student_a"], "GET", "/api/student/credits/")
    body = after.text[:200]
    record("99999" not in body, "HIGH",
           "student cannot self-assign credits via profile PATCH",
           f"credits endpoint now reports: {body}")
else:
    record(True, "HIGH", "student cannot self-assign credits via profile PATCH",
           f"PATCH rejected with HTTP {r.status_code}")

# ============================================================ 4. JWT handling
print("\n[4] JWT handling")
good = tok["student_a"]
hdr, pay, sig = good.split(".")

import base64


def b64u(d):
    return base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")


def dec(seg):
    return json.loads(base64.urlsafe_b64decode(seg + "=" * (-len(seg) % 4)))


claims = dec(pay)
print(f"    access-token claims: {sorted(claims.keys())}")

r = call(f"{hdr}.{pay}.", "GET", "/api/auth/me/")
record(r.status_code == 401, "CRITICAL", "signature-stripped token rejected",
       f"HTTP {r.status_code}: {r.text[:150]}")

none_tok = f"{b64u({'alg': 'none', 'typ': 'JWT'})}.{pay}."
r = call(none_tok, "GET", "/api/auth/me/")
record(r.status_code == 401, "CRITICAL", "alg=none token rejected",
       f"HTTP {r.status_code}: {r.text[:150]}")

esc = dict(claims, role="hq", roles=["hq"])
r = call(f"{hdr}.{b64u(esc)}.{sig}", "GET", "/api/hq/schools/")
record(r.status_code in (401, 403), "CRITICAL",
       "role-elevated token (re-signed payload) rejected",
       f"HTTP {r.status_code}: {r.text[:150]}")

r = call(good + "x", "GET", "/api/auth/me/")
record(r.status_code == 401, "CRITICAL", "tampered signature rejected",
       f"HTTP {r.status_code}")

# Does the server trust the `role` claim, or re-read the DB?
r = call(tok["student_a"], "GET", "/api/auth/my-role/")
print(f"    my-role for student A: HTTP {r.status_code} {r.text[:120]}")

# Refresh-token reuse after logout should be dead if blacklisting is wired.
tmp = S.post(f"{BASE}/api/auth/login/",
             json={"email": "load001@example.test", "password": PW}, timeout=30).json()
S.post(f"{BASE}/api/auth/logout/", json={"refresh": tmp["refresh"]},
       headers={"Authorization": f"Bearer {tmp['access']}"}, timeout=30)
r = S.post(f"{BASE}/api/auth/refresh/", json={"refresh": tmp["refresh"]}, timeout=30)
record(r.status_code != 200, "HIGH", "refresh token dead after logout (blacklisted)",
       f"HTTP {r.status_code} — logout did not invalidate the refresh token")

# =================================================== 5. unauthenticated reach
print("\n[5] unauthenticated access")
PUBLIC_OK = {"/api/health/", "/api/schools/public/", "/api/platform-stats/",
             "/api/locations/", "/api/translations/", "/api/docs/", "/api/schema/"}
UNAUTH_PROBE = [
    "/api/student/credits/", "/api/student/bookings/", "/api/student/profile/",
    "/api/school/students/", "/api/school/transactions/", "/api/school/reports/",
    "/api/hq/schools/", "/api/hq/students/", "/api/hq/transactions/",
    "/api/hq/reports/", "/api/hq/email-settings/", "/api/teacher/lessons/",
    "/api/chat/conversations/", "/api/bookings/", "/api/stripe/invoices/",
]
for p in UNAUTH_PROBE:
    r = call(None, "GET", p)
    record(r.status_code in (401, 403), "CRITICAL", f"unauthenticated blocked from {p}",
           f"HTTP {r.status_code}: {r.text[:180]}")

for p in sorted(PUBLIC_OK):
    r = call(None, "GET", p)
    print(f"    public {p:26} HTTP {r.status_code} ({len(r.content)}b)")

# ================================================ 6. rate limiting / policies
print("\n[6] rate limiting & credential policy")
t0 = time.time()
codes = []
for i in range(30):
    rr = S.post(f"{BASE}/api/auth/login/",
                json={"email": "student.a@example.test", "password": f"wrong-{i}"}, timeout=30)
    codes.append(rr.status_code)
    if rr.status_code == 429:
        break
record(429 in codes, "HIGH", "login endpoint rate-limits brute force",
       f"{len(codes)} wrong-password attempts in {time.time() - t0:.1f}s, "
       f"no HTTP 429 (status codes seen: {sorted(set(codes))})")

t0 = time.time()
codes = []
for i in range(25):
    rr = S.post(f"{BASE}/api/auth/password-reset/",
                json={"email": f"nobody{i}@example.test"}, timeout=30)
    codes.append(rr.status_code)
    if rr.status_code == 429:
        break
record(429 in codes, "MEDIUM", "password-reset endpoint rate-limited",
       f"{len(codes)} requests in {time.time() - t0:.1f}s, no 429 "
       f"(statuses: {sorted(set(codes))}) — mail-bomb / enumeration vector")

for weak in ("1", "123456", "password"):
    rr = S.post(f"{BASE}/api/auth/register/", json={
        "email": f"weak-{weak}-{int(time.time())}@example.test",
        "password": weak, "full_name": "Weak Pw"}, timeout=30)
    record(rr.status_code not in (200, 201), "HIGH",
           f"registration rejects weak password {weak!r}",
           f"HTTP {rr.status_code} — account created with a trivial password")

# User enumeration: do unknown vs known emails answer differently?
r1 = S.post(f"{BASE}/api/auth/login/",
            json={"email": "student.a@example.test", "password": "definitely-wrong"}, timeout=30)
r2 = S.post(f"{BASE}/api/auth/login/",
            json={"email": "does-not-exist-zz@example.test", "password": "definitely-wrong"}, timeout=30)
record(r1.status_code == r2.status_code and r1.text == r2.text, "LOW",
       "login does not leak which emails exist",
       f"known -> {r1.status_code} {r1.text[:90]} | unknown -> {r2.status_code} {r2.text[:90]}")

# Self-registration role escalation.
rr = S.post(f"{BASE}/api/auth/register/", json={
    "email": f"escal-{int(time.time())}@example.test", "password": PW,
    "full_name": "Escalation", "role": "hq", "roles": ["hq"],
    "is_staff": True, "is_superuser": True}, timeout=30)
if rr.status_code in (200, 201):
    at = rr.json().get("access")
    if at:
        chk = call(at, "GET", "/api/hq/schools/")
        record(chk.status_code in (401, 403), "CRITICAL",
               "self-registration cannot claim the hq role",
               f"registered with role=hq and reached /api/hq/schools/ -> HTTP {chk.status_code}")
    else:
        record(True, "CRITICAL", "self-registration cannot claim the hq role",
               "no token issued on register")
else:
    record(True, "CRITICAL", "self-registration cannot claim the hq role",
           f"register rejected: HTTP {rr.status_code}")

# ======================================================= 7. transport headers
print("\n[7] security headers")
r = S.get(f"{BASE}/", timeout=30)
h = {k.lower(): v for k, v in r.headers.items()}
for name, sev in [("x-frame-options", "MEDIUM"), ("x-content-type-options", "LOW"),
                  ("content-security-policy", "MEDIUM"), ("referrer-policy", "LOW"),
                  ("strict-transport-security", "MEDIUM"),
                  ("permissions-policy", "LOW")]:
    record(name in h, sev, f"response header {name} present",
           f"missing on GET / (nginx)")
if "server" in h:
    record("nginx/" not in h["server"], "LOW", "server header does not leak version",
           f"Server: {h['server']}")

r = S.get(f"{BASE}/api/health/", timeout=30)
ah = {k.lower(): v for k, v in r.headers.items()}
record("access-control-allow-origin" not in ah or ah.get("access-control-allow-origin") != "*",
       "MEDIUM", "API does not send wildcard CORS",
       f"Access-Control-Allow-Origin: {ah.get('access-control-allow-origin')}")

r = S.get(f"{BASE}/api/health/", headers={"Origin": "https://evil.example.com"}, timeout=30)
acao = r.headers.get("Access-Control-Allow-Origin")
record(acao not in ("https://evil.example.com", "*"), "HIGH",
       "CORS rejects arbitrary origins",
       f"reflected Access-Control-Allow-Origin: {acao}")

# =========================================================== 8. debug / leaks
print("\n[8] information disclosure")
r = S.get(f"{BASE}/api/nonexistent-zzz/", timeout=30)
body = r.text.lower()
record("traceback" not in body and "django version" not in body, "CRITICAL",
       "DEBUG mode off (404 has no traceback)", f"HTTP {r.status_code}: {r.text[:200]}")

r = S.get(f"{BASE}/admin/login/", timeout=30)
record(r.status_code in (403, 404), "MEDIUM", "django admin not publicly exposed",
       f"/admin/login/ -> HTTP {r.status_code}")

for p in ["/.env", "/.git/config", "/api/../.env", "/media/private/",
          "/static/../../.env", "/.git/HEAD"]:
    r = S.get(f"{BASE}{p}", timeout=30, allow_redirects=False)
    record(r.status_code in (400, 401, 403, 404), "CRITICAL",
           f"path {p} not served", f"HTTP {r.status_code}: {r.text[:120]}")

# ================================================================== summary
print("\n" + "=" * 72)
print(f"PASSED  : {len(passed)}")
print(f"FINDINGS: {len(findings)}")
order = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
for f in sorted(findings, key=lambda x: order[x["severity"]]):
    print(f"\n  [{f['severity']}] {f['title']}")
    print(f"      {f['detail']}")
print("=" * 72)

out = os.environ.get("OUT", "/out/authz_probe.json")
try:
    with open(out, "w", encoding="utf-8") as fh:
        json.dump({"base": BASE, "passed": passed, "findings": findings}, fh, indent=2)
    print(f"\nreport: {out}")
except OSError as e:
    print(f"\n(could not write {out}: {e})")
