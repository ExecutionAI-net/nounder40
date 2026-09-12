"""Calendar realtime — publish a lesson change to its school's (and, if
assigned, its teacher's) Channels group. Consumers just relay whatever shape
is sent here straight to the connected WebSocket clients, who refetch/patch
their own calendar state — this is a change *signal*, not a data sync channel."""

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer


def _lesson_payload(lesson, *, deleted: bool) -> dict:
    return {
        "id": str(lesson.id),
        "school": str(lesson.school_id),
        "teacher": str(lesson.teacher_id) if lesson.teacher_id else None,
        "date": lesson.date.isoformat(),
        "status": lesson.status,
        "deleted": deleted,
    }


def broadcast_calendar_change(lesson, *, deleted: bool = False) -> None:
    layer = get_channel_layer()
    if layer is None:
        return  # no channel layer configured (e.g. tests) — no-op
    payload = _lesson_payload(lesson, deleted=deleted)
    async_to_sync(layer.group_send)(f"calendar_school_{lesson.school_id}", {"type": "calendar_event", **payload})
    if lesson.teacher_id:
        async_to_sync(layer.group_send)(
            f"calendar_teacher_{lesson.teacher_id}", {"type": "calendar_event", **payload}
        )


def broadcast_calendar_refresh(school_id, teacher_ids=()) -> None:
    """TCH-R4-07: one "something changed, refetch" signal per group.

    `broadcast_calendar_change` was called only from the plain
    `/api/school/lessons/` viewset, which the UI never writes through: the
    calendar and course pages create, move and cancel classes via
    `/api/school/classes/*` and the course wizard, so the teacher with her
    calendar open never saw a change until reload. The bulk writers (a
    year of weekly classes is up to 200 rows) send one event per group
    rather than one per lesson -- clients refetch on any event anyway.
    """
    layer = get_channel_layer()
    if layer is None:
        return
    payload = {"type": "calendar_event", "school": str(school_id), "refresh": True}
    async_to_sync(layer.group_send)(f"calendar_school_{school_id}", {**payload, "teacher": None})
    for teacher_id in {t for t in teacher_ids if t}:
        async_to_sync(layer.group_send)(f"calendar_teacher_{teacher_id}", {**payload, "teacher": str(teacher_id)})
