import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.development")

# Initialise Django before importing anything that touches the app registry.
django_asgi_app = get_asgi_application()

from django.urls import re_path  # noqa: E402

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402

from catalog.routing import websocket_urlpatterns as catalog_ws  # noqa: E402
from chat.routing import websocket_urlpatterns as chat_ws  # noqa: E402
from core.ws_auth import JWTAuthMiddleware, NotFoundConsumer  # noqa: E402

# Catch-all MUST stay last: URLRouter tries patterns in order and raises an
# unhandled exception (→ 500 on the handshake) if none match, so an unmatched
# /ws/ path needs an explicit fallback route rather than relying on
# URLRouter's own (nonexistent) 404 handling.
websocket_urlpatterns = chat_ws + catalog_ws + [re_path(r".*", NotFoundConsumer.as_asgi())]

application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": JWTAuthMiddleware(URLRouter(websocket_urlpatterns)),
    }
)
