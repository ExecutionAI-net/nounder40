"""Deleting a student account: by herself, or by a school for its own
test sign-ups — never an account that other schools (or roles) share."""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Role
from schools.models import School, SchoolStudent
from students.models import Student

pytestmark = pytest.mark.django_db
User = get_user_model()


def _school(name="S"):
    return School.objects.create(name=name, slug=f"s-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com")


def _student(school):
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com", role=Role.STUDENT, roles=[Role.STUDENT])
    student = Student.objects.create(user=user, name="Test Allieva", school=school)
    SchoolStudent.objects.get_or_create(school=school, student=student)
    return student


def _school_client(school):
    user = User.objects.create(email=f"sch-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school)
    client = APIClient()
    client.force_authenticate(user)
    return client


def test_student_deletes_her_own_account():
    student = _student(_school())
    client = APIClient()
    client.force_authenticate(student.user)
    assert client.delete("/api/student/profile/").status_code == 204
    assert not User.objects.filter(pk=student.user_id).exists()
    assert not Student.objects.filter(pk=student.pk).exists()


def test_school_deletes_its_own_student():
    school = _school()
    student = _student(school)
    res = _school_client(school).delete(f"/api/school/students/delete/?student_user_id={student.user_id}")
    assert res.status_code == 204
    assert not User.objects.filter(pk=student.user_id).exists()


def test_school_cannot_delete_a_student_enrolled_elsewhere():
    school, other = _school(), _school("Other")
    student = _student(school)
    SchoolStudent.objects.create(school=other, student=student)
    res = _school_client(school).delete(f"/api/school/students/delete/?student_user_id={student.user_id}")
    assert res.status_code == 409 and res.json()["error"] == "linked_elsewhere"
    assert User.objects.filter(pk=student.user_id).exists()


def test_school_cannot_delete_someone_elses_student():
    school, other = _school(), _school("Other")
    student = _student(other)
    assert _school_client(school).delete(f"/api/school/students/delete/?student_user_id={student.user_id}").status_code == 404


def test_detail_payload_carries_the_user_id_the_sheet_needs():
    """StudentSheet saves and deletes via student.user_id: without it in the
    detail payload both buttons silently did nothing."""
    school = _school()
    student = _student(school)
    res = _school_client(school).get(f"/api/school/students/detail/?student_id={student.id}")
    assert res.status_code == 200
    assert res.json()["student"]["user_id"] == str(student.user_id)
