"""Moving a package's expiry after purchase (students/extensions.py,
PACKAGE_EXTENSIONS.md): a school closure that gives its days back, and the
school extending one student's package by hand.

Carlo's example (2026-09-21): a one-month package bought Dec 1, the school
closed Dec 24 – Jan 2. The WHOLE closure counts (10 days), and the days are
given as OPEN days after the old expiry — Jan 1 and 2 are still closed and
are skipped — so the package that ran through Dec 31 now runs through
Jan 12 (expires Jan 13 00:00). Everything is a recompute from the package's
base, so the order things happen in never changes the result."""
import uuid
from datetime import date, datetime, time, timedelta, timezone as dt_tz
from zoneinfo import ZoneInfo

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role
from bookings.services import BookingError, book_lesson
from catalog.models import Course, Lesson, LessonType, Package
from commerce.webhooks import handle_event
from schools.models import School, SchoolClosure, SchoolMembership, SchoolRole, SchoolStudent
from students.extensions import add_open_days, closure_length, extend_manually, resettle_school, settle
from students.models import Student, StudentPackage, StudentPackageExtension

pytestmark = pytest.mark.django_db
User = get_user_model()
ROME = ZoneInfo("Europe/Rome")


@pytest.fixture(autouse=True)
def _forget_role_matrix():
    """_school() rewrites the `admin` SchoolRole; the section guard caches
    the matrix in-process for 30 s, past this test's rollback. Expire it so
    the next module reads its own roles, not ours (commerce/test_connect_
    onboard_gate used to fail when run after this file)."""
    from core import section_guard

    yield
    section_guard._matrix_cache["expires"] = 0.0


def rome(y, m, d, hh=0, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=ROME)


def end_of(y, m, d):
    return datetime.combine(date(y, m, d), time.max, tzinfo=ROME)


DEC_1 = rome(2026, 12, 1)
JAN_1 = rome(2027, 1, 1)  # one month later: covers through Dec 31
XMAS = (date(2026, 12, 24), date(2027, 1, 2))  # 10 days


def _school():
    from core import section_guard

    # A real role holding the sections these URLs sit in (closures/ →
    # settings, credits/ → manualCredits, student-usage/ → students): the
    # section guard is middleware reading the JWT itself.
    SchoolRole.objects.update_or_create(
        key="admin",
        defaults={"label": "Admin", "builtin": True, "permissions": ["students", "manualCredits", "settings"]},
    )
    section_guard._matrix_cache["expires"] = 0.0
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", timezone="Europe/Rome", active=True,
    )


def _student(school):
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com", role=Role.STUDENT, roles=[Role.STUDENT])
    student = Student.objects.create(user=user, name="Anna", school=school)
    SchoolStudent.objects.create(school=school, student=student)
    return student


def _package(student, school, *, purchased=DEC_1, expires=JAN_1, catalog=None, **kw):
    if catalog is None:
        catalog = Package.objects.create(school=school, credits=10, name_en="Month", name_it="Mese")
    return StudentPackage.objects.create(
        student=student, school=school, package=catalog, credits_total=10, credits_remaining=10,
        status=kw.pop("status", "active"), purchased_at=purchased, expires_at=expires, **kw,
    )


def _closure(school, start, end=None, *, extends=True, **kw):
    return SchoolClosure.objects.create(
        school=school, date=start, end_date=end, type=kw.pop("type", "full_day"), extends_packages=extends, **kw
    )


def _client_for(user):
    client = APIClient()  # a real JWT: force_authenticate would slip past the section guard
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


def _school_client(school):
    user = User.objects.create(
        email=f"sch-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school,
        first_name="Marta", last_name="Staff",
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role="admin")
    return _client_for(user)


def _expiry(sp):
    sp.refresh_from_db()
    return sp.expires_at


def _live(sp=None, **filters):
    qs = StudentPackageExtension.objects.filter(revoked_at__isnull=True, **filters)
    return qs.filter(student_package=sp) if sp is not None else qs


# --- the rule ---------------------------------------------------------------

def test_closure_length_is_inclusive():
    school = _school()
    assert closure_length(_closure(school, date(2026, 12, 24))) == 1
    assert closure_length(_closure(school, date(2026, 12, 25), date(2027, 1, 2))) == 9


def test_add_open_days_skips_the_closed_days_in_the_school_clock():
    closed = {date(2027, 1, 1), date(2027, 1, 2)}
    # expiry at midnight covers through Dec 31; 10 open days: Jan 3 .. Jan 12
    assert add_open_days(JAN_1, 10, ROME, closed) == rome(2027, 1, 13)
    # expiry at 18:30 still covers Jan 1 itself; Jan 2 skipped, Jan 3 .. 12
    assert add_open_days(rome(2027, 1, 1, 18, 30), 10, ROME, closed) == rome(2027, 1, 12, 18, 30)
    assert add_open_days(JAN_1, 0, ROME, closed) == JAN_1
    # across the DST change (Mar 28 2027) the time of day stays put: 23:59:59
    # on the last covered day, not 00:59:59 the morning after
    assert add_open_days(end_of(2027, 3, 20), 10, ROME, set()) == end_of(2027, 3, 30)


def test_carlos_example_whole_closure_given_as_open_days():
    school = _school()
    sp = _package(_student(school), school)
    closure = _closure(school, *XMAS)  # recorded after the purchase → the batch

    assert _expiry(sp) == rome(2027, 1, 13)  # 10 owed + Jan 1 and 2 skipped = 12 calendar days
    (row,) = _live(sp)
    assert row.kind == "closure" and row.closure_id == closure.id and row.days == 10
    assert row.expires_before == JAN_1 and row.expires_after == rome(2027, 1, 13)
    assert row.period_start == date(2026, 12, 24) and row.period_end == date(2027, 1, 2)
    assert row.note == "" and row.created_by is None

    # bought after the closure was recorded → the same, at creation
    fresh = _package(_student(school), school)
    assert _expiry(fresh) == rome(2027, 1, 13) and _live(fresh).count() == 1


def test_a_closure_touching_the_last_day_counts_in_full():
    school = _school()
    sp = _package(_student(school), school)
    _closure(school, date(2026, 12, 31), date(2027, 1, 5))  # 6 days, one inside the window
    # 6 open days after Dec 31, skipping Jan 1 .. 5: Jan 6 .. Jan 11
    assert _expiry(sp) == rome(2027, 1, 12)


def test_closures_outside_the_window_do_nothing():
    school = _school()
    sp = _package(_student(school), school)
    _closure(school, date(2027, 1, 5), date(2027, 1, 6))  # after
    _closure(school, date(2026, 11, 20))  # before purchase
    assert _expiry(sp) == JAN_1 and not StudentPackageExtension.objects.exists()


def test_partial_closures_and_opted_out_closures_do_nothing():
    school = _school()
    sp = _package(_student(school), school)
    _closure(school, date(2026, 12, 24), type="partial", from_time=time(18, 0))
    _closure(school, date(2026, 12, 27), extends=False)
    assert _expiry(sp) == JAN_1 and not StudentPackageExtension.objects.exists()


def test_a_closure_leaves_alone_the_packages_the_school_unticked():
    """`excluded_packages` on the closure: the Zoom package (lessons go on
    over Zoom while the doors are shut) gets nothing from it — recorded
    before or after the purchase — while the in-person one does. The school
    can still extend the Zoom one by hand."""
    school = _school()
    zoom = Package.objects.create(school=school, credits=10, name_en="Zoom", extended_by_closures=False)
    student = _student(school)
    online = _package(student, school, catalog=zoom)
    in_person = _package(student, school)
    _closure(school, *XMAS, excluded_packages=[str(zoom.id)])

    assert _expiry(online) == JAN_1 and not _live(online).exists()
    assert _expiry(in_person) == rome(2027, 1, 13)
    later = _package(_student(school), school, catalog=zoom)  # bought with the closure on the calendar
    assert _expiry(later) == JAN_1 and not _live(later).exists()

    extend_manually(online, end_of(2027, 1, 20), note="asked")
    assert _expiry(online) == end_of(2027, 1, 20)
    (row,) = _live(online)
    assert row.kind == "manual"


def test_the_closure_form_decides_and_the_package_flag_only_proposes():
    """Through the API: the exclusion list is validated against the school's
    catalog, left unsaid it is filled from Package.extended_by_closures, and
    editing it later resettles the purchases either way. A hand-picked date
    survives."""
    school = _school()
    zoom = Package.objects.create(school=school, credits=10, name_en="Zoom", extended_by_closures=False)
    month = Package.objects.create(school=school, credits=10, name_en="Month")
    z = _package(_student(school), school, catalog=zoom)
    m = _package(_student(school), school, catalog=month)
    chosen = _package(_student(school), school, catalog=month)
    extend_manually(chosen, end_of(2027, 1, 20), note="")
    client = _school_client(school)
    body = {"date": "2026-12-24", "end_date": "2027-01-02", "type": "full_day", "extends_packages": True}

    # unknown id, malformed id, opt-in on a partial closure → 400
    res = client.post("/api/school/closures/", {**body, "excluded_packages": [str(uuid.uuid4())]}, format="json")
    assert res.status_code == 400 and "excluded_packages" in res.json()
    res = client.post("/api/school/closures/", {**body, "excluded_packages": ["zoom"]}, format="json")
    assert res.status_code == 400 and "excluded_packages" in res.json()
    res = client.post(
        "/api/school/closures/", {**body, "type": "partial", "from_time": "14:00"}, format="json"
    )
    assert res.status_code == 400 and "extends_packages" in res.json()

    # unsaid → the flagged package is proposed out
    res = client.post("/api/school/closures/", body, format="json")
    assert res.status_code == 201, res.content
    assert res.json()["excluded_packages"] == [str(zoom.id)]
    assert res.json()["extended_count"] == 2  # m, and `chosen` on top of its hand-picked date
    closure_id = res.json()["id"]
    assert _expiry(z) == JAN_1 and _expiry(m) == rome(2027, 1, 13)

    # the school changes its mind for this closure: Zoom in, Month out
    res = client.patch(f"/api/school/closures/{closure_id}/", {"excluded_packages": [str(month.id)]}, format="json")
    assert res.status_code == 200, res.content
    assert res.json()["excluded_packages"] == [str(month.id)] and res.json()["extended_count"] == 1
    assert _expiry(z) == rome(2027, 1, 13) and _live(z).count() == 1
    assert _expiry(m) == JAN_1 and not _live(m).exists()
    assert _expiry(chosen) == end_of(2027, 1, 20) and _live(chosen, kind="manual").count() == 1  # the date stays

    # nobody out → all three in
    res = client.patch(f"/api/school/closures/{closure_id}/", {"excluded_packages": []}, format="json")
    assert res.status_code == 200 and res.json()["extended_count"] == 3
    assert _expiry(m) == rome(2027, 1, 13) and _expiry(chosen) == end_of(2027, 1, 30)


def test_hq_packages_flagged_out_are_left_out_even_when_the_form_cannot_show_them():
    """An HQ package (school = null) is not in the school's list: flagged as
    not extended by closures, it is added to whatever the form sent — on
    create and on update — and the admin path (no list at all) gets the
    whole proposal through the model."""
    school = _school()
    hq_zoom = Package.objects.create(school=None, credits=10, name_en="HQ Zoom", extended_by_closures=False)
    hq_in = Package.objects.create(school=None, credits=10, name_en="HQ Month")
    own_zoom = Package.objects.create(school=school, credits=10, name_en="Zoom", extended_by_closures=False)
    a = _package(_student(school), school, catalog=hq_zoom)
    b = _package(_student(school), school, catalog=hq_in)
    client = _school_client(school)
    body = {"date": "2026-12-24", "end_date": "2027-01-02", "type": "full_day", "extends_packages": True}

    res = client.post("/api/school/closures/", {**body, "excluded_packages": []}, format="json")
    assert res.status_code == 201, res.content
    assert res.json()["excluded_packages"] == [str(hq_zoom.id)] and res.json()["extended_count"] == 1
    assert _expiry(a) == JAN_1 and _expiry(b) == rome(2027, 1, 13)
    res = client.patch(f"/api/school/closures/{res.json()['id']}/", {"excluded_packages": [str(hq_in.id)]}, format="json")
    assert res.status_code == 200 and sorted(res.json()["excluded_packages"]) == sorted([str(hq_in.id), str(hq_zoom.id)])
    assert _expiry(b) == JAN_1

    # the model's proposal: own and HQ flagged packages, as the admin path uses it
    closure = SchoolClosure(school=school, date=date(2027, 3, 1), extends_packages=True)
    closure.fill_excluded_packages()
    assert sorted(closure.excluded_packages) == sorted([str(hq_zoom.id), str(own_zoom.id)])
    closure = SchoolClosure(school=school, date=date(2027, 3, 1), extends_packages=False)
    closure.fill_excluded_packages()
    assert closure.excluded_packages == []


def test_every_closed_day_is_skipped_and_every_giving_closure_gives_once():
    """A (Dec 24 – Jan 2) and B (Jan 10 – 11) both give days back. A's walk
    skips B's two days (the school is shut), then B — inside the stretched
    window — gives its own two: Jan 3 .. 9, Jan 12 .. 14 from A, Jan 15 .. 16
    from B. The same whatever the order they were recorded in, and for a
    package bought once both are on the calendar."""
    school = _school()
    a_first = _package(_student(school), school)
    _closure(school, *XMAS)
    assert _expiry(a_first) == rome(2027, 1, 13)  # A alone, B not on the calendar yet
    _closure(school, date(2027, 1, 10), date(2027, 1, 11))
    assert _expiry(a_first) == rome(2027, 1, 17)  # A re-walked over B's days, then B's own two

    fresh = _package(_student(school), school)
    assert _expiry(fresh) == rome(2027, 1, 17)
    assert sorted(_live(fresh).values_list("days", flat=True)) == [2, 10]

    other = _school()
    b_first = _package(_student(other), other)
    _closure(other, date(2027, 1, 10), date(2027, 1, 11))  # does not touch yet
    assert _expiry(b_first) == JAN_1
    _closure(other, *XMAS)  # stretches the window over B: B gets its turn
    assert _expiry(b_first) == rome(2027, 1, 17)
    assert _live(b_first).count() == 2


def test_the_walk_skips_a_closure_that_gives_nothing_back():
    school = _school()
    sp = _package(_student(school), school)
    _closure(school, date(2027, 1, 7), extends=False)  # a Monday off, no days back
    _closure(school, date(2027, 1, 20), type="partial", from_time=time(18, 0))  # open in the morning
    _closure(school, *XMAS)
    # 10 open days after Dec 31: Jan 1, 2 (own tail) and Jan 7 skipped → Jan 3 .. 13
    assert _expiry(sp) == rome(2027, 1, 14)
    assert StudentPackageExtension.objects.count() == 1  # the Monday gave no row of its own


def test_settling_again_changes_nothing():
    school = _school()
    sp = _package(_student(school), school)
    closure = _closure(school, *XMAS)
    assert settle(sp) == [] and _expiry(sp) == rome(2027, 1, 13)
    assert resettle_school(school.id, closure=closure) == 1
    assert StudentPackageExtension.objects.count() == 1


def test_which_packages_are_left_alone():
    school = _school()
    anna = _student(school)
    closure = _closure(school, *XMAS)
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    event = Course.objects.create(school=school, lesson_type=lt, credit_cost=1, is_special_event=True)

    stripe_sub = _package(anna, school, stripe_subscription_id="sub_1")
    drop_in = _package(anna, school, catalog=Package.objects.create(school=school, credits=1, is_drop_in=True))
    ticket = _package(anna, school, catalog=Package.objects.create(school=school, credits=1, event=event))
    deleted = _package(anna, school, status="deleted")
    no_expiry = _package(anna, school, expires=None)
    exhausted = _package(anna, school, status="exhausted")

    for sp in (stripe_sub, drop_in, ticket, deleted):
        assert _expiry(sp) == JAN_1
    assert _expiry(no_expiry) is None
    assert _expiry(exhausted) == rome(2027, 1, 13)  # a refund may bring it back: it carries the days
    assert resettle_school(school.id, closure=closure) == 1


def test_a_buy_ahead_window_starts_at_starts_at():
    school = _school()
    sp = _package(
        _student(school), school, purchased=rome(2026, 12, 20), starts_at=rome(2027, 2, 1), expires=rome(2027, 3, 1)
    )
    _closure(school, *XMAS)
    assert _expiry(sp) == rome(2027, 3, 1)
    _closure(school, date(2027, 2, 10))
    assert _expiry(sp) == rome(2027, 3, 2)


# --- the closure changes -----------------------------------------------------

def test_deleting_the_closure_takes_the_days_back_exactly():
    school = _school()
    sp = _package(_student(school), school)
    closure = _closure(school, *XMAS)
    assert _expiry(sp) == rome(2027, 1, 13)

    closure.delete()  # the model itself — the admin path, not only the API
    assert _expiry(sp) == JAN_1
    (row,) = StudentPackageExtension.objects.all()
    assert row.revoked_at is not None and row.closure_id is None  # history survives the closure
    assert row.period_start == date(2026, 12, 24) and row.period_end == date(2027, 1, 2)


def test_redating_and_toggling_are_recomputed_not_patched():
    school = _school()
    sp = _package(_student(school), school)
    closure = _closure(school, *XMAS)
    _closure(school, date(2027, 1, 5), date(2027, 1, 6))  # B, inside the stretched window
    # A from Dec 31 skips Jan 1-2 and 5-6 → Jan 3-4, 7 .. 14 (10), then B → Jan 15, 16
    assert _expiry(sp) == rome(2027, 1, 17)

    closure.end_date = date(2027, 1, 3)  # A grows to 11 days
    closure.save()
    # fresh replay: A' from Dec 31 skips Jan 1-3 and 5-6 → Jan 4, 7 .. 16 (11), then B → Jan 17, 18
    assert _expiry(sp) == rome(2027, 1, 19)
    fresh = _package(_student(school), school)
    assert _expiry(fresh) == rome(2027, 1, 19)
    (a_row,) = _live(sp, closure=closure)
    assert a_row.days == 11 and a_row.period_end == date(2027, 1, 3) and a_row.expires_before == JAN_1

    closure.notes = "Christmas"  # the notes alone: nothing moves, no new rows
    closure.save()
    assert _expiry(sp) == rome(2027, 1, 19) and StudentPackageExtension.objects.count() == 4

    closure.extends_packages = False  # opted out: its days go back, B's stay
    closure.save()
    assert _expiry(sp) == JAN_1  # B no longer touches the window either
    assert _live(sp).count() == 0 and StudentPackageExtension.objects.filter(student_package=sp).count() == 2

    closure.extends_packages = True
    closure.save()
    assert _expiry(sp) == rome(2027, 1, 19) and _live(sp).count() == 2


def test_recording_a_closure_extends_and_reports_how_many():
    school = _school()
    sp = _package(_student(school), school)
    client = _school_client(school)

    res = client.post(
        "/api/school/closures/",
        {"date": "2026-12-24", "end_date": "2027-01-02", "type": "full_day", "extends_packages": True, "notes": "Xmas"},
        format="json",
    )
    assert res.status_code == 201, res.content
    assert res.json()["extended_count"] == 1 and res.json()["extends_packages"] is True
    assert _expiry(sp) == rome(2027, 1, 13)
    (row,) = _live(sp)
    assert row.note == "Xmas"

    rows = client.get("/api/school/closures/").json()
    assert [r["extended_count"] for r in rows] == [1]

    # the default stays what it was: a closure does not touch packages unless asked
    res = client.post("/api/school/closures/", {"date": "2027-03-01", "type": "full_day"}, format="json")
    assert res.status_code == 201 and res.json()["extends_packages"] is False and res.json()["extended_count"] == 0


def test_the_api_edits_and_deletes_go_through_the_same_recompute():
    school = _school()
    sp = _package(_student(school), school)
    client = _school_client(school)
    closure_id = client.post(
        "/api/school/closures/",
        {"date": "2026-12-24", "end_date": "2027-01-02", "type": "full_day", "extends_packages": True},
        format="json",
    ).json()["id"]

    # shortened to Dec 24 – Dec 27: 4 days, nothing to skip → Jan 1 .. 4
    res = client.patch(f"/api/school/closures/{closure_id}/", {"end_date": "2026-12-27"}, format="json")
    assert res.status_code == 200 and res.json()["extended_count"] == 1
    assert _expiry(sp) == rome(2027, 1, 5)
    (row,) = _live(sp)
    assert row.days == 4 and row.period_end == date(2026, 12, 27)

    # a closure stays in its school
    other = School.objects.create(name="O", slug=f"o-{uuid.uuid4().hex[:8]}", email="o@example.com", active=True)
    res = client.patch(f"/api/school/closures/{closure_id}/", {"school": str(other.id)}, format="json")
    assert res.status_code == 200 and res.json()["school"] == str(school.id)

    assert client.delete(f"/api/school/closures/{closure_id}/").status_code == 204
    assert _expiry(sp) == JAN_1 and _live(sp).count() == 0
    hist = _client_for(sp.student.user).get("/api/student/credit-history/").json()
    assert [h for h in hist if h["type"] == "school_extension"] == []


# --- a package bought after the closure was recorded -------------------------

def test_a_manual_grant_gets_the_recorded_closure():
    school = _school()
    anna = _student(school)
    _closure(school, *XMAS)
    client = _school_client(school)

    res = client.post(
        "/api/school/credits/grant/",
        {"student_id": str(anna.id), "amount": "10", "expires_at": "2026-12-31", "reason": "gift"},
        format="json",
    )
    assert res.status_code == 201, res.content
    sp = StudentPackage.objects.get(student=anna)
    (row,) = _live(sp)
    # the form's day is covered in full, in the school's zone; then 10 open
    # days after it, Jan 1 and 2 skipped
    assert row.days == 10
    assert sp.expires_at == end_of(2027, 1, 12)


def test_a_stripe_purchase_gets_the_recorded_closure():
    school = _school()
    anna = _student(school)
    _closure(school, *XMAS)
    month = Package.objects.create(school=school, credits=10, validity_days=30, price=100)
    starts = datetime(2026, 12, 1, 10, 0, tzinfo=dt_tz.utc)

    result = handle_event({"type": "payment_intent.succeeded", "data": {"object": {
        "id": "pi_xmas", "amount": 10000,
        "metadata": {"kind": "package", "school_id": str(school.id), "student_id": str(anna.id),
                     "item_id": str(month.id), "starts_at": starts.isoformat()},
    }}})
    assert result == "package_activated"
    sp = StudentPackage.objects.get(stripe_payment_id="pi_xmas")
    # 30 days → Dec 31 10:00 UTC, then 10 open days skipping Jan 1 and 2
    assert sp.expires_at == starts + timedelta(days=30) + timedelta(days=12)
    assert _live(sp, kind="closure").count() == 1


# --- the booking engine ------------------------------------------------------

def test_the_booking_engine_honours_the_new_expiry():
    school = _school()
    anna = _student(school)
    _package(anna, school)
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    course = Course.objects.create(school=school, lesson_type=lt, credit_cost=1, min_booking_notice_hours=0)
    lesson = Lesson.objects.create(
        school=school, course=course, lesson_type=lt, date=date(2027, 1, 8), start_time=time(10, 0),
        end_time=time(11, 0), max_capacity=10, status="scheduled",
    )

    with pytest.raises(BookingError) as exc:
        book_lesson(anna, lesson)
    assert str(exc.value) == "no_valid_access"

    _closure(school, *XMAS)
    booking = book_lesson(anna, lesson)
    assert booking.status == "confirmed"


# --- one student, by hand ----------------------------------------------------

def _extend_url(sp):
    return f"/api/school/credits/packages/{sp.id}/extend/"


def _iso(value: str) -> datetime:
    """The API speaks UTC ("...Z"): the instant, to compare with a Rome one."""
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def test_the_school_extends_one_package_to_a_day_it_picks():
    school = _school()
    anna = _student(school)
    sp = _package(anna, school)
    client = _school_client(school)

    res = client.post(_extend_url(sp), {"expires_at": "2027-01-20", "note": "flu, two weeks off"}, format="json")
    assert res.status_code == 201, res.content
    body = res.json()
    assert body["extension"]["kind"] == "manual" and body["extension"]["days"] == 20
    assert body["extension"]["by"] == "Marta Staff" and body["extension"]["note"] == "flu, two weeks off"
    # the whole picked day is covered, in the school's own timezone
    assert _expiry(sp) == end_of(2027, 1, 20) and _iso(body["expires_at"]) == end_of(2027, 1, 20)
    assert sp.status == "active"

    # the school's ledger of the package carries it
    ledger = client.get(f"/api/school/student-usage/packages/{sp.id}/").json()
    (e,) = ledger["extensions"]
    assert e["kind"] == "manual" and e["days"] == 20 and e["revoked"] is False
    assert _iso(ledger["package"]["expires_at"]) == end_of(2027, 1, 20)

    # the student sees the days and the new date, never the note
    hist = _client_for(anna.user).get("/api/student/credit-history/").json()
    (h,) = [h for h in hist if h["type"] == "school_extension"]
    assert h["days"] == 20 and h["credits"] == 0 and h["student_package_id"] == str(sp.id)
    assert _iso(h["expires_after"]) == end_of(2027, 1, 20) and h["status"] == "manual"
    assert "note" not in h and "flu" not in str(h)


def test_manual_days_count_covered_days_not_hours():
    school = _school()
    sp = _package(_student(school), school, expires=rome(2026, 12, 31, 10, 0))  # a Stripe-like time of day
    row = extend_manually(sp, school.end_of_day(date(2027, 1, 20)))
    assert row.days == 20  # Jan 1 .. Jan 20, not 21


def test_a_hand_picked_date_survives_the_closure_being_deleted():
    """The manual date is the package's base: undoing a closure that had
    already been absorbed in it moves nothing; a closure inside the new
    window still gives its days, on top."""
    school = _school()
    sp = _package(_student(school), school)
    xmas = _closure(school, *XMAS)
    assert _expiry(sp) == rome(2027, 1, 13)

    extend_manually(sp, school.end_of_day(date(2027, 1, 31)), note="whole January")
    assert _expiry(sp) == end_of(2027, 1, 31)
    xmas.delete()
    assert _expiry(sp) == end_of(2027, 1, 31)  # not Jan 19

    _closure(school, date(2027, 1, 25), date(2027, 1, 26))  # inside the hand-picked window: +2 open days
    assert _expiry(sp) == end_of(2027, 2, 2)
    # the absorbed Christmas row stays as history: its days were never taken back
    kinds = list(_live(sp).order_by("created_at").values_list("kind", flat=True))
    assert kinds == ["closure", "manual", "closure"]


def test_manual_extension_refusals():
    school = _school()
    anna = _student(school)
    client = _school_client(school)

    sp = _package(anna, school)
    res = client.post(_extend_url(sp), {"expires_at": "2026-12-31"}, format="json")  # not later
    assert res.status_code == 400 and res.json()["error"] == "expiry_not_later"
    res = client.post(_extend_url(sp), {}, format="json")
    assert res.status_code == 400 and res.json()["error"] == "expires_at_invalid"
    res = client.post(_extend_url(sp), {"expires_at": "2027-01-20", "note": ["x"]}, format="json")
    assert res.status_code == 400 and res.json()["error"] == "note_invalid"

    stripe_sub = _package(anna, school, stripe_subscription_id="sub_1")
    res = client.post(_extend_url(stripe_sub), {"expires_at": "2027-01-20"}, format="json")
    assert res.status_code == 409 and res.json()["error"] == "managed_by_stripe"

    deleted = _package(anna, school, status="deleted")
    res = client.post(_extend_url(deleted), {"expires_at": "2027-01-20"}, format="json")
    assert res.status_code == 400 and res.json()["error"] == "package_not_active"

    no_expiry = _package(anna, school, expires=None)
    res = client.post(_extend_url(no_expiry), {"expires_at": "2027-01-20"}, format="json")
    assert res.status_code == 400 and res.json()["error"] == "package_has_no_expiry"

    other = School.objects.create(name="O", slug=f"o-{uuid.uuid4().hex[:8]}", email="o@example.com", active=True)
    foreign = _package(_student(other), other)
    res = client.post(_extend_url(foreign), {"expires_at": "2027-01-20"}, format="json")
    assert res.status_code == 404

    for p in (sp, stripe_sub, deleted, foreign):
        assert _expiry(p) == JAN_1
    assert not StudentPackageExtension.objects.exists()


def test_extending_is_a_manual_credits_action():
    school = _school()
    sp = _package(_student(school), school)
    from core import section_guard

    SchoolRole.objects.update_or_create(
        key="reception", defaults={"label": "Reception", "builtin": False, "permissions": ["students"]}
    )
    section_guard._matrix_cache["expires"] = 0.0
    user = User.objects.create(
        email=f"rec-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role="reception")

    res = _client_for(user).post(_extend_url(sp), {"expires_at": "2027-01-20"}, format="json")
    assert res.status_code == 403
    assert _expiry(sp) == JAN_1
