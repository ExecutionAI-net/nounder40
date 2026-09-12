"""R3-M8 (QA_REGRESSION_ROUND3_CROSSCUT.md X-R3-06 + SCH-R3-06): malformed
request *bodies* still answered 500.

R2-M1 hardened query parameters everywhere (`core/params.py`). Bodies were
never covered: QA counted 45 shapes that returned `Server Error (500)`, four
of them on anonymous endpoints, and `POST /stripe/onboard/` echoed the Python
message back to the caller (`'str' object has no attribute 'get'`).

They fall into four root causes, and this file has a case per cause rather
than 45 near-duplicates:

1. **a bare scalar body** (`"just a string"`, `[1,2]` where an object is
   required, `null`) reaching `request.data.get(...)`. Fixed once for every
   endpoint by `core.parsers.ObjectOrArrayJSONParser`;
2. **an id that is not a UUID / not an integer** reaching the ORM raw;
3. **a typed value that will not parse** — `"25:99"` as a time, `"x"` as a
   date, `"abc"` as an integer, `"NaN"` as a decimal (which is worse than a
   crash: it compares False against every bound and was *stored*);
4. **the wrong container** — a string where a list of objects is expected.
"""
import uuid
from datetime import date, time, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import HQMember, Role
from catalog.models import Course, Lesson, LessonType, Package
from schools.models import School, SchoolMembership, SchoolRole, SchoolStudent
from students.models import ManualCreditGrant, Student

pytestmark = pytest.mark.django_db
User = get_user_model()


def _client(user=None):
    api = APIClient()
    if user is not None:
        api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


@pytest.fixture
def school():
    for key in ("owner", "admin", "staff"):
        SchoolRole.objects.update_or_create(
            key=key, defaults={"label": key.title(), "builtin": True, "permissions": [
                "team", "teachers", "courses", "lessons", "manualCredits", "students", "payments", "inbox",
            ]},
        )
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com", active=True
    )


@pytest.fixture
def owner(school):
    user = User.objects.create(
        email=f"own-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role="owner")
    return user


@pytest.fixture
def owner_client(owner):
    return _client(owner)


@pytest.fixture
def student(school):
    user = User.objects.create(
        email=f"stu-{uuid.uuid4().hex[:8]}@example.com", role=Role.STUDENT, roles=[Role.STUDENT]
    )
    student = Student.objects.create(user=user, name="Anna", school=school)
    SchoolStudent.objects.get_or_create(school=school, student=student)
    return student


@pytest.fixture
def student_client(student):
    return _client(student.user)


@pytest.fixture
def hq_client():
    user = User.objects.create(
        email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ], hq_sub_role="owner"
    )
    HQMember.objects.create(user=user, email=user.email, name="QA", sub_role="owner", active=True)
    return _client(user)


# --- cause 1: a bare scalar body ---------------------------------------------
#
# One parser covers every endpoint, so the cases here are the *reach* of the
# fix (anonymous, school, student, HQ, and the one that leaked a Python
# message), not an endpoint-by-endpoint list.

ANONYMOUS_ENDPOINTS = [
    "/api/auth/password-reset-confirm/",
    "/api/auth/complete-invite/",
    "/api/auth/logout/",
    "/api/auth/google/",
]


@pytest.mark.parametrize("path", ANONYMOUS_ENDPOINTS)
@pytest.mark.parametrize("body", ['"just a string"', "42", "null"])
def test_a_scalar_body_on_an_anonymous_endpoint_is_a_400(path, body):
    """The four anonymous 500s: unauthenticated callers could make the server
    error at will."""
    resp = _client().post(path, data=body, content_type="application/json")
    assert resp.status_code == 400, (path, body, resp.status_code, resp.content[:200])


@pytest.mark.parametrize("path", [
    "/api/school/team/",
    "/api/school/teachers/",
    "/api/school/quick-replies/",
    "/api/school/courses-create/",
])
def test_a_scalar_body_on_a_school_endpoint_is_a_400(owner_client, path):
    resp = owner_client.post(path, data='"str"', content_type="application/json")
    assert resp.status_code == 400, (path, resp.status_code, resp.content[:200])


@pytest.mark.parametrize("path", [
    "/api/bookings/",
    "/api/bookings/multiple/",
    "/api/student/school/",
    "/api/student/discount-code/check/",
    "/api/student/shop/checkout/",
])
def test_a_scalar_body_on_a_student_endpoint_is_a_400(student_client, path):
    resp = student_client.post(path, data='"str"', content_type="application/json")
    assert resp.status_code == 400, (path, resp.status_code, resp.content[:200])


@pytest.mark.parametrize("path", [
    "/api/hq/schools/",
    "/api/hq/invitations/",
    "/api/hq/email-settings/",
    "/api/hq/email-templates/",
    "/api/hq/library/",
])
def test_a_scalar_body_on_an_hq_endpoint_is_a_400(hq_client, path):
    resp = hq_client.post(path, data='"str"', content_type="application/json")
    assert resp.status_code == 400, (path, resp.status_code, resp.content[:200])


def test_stripe_onboard_no_longer_leaks_the_python_error(owner_client):
    """It answered 502 with `'str' object has no attribute 'get'` in the body."""
    resp = owner_client.post("/api/stripe/onboard/", data='"str"', content_type="application/json")
    assert resp.status_code == 400, resp.content
    assert b"object has no attribute" not in resp.content


def test_an_array_body_still_reaches_the_views_that_want_one():
    """The attendance endpoints take a top-level JSON array by design — the
    parser must not be a blanket "objects only" rule."""
    from core.parsers import ObjectOrArrayJSONParser
    import io as _io

    parser = ObjectOrArrayJSONParser()
    assert parser.parse(_io.BytesIO(b'[{"a": 1}]')) == [{"a": 1}]
    assert parser.parse(_io.BytesIO(b'{"a": 1}')) == {"a": 1}


# --- cause 2: ids that never were ids ----------------------------------------


def test_school_team_write_verbs_with_a_non_integer_id(owner_client):
    """SCH-R3-06: SchoolMembership has an integer pk, so `"x"` was a
    ValueError inside the ORM."""
    for method, path in (
        (owner_client.patch, "/api/school/team/"),
        (owner_client.delete, "/api/school/team/"),
        (owner_client.post, "/api/school/team/resend/"),
    ):
        resp = method(path, {"id": "x"}, format="json")
        assert resp.status_code == 400, (path, resp.status_code, resp.content[:200])


def test_teacher_endpoints_with_a_non_uuid_id(owner_client):
    for method, path in (
        (owner_client.delete, "/api/school/teachers/"),
        (owner_client.post, "/api/school/teachers/resend/"),
    ):
        resp = method(path, {"teacher_id": "x"}, format="json")
        assert resp.status_code == 400, (path, resp.status_code, resp.content[:200])


def test_booking_a_non_uuid_lesson(student_client):
    resp = student_client.post("/api/bookings/", {"lesson_id": "x"}, format="json")
    assert resp.status_code == 400, resp.content


def test_refunding_a_non_uuid_transaction(owner_client):
    resp = owner_client.post("/api/stripe/refund/", {"transaction_id": "x"}, format="json")
    assert resp.status_code == 400, resp.content


def test_reordering_courses_with_a_non_uuid_id(owner_client):
    resp = owner_client.post("/api/school/courses-reorder/", {"ids": ["x"]}, format="json")
    assert resp.status_code == 400, resp.content


# --- cause 3: values that will not parse -------------------------------------


@pytest.mark.parametrize("field,value", [
    ("lesson_type_id", "x"),
    ("start_time", "25:99"),
    ("duration_minutes", "abc"),
    ("room_id", "x"),
])
def test_courses_create_with_a_malformed_field(owner_client, school, field, value):
    lesson_type = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    schedule = {"start_date": date.today().isoformat(), "start_time": "10:00", "duration_minutes": 60}
    body = {"lesson_type_id": str(lesson_type.id), "schedules": [schedule]}
    if field in ("lesson_type_id",):
        body[field] = value
    else:
        schedule[field] = value

    resp = owner_client.post("/api/school/courses-create/", body, format="json")

    assert resp.status_code == 400, (field, resp.status_code, resp.content[:200])
    assert not Course.objects.filter(school=school).exists()


@pytest.mark.parametrize("field,value", [
    ("date", "x"),
    ("start_time", "99:99"),
    ("teacher_id", "x"),
    ("max_capacity", "abc"),
])
def test_class_patch_with_a_malformed_field(owner_client, school, field, value):
    lesson_type = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    lesson = Lesson.objects.create(
        school=school, lesson_type=lesson_type, date=date.today() + timedelta(days=3),
        start_time="10:00", end_time="11:00", max_capacity=10, status="scheduled",
    )

    resp = owner_client.patch(f"/api/school/classes/{lesson.id}/", {field: value}, format="json")

    assert resp.status_code == 400, (field, resp.status_code, resp.content[:200])


def test_a_nan_credit_grant_is_refused_not_stored(owner_client, student):
    """The worst of the four: `Decimal("NaN")` parsed, then compared False
    against `<= 0`, `> 99999.9` and the half-credit step, so all four range
    checks passed and NaN credits were written to the wallet."""
    resp = owner_client.post(
        "/api/school/credits/grant/",
        {"student_id": str(student.id), "amount": "NaN"},
        format="json",
    )

    assert resp.status_code == 400, resp.content
    assert not ManualCreditGrant.objects.filter(student=student).exists()


def test_a_valid_half_credit_grant_still_works(owner_client, student):
    resp = owner_client.post(
        "/api/school/credits/grant/",
        {"student_id": str(student.id), "amount": "0.5"},
        format="json",
    )
    assert resp.status_code in (200, 201), resp.content
    assert ManualCreditGrant.objects.get(student=student).amount == Decimal("0.5")


# --- cause 4: the wrong container --------------------------------------------


def test_courses_create_with_a_string_where_schedules_belong(owner_client):
    lesson_type = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    resp = owner_client.post(
        "/api/school/courses-create/",
        {"lesson_type_id": str(lesson_type.id), "schedules": "x"},
        format="json",
    )
    assert resp.status_code == 400, resp.content


def test_shop_checkout_with_a_string_where_items_belong(student_client):
    resp = student_client.post("/api/student/shop/checkout/", {"items": "x"}, format="json")
    assert resp.status_code == 400, resp.content


def test_shop_checkout_with_a_non_numeric_quantity(student_client, school):
    from commerce.models import ShopProduct

    product = ShopProduct.objects.create(school=school, name="Tee", price=Decimal("20.00"))
    resp = student_client.post(
        "/api/student/shop/checkout/",
        {"items": [{"product_id": str(product.id), "qty": "abc"}]},
        format="json",
    )
    assert resp.status_code == 400, resp.content


def test_multiple_bookings_with_a_string_where_lessons_belong(student_client):
    """X-R3-16: this answered 200 with an empty result list, having iterated
    the string one character at a time."""
    resp = student_client.post("/api/bookings/multiple/", {"lessons": "x"}, format="json")
    assert resp.status_code == 400, resp.content


# --- the happy paths these guards sit on top of ------------------------------


def test_a_well_formed_booking_still_works(student_client, student, school):
    lesson_type = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    course = Course.objects.create(
        school=school, lesson_type=lesson_type, credit_cost=1, min_booking_notice_hours=0
    )
    lesson = Lesson.objects.create(
        school=school, course=course, lesson_type=lesson_type, date=date.today() + timedelta(days=5),
        start_time="10:00", end_time="11:00", max_capacity=10, status="scheduled",
    )
    from django.utils import timezone

    from students.models import StudentPackage

    pkg = Package.objects.create(school=school, credits=10)
    StudentPackage.objects.create(
        student=student, school=school, package=pkg, credits_total=10, credits_remaining=10,
        expires_at=timezone.now() + timedelta(days=90),
    )

    resp = student_client.post("/api/bookings/", {"lesson": str(lesson.id)}, format="json")

    assert resp.status_code == 201, resp.content


def test_a_well_formed_course_create_still_works(owner_client, school):
    lesson_type = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    resp = owner_client.post(
        "/api/school/courses-create/",
        {
            "lesson_type_id": str(lesson_type.id), "name": "QA Course",
            "schedules": [{
                "start_date": (date.today() + timedelta(days=1)).isoformat(),
                "start_time": "10:00", "duration_minutes": 60, "frequency": "single",
            }],
        },
        format="json",
    )
    assert resp.status_code in (200, 201), resp.content
    assert Course.objects.filter(school=school, name="QA Course").exists()


# --- R4-M2 / X-R4-03: a top-level JSON *array*, and list-valued fields --------
#
# The parser lets a list through on purpose (attendance takes one), so every
# view that wants an object has to say so itself.


@pytest.mark.parametrize("path", ANONYMOUS_ENDPOINTS + ["/api/auth/password-reset-validate/"])
def test_an_array_body_on_an_anonymous_endpoint_is_a_400(path):
    resp = _client().post(path, data="[1, 2]", content_type="application/json")
    assert resp.status_code == 400, (path, resp.status_code, resp.content[:200])


@pytest.mark.parametrize("path", ["/api/auth/password-reset-confirm/", "/api/auth/complete-invite/", "/api/auth/password-reset-validate/"])
def test_list_valued_fields_on_the_reset_and_invite_endpoints_are_a_400(path):
    body = {"uid": [1], "token": {"a": 1}, "new_password": [1], "password": [1], "first_name": [1]}
    resp = _client().post(path, body, format="json")
    assert resp.status_code == 400, (path, resp.status_code, resp.content[:200])


@pytest.mark.parametrize("method,path", [
    ("post", "/api/school/team/"),
    ("post", "/api/school/teachers/"),
    ("post", "/api/school/classes/"),
    ("post", "/api/school/packages/"),
    ("post", "/api/school/locations/"),
    ("post", "/api/school/document-types/"),
    ("post", "/api/school/quick-replies/"),
    ("patch", "/api/school/profile/"),
])
def test_an_array_body_on_a_school_endpoint_is_a_400(owner_client, method, path):
    resp = getattr(owner_client, method)(path, data="[1]", content_type="application/json")
    assert resp.status_code == 400, (path, resp.status_code, resp.content[:200])


@pytest.fixture
def lesson(school):
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    course = Course.objects.create(school=school, lesson_type=lt, credit_cost=Decimal("1"), min_booking_notice_hours=0)
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lt, date=date.today() - timedelta(days=7),
        start_time=time(10, 0), end_time=time(11, 0), max_capacity=10, status="scheduled",
    )


@pytest.mark.parametrize("body", [
    '{"attendance": "x"}',
    "[1, 2]",
    '[{"student_id": "x", "status_id": "y"}]',
    '[{"student_id": "00000000-0000-0000-0000-000000000000", "status_id": "y"}]',
])
def test_malformed_attendance_marks_are_a_400(owner_client, lesson, body):
    """TCH-R4-01: the register's main write endpoint answered 500 for all
    four shapes (R3-M8 had only closed the scalar-body case)."""
    resp = owner_client.post(f"/api/school/attendance/{lesson.pk}/", data=body, content_type="application/json")
    assert resp.status_code == 400, (body, resp.status_code, resp.content[:200])
