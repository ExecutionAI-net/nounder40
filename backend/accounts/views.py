from django.conf import settings
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import Role, User
from .serializers import (
    ChangePasswordSerializer,
    ProfileUpdateSerializer,
    RegisterSerializer,
    TokenPairSerializer,
    UserSerializer,
)


def _tokens_for(user):
    refresh = RefreshToken.for_user(user)
    return {"access": str(refresh.access_token), "refresh": str(refresh)}


class RegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return Response(
            {"user": UserSerializer(user).data, **_tokens_for(user)},
            status=status.HTTP_201_CREATED,
        )


class LoginView(TokenObtainPairView):
    permission_classes = [AllowAny]
    serializer_class = TokenPairSerializer


@api_view(["POST"])
@permission_classes([AllowAny])
def logout_view(request):
    """Best-effort logout: blacklist the refresh token if present. Idempotent —
    an already-rotated/blacklisted or missing token still returns success so the
    client can always clear its session."""
    token = request.data.get("refresh")
    if token:
        try:
            RefreshToken(token).blacklist()
        except Exception:
            pass
    return Response(status=status.HTTP_205_RESET_CONTENT)


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def me_view(request):
    if request.method == "PATCH":
        serializer = ProfileUpdateSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
    return Response(UserSerializer(request.user).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def change_password_view(request):
    serializer = ChangePasswordSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = request.user
    if not user.check_password(serializer.validated_data["current_password"]):
        return Response({"detail": "current password is incorrect"}, status=status.HTTP_400_BAD_REQUEST)
    user.set_password(serializer.validated_data["new_password"])
    user.save(update_fields=["password"])
    return Response({"detail": "password updated"})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_role_view(request):
    return Response({"role": request.user.role, "roles": request.user.roles})


class GoogleLoginView(APIView):
    """Verify a Google id_token from the frontend and return JWTs."""

    permission_classes = [AllowAny]

    def post(self, request):
        token = request.data.get("id_token") or request.data.get("credential")
        if not token:
            return Response({"detail": "id_token required"}, status=status.HTTP_400_BAD_REQUEST)
        if not settings.GOOGLE_OAUTH2_CLIENT_ID:
            return Response({"detail": "Google login not configured"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token as google_id_token

        try:
            info = google_id_token.verify_oauth2_token(
                token, google_requests.Request(), settings.GOOGLE_OAUTH2_CLIENT_ID
            )
        except ValueError:
            return Response({"detail": "invalid Google token"}, status=status.HTTP_400_BAD_REQUEST)

        email = (info.get("email") or "").lower().strip()
        if not email:
            return Response({"detail": "Google account has no email"}, status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.filter(email__iexact=email).first()
        created = False
        if user is None:
            from students.models import Student

            user = User.objects.create(
                email=email,
                full_name=info.get("name", ""),
                role=Role.STUDENT,
                roles=[Role.STUDENT],
            )
            user.set_unusable_password()
            user.save()
            Student.objects.create(user=user, name=user.full_name, email=email)
            created = True

        return Response(
            {"user": UserSerializer(user).data, "created": created, **_tokens_for(user)},
            status=status.HTTP_200_OK,
        )
