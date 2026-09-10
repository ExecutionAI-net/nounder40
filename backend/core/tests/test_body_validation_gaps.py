"""X-R3-14 / X-R3-15 / X-R3-16: the leftovers of "the body is whatever arrives".

Each of these answered 2xx for a request that meant nothing: an empty course,
a login that could not match its own row, a head count of -1, a booking batch
that booked nothing, and a homepage save that zeroed the counters it was not
given.
"""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Role
from catalog.models import Course, LessonType, SubscriptionCatalog
from schools.models import School, SchoolMembership
from students.models import Student
from teachers.models import CompensationPlan
from translations.models import PlatformSetting

pytestmark = pytest.mark.django_db
User = get_user_model()


def _school():
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com",
    )


def _owner_client(school):
    user = User.objects.create(
        email=f"own-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL],
        active_school=school,
    )
    SchoolMembership.objects.create(school=school, profile=user, sub_role="owner")
    client = APIClient()
    client.force_authenticate(user)
    return client


# ---- X-R3-14 empty creates --------------------------------------------------

def test_an_empty_course_is_refused():
    school = _school()
    resp = _owner_client(school).post("/api/school/courses/", {}, format="json")
    assert resp.status_code == 400, resp.data
    assert {"lesson_type", "start_date", "start_time"} <= set(resp.data)
    assert not Course.objects.exists()


def test_a_complete_course_is_still_accepted():
    school = _school()
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    resp = _owner_client(school).post(
        "/api/school/courses/",
        {"lesson_type": str(lt.id), "start_date": "2027-01-11", "start_time": "10:00", "name": "Corso"},
        format="json",
    )
    assert resp.status_code == 201, resp.data
    assert Course.objects.get().school_id == school.id


def test_the_retired_subscriptions_catalogue_is_read_only():
    school = _school()
    client = _owner_client(school)
    assert client.post("/api/school/subscriptions/", {}, format="json").status_code == 405
    assert client.get("/api/school/subscriptions/").status_code == 200
    assert not SubscriptionCatalog.objects.exists()


# ---- X-R3-15 login is case-insensitive --------------------------------------

def test_login_accepts_the_address_in_any_case():
    User.objects.create_user(email="qa-case@uberip.com", password="QaRound3!2026")
    client = APIClient()
    for typed in ("qa-case@uberip.com", "QA-CASE@uberip.com", "Qa-Case@UberIP.com"):
        resp = client.post("/api/auth/login/", {"email": typed, "password": "QaRound3!2026"}, format="json")
        assert resp.status_code == 200, (typed, resp.data)


def test_a_wrong_password_is_still_refused_whatever_the_case():
    User.objects.create_user(email="qa-case2@uberip.com", password="QaRound3!2026")
    resp = APIClient().post(
        "/api/auth/login/", {"email": "QA-CASE2@uberip.com", "password": "nope"}, format="json",
    )
    assert resp.status_code == 401


def test_an_exact_match_wins_over_a_case_insensitive_one():
    """`email` is a case-sensitive unique column and the Supabase import
    copied addresses verbatim, so both rows can exist. The typed address has
    to reach its own account."""
    lower = User.objects.create_user(email="dup@uberip.com", password="LowerPass!2026")
    upper = User.objects.create_user(email="DUP@uberip.com", password="UpperPass!2026")
    assert lower.pk != upper.pk
    client = APIClient()
    assert client.post(
        "/api/auth/login/", {"email": "DUP@uberip.com", "password": "UpperPass!2026"}, format="json",
    ).status_code == 200
    assert client.post(
        "/api/auth/login/", {"email": "dup@uberip.com", "password": "LowerPass!2026"}, format="json",
    ).status_code == 200


# ---- X-R3-16a the simulator -------------------------------------------------

@pytest.fixture
def plan_client():
    school = _school()
    plan = CompensationPlan.objects.create(
        school=school, name="Base", base_fee=20, bonus_threshold=1, bonus_per_student=5,
    )
    return _owner_client(school), plan


@pytest.mark.parametrize("students", [-1, 1_000_000_000_000])
def test_the_simulator_refuses_an_impossible_head_count(plan_client, students):
    client, plan = plan_client
    resp = client.post(
        f"/api/school/compensation-plans/{plan.id}/simulate/", {"students": students}, format="json",
    )
    assert resp.status_code == 400, resp.data
    assert "students" in resp.data


def test_the_simulator_still_prices_a_real_class(plan_client):
    client, plan = plan_client
    resp = client.post(
        f"/api/school/compensation-plans/{plan.id}/simulate/", {"students": 3}, format="json",
    )
    assert resp.status_code == 200, resp.data
    assert resp.data["fee"] == 30.0  # 20 base + 2 over the threshold x 5


def test_the_simulator_refuses_a_malformed_lesson_type(plan_client):
    client, plan = plan_client
    resp = client.post(
        f"/api/school/compensation-plans/{plan.id}/simulate/",
        {"students": 2, "lesson_type_id": "not-a-uuid"}, format="json",
    )
    assert resp.status_code == 400, resp.data


# ---- X-R3-16d homepage counters ---------------------------------------------

@pytest.fixture
def hq_client():
    hq = User.objects.create(email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ])
    client = APIClient()
    client.force_authenticate(hq)
    return client


def _stat(key):
    row = PlatformSetting.objects.filter(key=key).first()
    return None if row is None else row.value


ALL_FOUR = {"teachers": 12, "students": 340, "lessonsMonthly": 88, "schools": 4}


def test_a_body_that_names_no_counter_changes_nothing(hq_client):
    hq_client.post("/api/hq/homepage-settings/", ALL_FOUR, format="json")
    resp = hq_client.post("/api/hq/homepage-settings/", {"stat_students": 999}, format="json")
    assert resp.status_code == 200, resp.data
    assert resp.data["updated"] == []
    assert (_stat("stat_students"), _stat("stat_teachers")) == ("340", "12")


def test_a_partial_body_leaves_the_other_counters_alone(hq_client):
    hq_client.post("/api/hq/homepage-settings/", ALL_FOUR, format="json")
    assert hq_client.post("/api/hq/homepage-settings/", {"students": 341}, format="json").status_code == 200
    assert (_stat("stat_students"), _stat("stat_teachers"), _stat("stat_schools")) == ("341", "12", "4")


def test_a_blank_input_leaves_its_counter_alone(hq_client):
    """An emptied form field must not become a zero, nor block the save."""
    hq_client.post("/api/hq/homepage-settings/", ALL_FOUR, format="json")
    assert hq_client.post("/api/hq/homepage-settings/", {"students": ""}, format="json").status_code == 200
    assert _stat("stat_students") == "340"


# ---- X-R3-16c the booking batch ---------------------------------------------

@pytest.mark.parametrize("body", [{}, {"lessons": []}, {"lesson_ids": "x"}])
def test_a_booking_batch_that_names_no_lesson_is_refused(body):
    school = _school()
    user = User.objects.create(
        email=f"stu-{uuid.uuid4().hex[:8]}@example.com", role=Role.STUDENT, roles=[Role.STUDENT],
    )
    Student.objects.create(user=user, name="Anna", school=school)
    client = APIClient()
    client.force_authenticate(user)
    resp = client.post("/api/bookings/multiple/", body, format="json")
    assert resp.status_code == 400, (body, resp.data)
