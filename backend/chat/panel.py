"""Which panel is this chat request coming from?

The rest of the API tells a multi-role account's panels apart by mount point
(/api/school/* vs /api/hq/*, enforced by core.section_guard). Chat lives on
one shared mount, /api/chat/, so it could not: `is_hq(user)` won a multi-role
account the HQ branch everywhere, even while it was navigating the school
panel -- the school-side admin saw every conversation of every school in
their badge and list, and a thread they opened "as the school" was saved
with `hq=user` and no school at all (so HQ's inbox showed it without a
school name).

The frontend now says which panel it is on: `X-Panel-Role` header on REST
calls (lib/api/client.ts, derived from the /<locale>/<panel>/ URL) and
`?as=` on the WebSocket handshake (lib/ws.ts). It is only ever trusted when
that role is one the user actually holds; anything else falls back to the
account's primary `role`, so a single-role user behaves exactly as before
and a forged header cannot grant a role."""

from urllib.parse import parse_qs

PANEL_ROLES = ("hq", "school", "teacher", "student")
HEADER = "X-Panel-Role"
QUERY_PARAM = "as"


def user_roles(user) -> set[str]:
    roles = set(user.roles or [])
    if user.role:
        roles.add(user.role)
    return roles


def panel_role(user, requested: str | None) -> str:
    """The panel role to act as: `requested` if the user holds it, else the
    account's primary role (or the first held role when `role` is blank)."""
    held = user_roles(user)
    if requested in PANEL_ROLES and requested in held:
        return requested
    if user.role:
        return user.role
    return next((r for r in PANEL_ROLES if r in held), "student")


def request_panel_role(request) -> str:
    requested = request.headers.get(HEADER) or request.query_params.get(QUERY_PARAM)
    return panel_role(request.user, requested)


def scope_panel_role(scope, user) -> str:
    """Same thing for a Channels consumer (query string only)."""
    query = parse_qs(scope.get("query_string", b"").decode())
    return panel_role(user, query.get(QUERY_PARAM, [None])[0])
