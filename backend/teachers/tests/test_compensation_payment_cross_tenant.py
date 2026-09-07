"""SCH-R2-09 / X-R2-06: `SchoolCompensationPaymentsSummaryView.post` did
`TeacherCompensationPayment.objects.update_or_create(school_id=<caller>,
teacher_id=<any id from the request body>, ...)` with no check that the
target teacher actually teaches at the caller's school -- a school admin
could record (and get back, in the response, the real name of) a
compensation payment for a teacher who has never taught there."""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role
from schools.models import School, SchoolMembership
from teachers.models import Teacher, TeacherCompensationPayment, TeacherSchool

pytestmark = pytest.mark.django_db
User = get_user_model()


def _school(name="S"):
    return School.objects.create(
        name=name, slug=f"s-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com",
        active=True,
    )


def _teacher(name="T"):
    user = User.objects.create(email=f"t-{uuid.uuid4().hex[:8]}@example.com", role=Role.TEACHER, roles=[Role.TEACHER])
    return Teacher.objects.create(user=user, name=name, email=user.email)


def _school_client(school):
    # sub_role="owner": SchoolSectionGuardMiddleware bypasses the permission
    # matrix outright for "owner" (no SchoolRole.permissions lookup), so this
    # doesn't depend on the "admin" SchoolRole's seeded/cached permission set
    # -- other test modules (e.g. core/tests/test_school_membership_gate.py)
    # legitimately rewrite that row's permissions for their own fixtures, and
    # the guard's 30s matrix cache can make that rewrite visible here too.
    user = User.objects.create(email=f"sch-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school)
    SchoolMembership.objects.create(profile=user, school=school, sub_role="owner")
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


def test_cannot_record_a_payment_for_a_teacher_of_another_school():
    caller_school = _school("Caller")
    other_school = _school("Other")
    foreign_teacher = _teacher("Foreign Teacher")
    TeacherSchool.objects.create(teacher=foreign_teacher, school=other_school)

    client = _school_client(caller_school)
    resp = client.post(
        "/api/school/compensation-summary/",
        {"teacher_id": str(foreign_teacher.id), "month": "2026-09", "amount": "5", "status": "paid"},
        format="json",
    )
    assert resp.status_code == 404
    assert not TeacherCompensationPayment.objects.filter(school=caller_school, teacher=foreign_teacher).exists()


def test_can_still_record_a_payment_for_its_own_teacher():
    school = _school()
    teacher = _teacher("Real Teacher")
    TeacherSchool.objects.create(teacher=teacher, school=school)

    client = _school_client(school)
    resp = client.post(
        "/api/school/compensation-summary/",
        {"teacher_id": str(teacher.id), "month": "2026-09", "amount": "5", "status": "paid"},
        format="json",
    )
    assert resp.status_code == 201, resp.content
    assert TeacherCompensationPayment.objects.filter(school=school, teacher=teacher, month="2026-09").exists()
