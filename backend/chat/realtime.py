"""Chat realtime — publish a new message to its conversation's Channels group.
Message creation stays in the REST view (all the is_internal/first_response_at
business logic lives there); this only broadcasts the already-persisted result."""

import json

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer


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
