"""Chat realtime — publish a new message to its conversation's Channels group,
and a lightweight "your inbox changed" signal to everyone who can see that
conversation (sidebar unread badge).

Message creation stays in the REST view (all the is_internal/first_response_at
business logic lives there); this only broadcasts the already-persisted result.

The inbox signal deliberately carries no counts: the client re-fetches
/api/chat/unread/, which runs visible_conversations() and the is_internal
filter for the caller, so the number shown is always the server's and a
narrow role can never learn something from the ping it could not read from
the API. Over-notifying is therefore harmless (one extra GET), which lets the
fan-out stay at "the groups this conversation belongs to" instead of a
per-message expansion of every school member and HQ account."""

import json

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

INBOX_USER_GROUP = "inbox_user_{user_id}"
INBOX_SCHOOL_GROUP = "inbox_school_{school_id}"
INBOX_HQ_GROUP = "inbox_hq"


def broadcast_message(message, *, serialized: dict) -> None:
    layer = get_channel_layer()
    if layer is None:
        return
    # DRF's auto FK fields (conversation, sender) render as raw UUID objects
    # in .data (only declared UUIDField-typed fields stringify themselves);
    # channels_redis' msgpack serializer can't pack those. Round-trip through
    # JSON (default=str) to guarantee every value is a primitive it can pack.
    safe_message = json.loads(json.dumps(serialized, default=str))
    async_to_sync(layer.group_send)(
        f"chat_{message.conversation_id}", {"type": "chat_message", "message": safe_message}
    )


def inbox_groups_for_user(user, role: str | None = None) -> list[str]:
    """Groups a connected user listens on, acting as `role` (the panel the
    socket was opened from, chat/panel.py; defaults to the primary role).
    Mirrors visible_conversations(): everyone gets their own user group
    (student/teacher threads are keyed on the participant), the school panel
    also gets its school's group, and the HQ panel the HQ group. A teacher is
    never in the school group — that is exactly the R2-C2 leak, and the ping
    would be harmless anyway, but the badge should not even flicker for
    threads she cannot see."""
    from core.viewsets import is_hq

    role = role or user.role
    groups = [INBOX_USER_GROUP.format(user_id=user.id)]
    if role == "school" and user.active_school_id:
        groups.append(INBOX_SCHOOL_GROUP.format(school_id=user.active_school_id))
    if role == "hq" and is_hq(user):
        groups.append(INBOX_HQ_GROUP)
    return groups


def inbox_groups_for_conversation(conversation) -> list[str]:
    """Groups that must be pinged when `conversation` changes. The student's
    and teacher's *user* ids (Student/Teacher are profiles, the socket is
    keyed on the User), the school's group, and HQ for the two thread types
    HQ's inbox is for (a broad HQ role sees everything, but hq_school and
    teacher_support are the only types whose new messages HQ must react to)."""
    groups = []
    if conversation.student_id:
        groups.append(INBOX_USER_GROUP.format(user_id=conversation.student.user_id))
    if conversation.teacher_id:
        groups.append(INBOX_USER_GROUP.format(user_id=conversation.teacher.user_id))
    if conversation.school_id:
        groups.append(INBOX_SCHOOL_GROUP.format(school_id=conversation.school_id))
    if conversation.type in ("hq_school", "teacher_support"):
        groups.append(INBOX_HQ_GROUP)
    return groups


def _send_inbox_event(groups, payload: dict) -> None:
    layer = get_channel_layer()
    if layer is None:
        return
    event = {"type": "inbox_event", **payload}
    for group in dict.fromkeys(groups):  # de-dup, keep order
        async_to_sync(layer.group_send)(group, event)


def broadcast_inbox_changed(conversation, *, sender_id=None) -> None:
    """A new message landed in `conversation`: tell every listener to refresh
    its unread count. `sender_id` lets the author's own tabs skip the refetch."""
    _send_inbox_event(
        inbox_groups_for_conversation(conversation),
        {
            "reason": "new_message",
            "conversation": str(conversation.id),
            "conversation_type": conversation.type,
            "sender": str(sender_id) if sender_id else None,
        },
    )


def broadcast_inbox_read(conversation, *, user_id) -> None:
    """`user_id` marked messages read: only *their* other tabs/devices need to
    drop the badge, nobody else's count changed."""
    _send_inbox_event(
        [INBOX_USER_GROUP.format(user_id=user_id)],
        {"reason": "read", "conversation": str(conversation.id), "conversation_type": conversation.type, "sender": None},
    )
