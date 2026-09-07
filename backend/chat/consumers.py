from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from .realtime import inbox_groups_for_user
from .views import visible_conversations


class ChatConsumer(AsyncJsonWebsocketConsumer):
    """ws/chat/<conversation_id>/?token=<jwt> — join the conversation's group,
    relay any 'chat_message' event (published by the REST message-create views
    in chat/realtime.py) straight to the client. No client→server writes here;
    posting a message always goes through the REST API."""

    async def connect(self):
        self.conversation_id = self.scope["url_route"]["kwargs"]["conversation_id"]
        user = self.scope["user"]
        if not user.is_authenticated:
            await self.close(code=4401)
            return
        if not await self._can_access(user):
            await self.close(code=4403)
            return
        self.group_name = f"chat_{self.conversation_id}"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    @database_sync_to_async
    def _can_access(self, user):
        return visible_conversations(user).filter(pk=self.conversation_id).exists()

    async def chat_message(self, event):
        await self.send_json({"type": "message", "message": event["message"]})


class InboxConsumer(AsyncJsonWebsocketConsumer):
    """ws/inbox/?token=<jwt> — one socket per signed-in user, open for the whole
    session by the panel layout (lib/use-unread.ts). Joins the inbox groups
    that mirror the user's chat visibility and relays 'inbox_event' pings
    (chat/realtime.py) so the sidebar unread badge refreshes on the spot
    instead of on the next 60 s poll. Signal only: the client re-fetches
    /api/chat/unread/ for the actual numbers."""

    async def connect(self):
        user = self.scope["user"]
        if not user.is_authenticated:
            await self.close(code=4401)
            return
        self.group_names = await database_sync_to_async(inbox_groups_for_user)(user)
        for group in self.group_names:
            await self.channel_layer.group_add(group, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        for group in getattr(self, "group_names", []):
            await self.channel_layer.group_discard(group, self.channel_name)

    async def inbox_event(self, event):
        payload = {k: v for k, v in event.items() if k != "type"}
        await self.send_json({"type": "inbox_event", **payload})
