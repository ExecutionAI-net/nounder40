"""R3-M13 (QA_REGRESSION_ROUND3_CROSSCUT.md X-R3-09): the calendar
WebSocket channels were still unconditional HQ god-mode.

Same root cause as R3-H1 and the R2-H2 family: a bare `is_hq(user)` read as
"this caller may see every school". PR #89 closed it for `/api/school/*` (the
section-guard middleware), for `SchoolScopedModelViewSet` and for chat, and
R3-H1 closed it for `/api/documents/`. A WebSocket passes through none of
those layers, so live:

    wss://…/ws/calendar/school/<E1>/?token=<qa.hq.support>   -> OPEN
    wss://…/ws/calendar/school/<E1>/?token=<qa.hq.finance>   -> OPEN
    wss://…/ws/calendar/teacher/<T>/?token=<qa.hq.support>   -> OPEN

while the same tokens were 403 on `GET /school/lessons/?school=<E1>`. The
payload is `catalog/realtime._lesson_payload` — lesson id, date, time,
teacher, room on every change.

Following the same style as core/tests/test_ws_unmatched_route.py: no
pytest-asyncio in this project, so each test wraps its body in
`async_to_sync`, and `django_db` is required because every consumer's
dispatch loop touches the DB connection wrapper before anything else.
"""
import uuid

import pytest
from asgiref.sync import async_to_sync
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import HQMember, Role
from config.asgi import application
from schools.models import School
from teachers.models import Teacher

pytestmark = pytest.mark.django_db
User = get_user_model()

NARROW = ["support", "tech_support", "finance", "analytics"]
GODMODE = ["owner", "super_admin", "operations"]


def _hq_token(sub_role):
    user = User.objects.create(
        email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ], hq_sub_role=sub_role
    )
    HQMember.objects.create(user=user, email=user.email, name="QA", sub_role=sub_role, active=True)
    return str(RefreshToken.for_user(user).access_token)


@pytest.fixture
def school():
    return School.objects.create(
        name="Victim", slug=f"s-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com"
    )


@pytest.fixture
def teacher(school):
    email = f"t-{uuid.uuid4().hex[:8]}@example.com"
    user = User.objects.create(email=email, role=Role.TEACHER, roles=[Role.TEACHER])
    return Teacher.objects.create(user=user, name="QA Teacher", email=email)


def _connect(path):
    result = {}

    async def run():
        communicator = WebsocketCommunicator(application, path)
        connected, close_code = await communicator.connect()
        result["connected"], result["close_code"] = connected, close_code
        await communicator.disconnect()

    async_to_sync(run)()
    return result


@pytest.mark.parametrize("sub_role", NARROW)
def test_a_narrow_hq_role_cannot_open_a_school_calendar(sub_role, school):
    result = _connect(f"/ws/calendar/school/{school.id}/?token={_hq_token(sub_role)}")

    assert result["connected"] is False, sub_role
    assert result["close_code"] == 4403


@pytest.mark.parametrize("sub_role", NARROW)
def test_a_narrow_hq_role_cannot_open_a_teacher_calendar(sub_role, teacher):
    result = _connect(f"/ws/calendar/teacher/{teacher.id}/?token={_hq_token(sub_role)}")

    assert result["connected"] is False, sub_role
    assert result["close_code"] == 4403


@pytest.mark.parametrize("sub_role", GODMODE)
def test_genuine_cross_school_hq_authority_still_opens_a_school_calendar(sub_role, school):
    result = _connect(f"/ws/calendar/school/{school.id}/?token={_hq_token(sub_role)}")

    assert result["connected"] is True, sub_role


@pytest.mark.parametrize("sub_role", GODMODE)
def test_genuine_cross_school_hq_authority_still_opens_a_teacher_calendar(sub_role, teacher):
    result = _connect(f"/ws/calendar/teacher/{teacher.id}/?token={_hq_token(sub_role)}")

    assert result["connected"] is True, sub_role


def test_the_schools_own_user_still_opens_its_calendar(school):
    user = User.objects.create(
        email=f"own-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL],
        active_school=school,
    )
    token = str(RefreshToken.for_user(user).access_token)

    assert _connect(f"/ws/calendar/school/{school.id}/?token={token}")["connected"] is True


def test_a_teacher_still_opens_her_own_calendar(teacher):
    token = str(RefreshToken.for_user(teacher.user).access_token)

    assert _connect(f"/ws/calendar/teacher/{teacher.id}/?token={token}")["connected"] is True


def test_a_teacher_cannot_open_another_teachers_calendar(teacher, school):
    other_email = f"t2-{uuid.uuid4().hex[:8]}@example.com"
    other_user = User.objects.create(email=other_email, role=Role.TEACHER, roles=[Role.TEACHER])
    Teacher.objects.create(user=other_user, name="Other", email=other_email)
    token = str(RefreshToken.for_user(other_user).access_token)

    result = _connect(f"/ws/calendar/teacher/{teacher.id}/?token={token}")

    assert result["connected"] is False
    assert result["close_code"] == 4403


def test_no_token_is_still_4401(school):
    result = _connect(f"/ws/calendar/school/{school.id}/")

    assert result["connected"] is False
    assert result["close_code"] == 4401
