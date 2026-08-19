import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.development")

# Initialise Django before importing anything that touches the app registry.
django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter  # noqa: E402

# WebSocket routing is added in Phase 5 (chat + calendar consumers). For now
# only HTTP is served; the ProtocolTypeRouter is in place so wiring ws/ later
# is a one-line change.
application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
    }
)
