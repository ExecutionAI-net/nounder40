from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

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
