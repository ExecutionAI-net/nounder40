from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from core.section_guard import hq_school_access


class _BaseCalendarConsumer(AsyncJsonWebsocketConsumer):
    group_prefix = ""

    def _target_id(self):
        raise NotImplementedError

    async def _can_access(self, user):
        raise NotImplementedError

    async def connect(self):
        user = self.scope["user"]
        if not user.is_authenticated:
            await self.close(code=4401)
            return
        if not await self._can_access(user):
            await self.close(code=4403)
            return
        self.group_name = f"{self.group_prefix}{self._target_id()}"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def calendar_event(self, event):
        payload = {k: v for k, v in event.items() if k != "type"}
        await self.send_json({"type": "calendar_event", **payload})


class SchoolCalendarConsumer(_BaseCalendarConsumer):
    """ws/calendar/school/<school_id>/?token=<jwt> — HQ or that school's own users."""

    group_prefix = "calendar_school_"

    def _target_id(self):
        return self.scope["url_route"]["kwargs"]["school_id"]

    @database_sync_to_async
    def _can_access(self, user):
        # X-R3-09: a bare `is_hq()` here was unconditional cross-school
        # god-mode, the same hole PR #89 closed for /api/school/* and R3-H1
        # closed for /api/documents/. A WebSocket never passes through
        # SchoolSectionGuardMiddleware, so `qa.hq.support` -- 403 on
        # `GET /school/lessons/?school=<X>` -- still opened this school's
        # calendar channel and received every lesson change on it.
        if hq_school_access(user) or str(getattr(user, "active_school_id", "")) == self._target_id():
            return True
        # A teacher the school made staff: her calendar shows every lesson of
        # the school, so she listens to the school's events too
        # (teachers/access.py, TeacherSchool.can_view_all_lessons).
        from teachers.models import TeacherSchool

        return TeacherSchool.objects.filter(
            teacher__user=user, school_id=self._target_id(), active=True, can_view_all_lessons=True
        ).exists()


class TeacherCalendarConsumer(_BaseCalendarConsumer):
    """ws/calendar/teacher/<teacher_id>/?token=<jwt> — HQ or that teacher's own account."""

    group_prefix = "calendar_teacher_"

    def _target_id(self):
        return self.scope["url_route"]["kwargs"]["teacher_id"]

    @database_sync_to_async
    def _can_access(self, user):
        from teachers.models import Teacher

        if hq_school_access(user):
            return True
        teacher = Teacher.objects.filter(user=user).first()
        return teacher is not None and str(teacher.id) == self._target_id()
