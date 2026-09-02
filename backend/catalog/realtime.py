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
