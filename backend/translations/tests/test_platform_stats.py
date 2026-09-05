"""I contatori della home devono essere veri: calcolati dal database, non
copiati a mano in platform_settings. Le altre chiavi del dump (es. i toggle
del negozio) restano passanti.
"""
import uuid
from datetime import date, time

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework.test import APIClient

from accounts.models import Role
from catalog.models import Lesson, LessonType
from schools.models import School, SchoolLocation
from students.models import Student
from teachers.models import Teacher, TeacherSchool
from translations.models import PlatformSetting

User = get_user_model()

pytestmark = pytest.mark.django_db

URL = "/api/platform-stats/"


@pytest.fixture(autouse=True)
def _clear_stats_cache():
    cache.delete("real_platform_stats")
    yield
    cache.delete("real_platform_stats")


def _school(active=True):
    return School.objects.create(
        name=f"Danza {uuid.uuid4().hex[:6]}", slug=f"s-{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex[:6]}@example.com", city="Milano", active=active,
    )


def _teacher_at(school, teacher_active=True, link_active=True):
    teacher = Teacher.objects.create(
        name=f"T {uuid.uuid4().hex[:6]}", email=f"{uuid.uuid4().hex[:6]}@example.com",
        active=teacher_active,
    )
    TeacherSchool.objects.create(teacher=teacher, school=school, active=link_active)
    return teacher


def test_stats_are_computed_not_manual():
    school = _school()
    SchoolLocation.objects.create(school=school, name="Sede Centro")
    SchoolLocation.objects.create(school=school, name="Sede Nord")
    _teacher_at(school)
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com", role=Role.STUDENT, roles=[Role.STUDENT])
    Student.objects.create(user=user, name="Anna", school=school)
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre", name_it="Sbarra")
    Lesson.objects.create(
        school=school, lesson_type=lt, date=date.today(),
        start_time=time(10, 0), end_time=time(11, 0), max_capacity=10,
    )
    # Il valore manuale non deve vincere sul conteggio vero
    PlatformSetting.objects.create(key="stat_students", value="9999")

    data = APIClient().get(URL).json()

    assert data["stat_schools"] == "2"  # le sedi, non le scuole
    assert data["stat_teachers"] == "1"
    assert data["stat_students"] == "1"
    assert data["stat_lessons_monthly"] == "1"


def test_no_locations_falls_back_to_school_count():
    _school()
    _school()
    _school(active=False)  # le scuole spente non contano

    data = APIClient().get(URL).json()

    assert data["stat_schools"] == "2"


def test_inactive_pieces_do_not_count():
    school = _school()
    _teacher_at(school, teacher_active=False)          # maestro spento
    _teacher_at(school, link_active=False)             # assegnazione spenta
    off = _school(active=False)
    SchoolLocation.objects.create(school=off, name="Sede scuola spenta")
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre", name_it="Sbarra")
    Lesson.objects.create(
        school=school, lesson_type=lt, date=date.today(),
        start_time=time(10, 0), end_time=time(11, 0), max_capacity=10,
        status=Lesson.Status.CANCELLED,                # le annullate non contano
    )

    data = APIClient().get(URL).json()

    assert data["stat_teachers"] == "0"
    assert data["stat_schools"] == "1"                 # solo la scuola attiva
    assert data["stat_lessons_monthly"] == "0"


def test_other_settings_keys_still_pass_through():
    PlatformSetting.objects.create(key="student_shop_enabled", value="false")

    data = APIClient().get(URL).json()

    assert data["student_shop_enabled"] == "false"
