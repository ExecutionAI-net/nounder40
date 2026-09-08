"""Channels (ASGI) auth middleware. Browsers can't set an Authorization header
on a WebSocket handshake, so the JWT access token travels as a query param:
ws://host/ws/chat/<id>/?token=<access>. Same SimpleJWT access tokens the REST
API already issues — no separate WS token type."""

from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from django.contrib.auth.models import AnonymousUser


@database_sync_to_async
def _user_from_token(token: str):
    from rest_framework_simplejwt.exceptions import TokenError
    from rest_framework_simplejwt.tokens import AccessToken

    from accounts.models import User

    try:
        validated = AccessToken(token)
        return User.objects.filter(pk=validated["user_id"], is_active=True).first() or AnonymousUser()
    except TokenError:
        return AnonymousUser()


class JWTAuthMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        query_string = scope.get("query_string", b"").decode()
        token = parse_qs(query_string).get("token", [None])[0]
        scope["user"] = await _user_from_token(token) if token else AnonymousUser()
        return await self.app(scope, receive, send)


class NotFoundConsumer(AsyncWebsocketConsumer):
    """Catch-all for a /ws/ path that matches none of the app-level patterns
    (catalog/routing.py, chat/routing.py). Route this as the LAST entry of
    the top-level URLRouter in config/asgi.py.

    Channels' URLRouter raises an unhandled exception when nothing matches,
    which the ASGI server (daphne) turns into an opaque 500 on the handshake
    instead of a clean rejection. Closing here — without ever accepting —
    mirrors the 4401/4403 pattern the real consumers use for a rejected
    handshake (see chat/consumers.py, catalog/consumers.py) so an unknown
    path behaves the same way as a known one rejected for a bad token."""

    async def connect(self):
        await self.close(code=4404)
