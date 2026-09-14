"""POST /api/auth/become-student/ — an existing account (teacher, school
staff, HQ) gets the student profile too (Carlo, 14/09/2026).

Before: /register refused the e-mail, Google login returned the account as
it was, and nothing ever appended `student` to `roles`."""
import uuid

import pytest
from rest_framework.test import APIClient

from accounts.models import Role, User
from schools.models import School, SchoolMembership, SchoolStudent
from students.models import Student
from teachers.models import Teacher, TeacherSchool

pytestmark = pytest.mark.django_db

URL = "/api/auth/become-student/"


def _school(name="Danza Milano"):
    return School.objects.create(name=name, slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", active=True)


def _api(user):
    api = APIClient()
    api.force_authenticate(user=user)
    return api


def test_a_teacher_gets_the_student_profile_enrolled_in_her_school():
    school = _school()
    user = User.objects.create_user(
        "greta@example.com", "Danza-2026", role=Role.TEACHER, roles=[Role.TEACHER],
        first_name="Greta", last_name="Rossi", phone="+39 333 0000000", language_preference="de",
    )
    teacher = Teacher.objects.create(user=user, name="Greta Rossi", email=user.email)
    TeacherSchool.objects.create(teacher=teacher, school=school)

    res = _api(user).post(URL)
    assert res.status_code == 200, res.data
    assert res.data["created"] is True
    assert res.data["user"]["roles"] == [Role.TEACHER, Role.STUDENT]

    student = Student.objects.get(user=user)
    assert (student.first_name, student.last_name, student.name) == ("Greta", "Rossi", "Greta Rossi")
    assert (student.email, student.phone, student.language_preference) == (user.email, "+39 333 0000000", "de")
    assert student.school_id == school.id
    assert SchoolStudent.objects.filter(school=school, student=student).exists()
    # Her teacher side is untouched.
    assert TeacherSchool.objects.filter(teacher=teacher, school=school, active=True).exists()


def test_school_staff_is_enrolled_in_her_own_school():
    school = _school()
    user = User.objects.create_user(
        "staff@example.com", "Danza-2026", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school,
        first_name="Anna", last_name="Bianchi",
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role="staff")

    res = _api(user).post(URL)
    assert res.status_code == 200 and res.data["created"] is True
    student = Student.objects.get(user=user)
    assert student.school_id == school.id
    assert SchoolStudent.objects.filter(school=school, student=student).exists()
    user.refresh_from_db()
    assert user.roles == [Role.SCHOOL, Role.STUDENT]


def test_calling_it_twice_changes_nothing():
    user = User.objects.create_user("hq@example.com", "Danza-2026", role=Role.HQ, roles=[Role.HQ], first_name="H", last_name="Q")
    api = _api(user)
    assert api.post(URL).data["created"] is True

    res = api.post(URL)
    assert res.status_code == 200 and res.data["created"] is False
    user.refresh_from_db()
    assert user.roles == [Role.HQ, Role.STUDENT]
    assert Student.objects.filter(user=user).count() == 1


def test_an_account_that_is_already_a_student_is_left_alone():
    user = User.objects.create_user("s@example.com", "Danza-2026", role=Role.STUDENT, roles=[Role.STUDENT])
    Student.objects.create(user=user, name="S", email=user.email)

    res = _api(user).post(URL)
    assert res.status_code == 200 and res.data["created"] is False
    assert Student.objects.filter(user=user).count() == 1


def test_needs_a_login():
    assert APIClient().post(URL).status_code == 401
