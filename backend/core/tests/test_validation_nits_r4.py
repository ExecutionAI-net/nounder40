"""R4-L12 (QA_REGRESSION_ROUND4 TCH-R4-06, X-R4-06, SCH-R4-08): the small
validation gaps of round 4 -- an empty chat message was stored, a concurrent
duplicate create 500'd on an uncaught IntegrityError, an attendance status
could be duplicated by changing the case, a class could be set to capacity 0,
and a file-less document could be marked valid.
"""
import uuid
from datetime import date, time, timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.db import IntegrityError
from rest_framework.test import APIClient

from accounts.models import Role
from catalog.models import AttendanceStatus, Course, Lesson, LessonType
from chat.models import Conversation, Message
from schools.models import School, SchoolMembership, SchoolRole, SchoolStudent
from students.models import Student, StudentDocument

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def school():
    SchoolRole.objects.update_or_create(
        key="owner", defaults={"label": "Owner", "builtin": True, "permissions": [
            "team", "teachers", "courses", "lessons", "students", "settings", "inbox", "locations", "documents",
        ]},
    )
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", active=True)


@pytest.fixture
def owner(school):
    user = User.objects.create(
        email=f"own-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role="owner")
    return user


@pytest.fixture
def owner_client(owner):
    api = APIClient()
    api.force_authenticate(owner)
    return api


@pytest.fixture
def student(school):
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com", role=Role.STUDENT, roles=[Role.STUDENT])
    s = Student.objects.create(user=user, name="Anna", school=school)
    SchoolStudent.objects.create(school=school, student=s)
    return s


def test_an_empty_chat_message_is_refused(owner_client, owner, school, student):
    conv = Conversation.objects.create(school=school, student=student, type="school_student")
    before = Message.objects.filter(conversation=conv).count()
    resp = owner_client.post(f"/api/chat/conversations/{conv.pk}/messages/", {"content": "   "}, format="json")
    assert resp.status_code == 400, resp.content
    assert resp.json()["error"] == "content_required"
    assert Message.objects.filter(conversation=conv).count() == before


def test_a_concurrent_duplicate_create_is_a_400_not_a_500(owner_client):
    with patch("schools.serializers.SchoolDocumentTypeSerializer.save", side_effect=IntegrityError("dup")):
        resp = owner_client.post("/api/school/document-types/", {"code": "med", "name": "Medical"}, format="json")
    assert resp.status_code == 400, resp.content


def test_attendance_status_names_are_unique_regardless_of_case(owner_client, school):
    AttendanceStatus.objects.create(school=school, name="QA Presente")
    resp = owner_client.post("/api/school/attendance-statuses/", {"name": "qa presente"}, format="json")
    assert resp.status_code == 400, resp.content
    assert AttendanceStatus.objects.filter(school=school).count() == 1


def test_a_class_cannot_be_set_to_capacity_zero(owner_client, school):
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    course = Course.objects.create(school=school, lesson_type=lt, credit_cost=Decimal("1"), min_booking_notice_hours=0)
    lesson = Lesson.objects.create(
        school=school, course=course, lesson_type=lt, date=date.today() + timedelta(days=30),
        start_time=time(10, 0), end_time=time(11, 0), max_capacity=10, status="scheduled",
    )
    resp = owner_client.patch(f"/api/school/classes/{lesson.pk}/", {"max_capacity": 0}, format="json")
    assert resp.status_code == 400, resp.content
    lesson.refresh_from_db()
    assert lesson.max_capacity == 10


def test_a_document_without_a_file_cannot_be_validated(owner_client, school, student):
    doc = StudentDocument.objects.create(student=student, school=school, status="pending", files=[])
    resp = owner_client.patch(f"/api/school/documents/{doc.pk}/", {"action": "validate"}, format="json")
    assert resp.status_code == 400, resp.content
    assert resp.json()["error"] == "document_has_no_file"
    doc.refresh_from_db()
    assert doc.status == "pending"
