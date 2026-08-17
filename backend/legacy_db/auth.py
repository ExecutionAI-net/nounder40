"""
Verifies the JWT Supabase Auth (GoTrue) already issues on login — Auth
itself stays on Supabase for now (see Faz Son in the migration plan).
This lets Django API endpoints trust "who is this user" without touching
login/session at all.

The project signs tokens asymmetrically (ES256, see /auth/v1/.well-known/
jwks.json), so verification only needs Supabase's public key — no shared
secret to store or rotate.
"""
from django.conf import settings
from jwt import PyJWKClient
import jwt
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

_jwks_client = PyJWKClient(f'{settings.SUPABASE_URL}/auth/v1/.well-known/jwks.json')


class SupabaseUser:
    """Minimal stand-in for Django's User — identity only, no local auth model yet."""

    is_authenticated = True

    def __init__(self, claims):
        self.claims = claims
        self.id = claims['sub']
        self.email = claims.get('email')


class SupabaseJWTAuthentication(BaseAuthentication):
    def authenticate(self, request):
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return None

        token = auth_header.removeprefix('Bearer ').strip()
        try:
            signing_key = _jwks_client.get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token,
                signing_key.key,
                algorithms=['ES256'],
                audience='authenticated',
            )
        except jwt.PyJWTError as exc:
            raise AuthenticationFailed(f'Invalid Supabase token: {exc}')

        return (SupabaseUser(claims), None)
