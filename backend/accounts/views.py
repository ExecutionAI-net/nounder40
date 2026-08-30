from django.conf import settings
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import HQMember, Role, User
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

        from django.db import transaction

        from notifications.tasks import send_transactional_email_task

        transaction.on_commit(
            lambda: send_transactional_email_task.delay(
                to_email=user.email, to_name=user.full_name, key="welcome",
                # The HQ editor offers both spellings of the name placeholder.
                context={
                    "user_name": user.full_name or user.email, "student_name": user.full_name or user.email,
                    "student_first_name": user.first_name or user.full_name or user.email,
                    "platform_name": "No Under 40",
                    "profile_url": f"{settings.FRONTEND_URL}/{user.language_preference or 'en'}/student/profile",
                    "booking_url": f"{settings.FRONTEND_URL}/{user.language_preference or 'en'}/student/book",
                },
                locale=user.language_preference,
            )
        )

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


@api_view(["POST"])
@permission_classes([AllowAny])
def password_reset_request_view(request):
    from django.contrib.auth.tokens import default_token_generator
    from django.db import transaction
    from django.utils.encoding import force_bytes
    from django.utils.http import urlsafe_base64_encode

    from notifications.tasks import send_transactional_email_task

    email = (request.data.get("email") or "").strip().lower()
    user = User.objects.filter(email__iexact=email).first()
    if user is not None:
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        token = default_token_generator.make_token(user)
        reset_url = f"{settings.FRONTEND_URL}/reset-password?uid={uid}&token={token}"
        transaction.on_commit(
            lambda: send_transactional_email_task.delay(
                to_email=user.email, to_name=user.full_name, key="password_reset",
                context={"user_name": user.full_name or user.email, "reset_url": reset_url},
                locale=user.language_preference,
            )
        )
    # Always 200 regardless of whether the email exists — don't leak account existence.
    return Response({"detail": "if that email exists, a reset link has been sent"})


@api_view(["POST"])
@permission_classes([AllowAny])
def password_reset_confirm_view(request):
    from django.contrib.auth.password_validation import ValidationError, validate_password
    from django.contrib.auth.tokens import default_token_generator
    from django.utils.encoding import DjangoUnicodeDecodeError, force_str
    from django.utils.http import urlsafe_base64_decode

    uid, token, new_password = request.data.get("uid"), request.data.get("token"), request.data.get("new_password")
    if not (uid and token and new_password):
        return Response({"error": "uid, token, new_password required"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        pk = force_str(urlsafe_base64_decode(uid))
        user = User.objects.get(pk=pk)
    except (User.DoesNotExist, ValueError, TypeError, DjangoUnicodeDecodeError):
        return Response({"error": "invalid_link"}, status=status.HTTP_400_BAD_REQUEST)

    if not default_token_generator.check_token(user, token):
        return Response({"error": "invalid_or_expired_token"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        validate_password(new_password, user=user)
    except ValidationError as exc:
        return Response({"error": "weak_password", "detail": exc.messages}, status=status.HTTP_400_BAD_REQUEST)

    user.set_password(new_password)
    user.save(update_fields=["password"])
    return Response({"detail": "password updated"})


@api_view(["POST"])
@permission_classes([AllowAny])
def complete_invite_view(request):
    """An invited HQ/school team member sets their name + password on first
    login. Reuses the same token mechanism as password reset — an unusable
    password hash works fine as input to Django's token generator, and the
    token naturally becomes single-use once a real password is set."""
    from django.contrib.auth.password_validation import ValidationError, validate_password
    from django.contrib.auth.tokens import default_token_generator
    from django.utils.encoding import DjangoUnicodeDecodeError, force_str
    from django.utils.http import urlsafe_base64_decode

    uid, token = request.data.get("uid"), request.data.get("token")
    first_name = (request.data.get("first_name") or "").strip()
    last_name = (request.data.get("last_name") or "").strip()
    if not first_name:  # old clients send a single full_name
        first_name, _, last_name = (request.data.get("full_name") or "").strip().partition(" ")
    password = request.data.get("password")
    if not (uid and token and password):
        return Response({"error": "uid, token, password required"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        pk = force_str(urlsafe_base64_decode(uid))
        user = User.objects.get(pk=pk)
    except (User.DoesNotExist, ValueError, TypeError, DjangoUnicodeDecodeError):
        return Response({"error": "invalid_link"}, status=status.HTTP_400_BAD_REQUEST)

    if not default_token_generator.check_token(user, token):
        return Response({"error": "invalid_or_expired_token"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        validate_password(password, user=user)
    except ValidationError as exc:
        return Response({"error": "weak_password", "detail": exc.messages}, status=status.HTTP_400_BAD_REQUEST)

    if first_name:
        user.first_name, user.last_name = first_name, last_name  # save() recomposes full_name
    user.set_password(password)
    user.save()

    if user.role == Role.HQ:
        HQMember.objects.filter(user=user).update(name=user.full_name or user.email)

    return Response({"user": UserSerializer(user).data, **_tokens_for(user)})


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

            # The UI locale is the best guess for the student's language — a
            # Google token carries none.
            language = (request.data.get("language") or "en")[:8]
            user = User.objects.create(
                email=email,
                first_name=info.get("given_name", ""),
                last_name=info.get("family_name", ""),
                full_name=info.get("name", ""),
                role=Role.STUDENT,
                roles=[Role.STUDENT],
                language_preference=language,
            )
            user.set_unusable_password()
            user.save()
            Student.objects.create(
                user=user, name=user.full_name, first_name=user.first_name, last_name=user.last_name, email=email,
                language_preference=language,
            )
            created = True

        return Response(
            {"user": UserSerializer(user).data, "created": created, **_tokens_for(user)},
            status=status.HTTP_200_OK,
        )
