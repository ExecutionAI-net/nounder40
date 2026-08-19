"""DRF authentication that also accepts the JWT via ?token= when there's no
Authorization header — needed for plain <a href>/<img src> links to private
files (X-Accel-Redirect endpoints for chat attachments and student
documents), which can't carry a custom header. Mirrors core/ws_auth.py's
same accommodation for the Channels WebSocket handshake."""

from rest_framework_simplejwt.authentication import JWTAuthentication


class QueryParamJWTAuthentication(JWTAuthentication):
    def authenticate(self, request):
        if self.get_header(request) is not None:
            return super().authenticate(request)
        token = request.GET.get("token")
        if not token:
            return None
        validated_token = self.get_validated_token(token)
        return self.get_user(validated_token), validated_token
