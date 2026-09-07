from django.urls import re_path

from .consumers import ChatConsumer, InboxConsumer

websocket_urlpatterns = [
    re_path(r"^ws/chat/(?P<conversation_id>[0-9a-fA-F-]{36})/$", ChatConsumer.as_asgi()),
    re_path(r"^ws/inbox/$", InboxConsumer.as_asgi()),
]
