"""R2-L5 / X-R2-15: an unmatched `/ws/` path (e.g. `/ws/nope/`) raised an
unhandled exception at the Channels URLRouter level, which the ASGI server
turned into an opaque HTTP 500 on the handshake instead of a clean rejection.

`config/asgi.py` now appends a catch-all route (`core.ws_auth.NotFoundConsumer`)
after the real app patterns; it closes the handshake (code 4404) without ever
accepting, the same "reject before accept" shape the real consumers already
use for a bad token (4401) or forbidden access (4403) — see
chat/consumers.py and catalog/consumers.py. These tests pin that an unknown
path is rejected cleanly and that real, existing routes are unaffected.

No pytest-asyncio in this project (see requirements.txt) — `WebsocketCommunicator`
is async, so each test wraps its body with `asgiref.sync.async_to_sync` rather
than using `async def test_...` directly.

`django_db` is required even though nothing here queries the ORM: every
Channels consumer's dispatch loop calls `channels.db.aclose_old_connections()`
before it does anything else (see channels/consumer.py), and that touches the
DB connection wrapper — pytest-django blocks that without the marker.
"""
import pytest
from asgiref.sync import async_to_sync
from channels.testing import WebsocketCommunicator

from config.asgi import application

pytestmark = pytest.mark.django_db


def test_unmatched_ws_path_closes_cleanly_instead_of_500():
    async def run():
        communicator = WebsocketCommunicator(application, "/ws/nope/")
        connected, close_code = await communicator.connect()
        assert connected is False
        assert close_code == 4404
        await communicator.disconnect()

    async_to_sync(run)()


def test_unmatched_nested_ws_path_also_closes_cleanly():
    async def run():
        communicator = WebsocketCommunicator(application, "/ws/calendar/school/not-a-real-subpath/")
        connected, close_code = await communicator.connect()
        assert connected is False
        assert close_code == 4404
        await communicator.disconnect()

    async_to_sync(run)()


def test_known_route_without_token_still_rejects_4401_not_the_catchall():
    """Regression guard: the catch-all must not shadow real routes. A known
    path (chat inbox) with no token still hits InboxConsumer and gets its
    own 4401, not the catch-all's 4404."""

    async def run():
        communicator = WebsocketCommunicator(application, "/ws/inbox/")
        connected, close_code = await communicator.connect()
        assert connected is False
        assert close_code == 4401
        await communicator.disconnect()

    async_to_sync(run)()
