from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import Role, User


class UserSerializer(serializers.ModelSerializer):
    """The 'profile' payload returned to the frontend."""

    # Derived, not the stale column: the frontend filters the school sidebar on
    # this value, so it has to be the membership role for the active school.
    school_sub_role = serializers.SerializerMethodField()
    # Same story on the HQ side: HQMember.sub_role is the source of truth, the
    # flat column is an ETL-style leftover left blank by qa_platform.py (and
    # potentially other paths) -- see effective_hq_sub_role() for why a blank
    # value here silently broke both the sidebar and the backend HQ guards.
    hq_sub_role = serializers.SerializerMethodField()

    def get_school_sub_role(self, obj) -> str:
        return obj.effective_school_sub_role()

    def get_hq_sub_role(self, obj) -> str:
        return obj.effective_hq_sub_role()

    class Meta:
        model = User
        fields = (
            "id", "email", "full_name", "role", "roles", "hq_sub_role",
            "school_sub_role", "active_school", "language_preference", "phone", "city",
        )
        read_only_fields = ("id", "email", "role", "roles", "hq_sub_role", "school_sub_role")


class ProfileUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("full_name", "phone", "city", "language_preference")

    def validate_language_preference(self, value):
        # QA R2-M13: one language per person, and only one of the five the
        # app actually ships (accounts.signals.LOCALES).
        from .signals import LOCALES

        value = (value or "").strip().lower()
        if value not in LOCALES:
            raise serializers.ValidationError(f"Unsupported locale. Allowed: {', '.join(LOCALES)}.")
        return value


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField()
    # QA R2-M17: `validators=[validate_password]` calls Django with user=None,
    # so UserAttributeSimilarityValidator had nothing to compare against and
    # "qa-r2-student-s2" passed for qa-r2-student-s2@uberip.com. The check now
    # runs in validate(), where the (still unsaved) identity is known.
    password = serializers.CharField(write_only=True)
    # First name, last name and phone are mandatory for a student account —
    # the school needs to know who is in the room and how to reach her, and
    # emails greet by first name.
    first_name = serializers.CharField(max_length=120)
    last_name = serializers.CharField(max_length=120)
    language_preference = serializers.CharField(required=False, default="en")
    phone = serializers.CharField()
    date_of_birth = serializers.DateField(required=False, allow_null=True, default=None)
    city = serializers.CharField(required=False, allow_blank=True, default="")
    country = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_email(self, value):
        value = value.lower().strip()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value

    def validate(self, attrs):
        candidate = User(
            email=attrs.get("email", ""),
            first_name=attrs.get("first_name", ""),
            last_name=attrs.get("last_name", ""),
        )
        try:
            validate_password(attrs.get("password") or "", user=candidate)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": list(exc.messages)})
        return attrs

    def validate_first_name(self, value):
        return " ".join(value.split())

    def validate_last_name(self, value):
        return " ".join(value.split())

    def validate_phone(self, value):
        if len("".join(ch for ch in value if ch.isdigit())) < 8:
            raise serializers.ValidationError("A phone number is required.")
        return value.strip()

    @transaction.atomic
    def create(self, validated_data):
        from students.models import Student

        password = validated_data.pop("password")
        user = User(
            email=validated_data["email"],
            first_name=validated_data["first_name"],
            last_name=validated_data["last_name"],
            role=Role.STUDENT,
            roles=[Role.STUDENT],
            language_preference=validated_data.get("language_preference", "en"),
            phone=validated_data.get("phone", ""),
        )
        user.set_password(password)
        user.save()
        # Self-registration always creates a student profile.
        Student.objects.create(
            user=user,
            first_name=user.first_name,
            last_name=user.last_name,
            email=user.email,
            phone=user.phone,
            language_preference=user.language_preference,
            date_of_birth=validated_data.get("date_of_birth"),
            city=validated_data.get("city", ""),
            country=validated_data.get("country", ""),
        )
        # Mirror onto the user row too, matching the pre-migration profile shape.
        user.city = validated_data.get("city", "")
        user.save(update_fields=["city"])
        return user


class TokenPairSerializer(TokenObtainPairSerializer):
    """Adds role claims and returns the user payload alongside the tokens."""

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["role"] = user.role
        token["roles"] = user.roles
        return token

    def validate(self, attrs):
        # X-R3-15: Django's ModelBackend resolves USERNAME_FIELD with an exact
        # `get(email=...)`, so "QA-R3-X-E1-STAFF@uberip.com" answered 401 for
        # a row stored lowercase — while register and invite lowercase the
        # address on the way in and password-reset looks it up with `iexact`.
        # A person who capitalises her own address on the login form simply
        # could not get in.
        #
        # Not a blind `.lower()`: `email` is a case-sensitive unique column
        # and the Supabase import copied addresses verbatim, so a mixed-case
        # row can exist. An exact match always wins; the case-insensitive
        # lookup only runs when there is none, and hands `super()` the
        # address exactly as stored.
        field = self.username_field
        raw = (attrs.get(field) or "").strip()
        if raw and not User.objects.filter(**{field: raw}).exists():
            match = User.objects.filter(email__iexact=raw).order_by("date_joined").first()
            if match is not None:
                attrs[field] = match.email

        data = super().validate(attrs)
        # R2-M19b: chi ha come unico ruolo `school` e come uniche membership
        # scuole disattivate non deve ricevere token — non esiste un solo
        # endpoint che potrebbe usare, e finora entrava e lavorava come prima.
        # Gli account multi-ruolo passano: perdere una scuola non deve
        # cancellare gli altri ruoli del RoleSwitcher.
        from .security import has_usable_access

        if not has_usable_access(self.user):
            raise AuthenticationFailed("school_deactivated", "school_deactivated")
        data["user"] = UserSerializer(self.user).data
        return data


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    # QA R2-M17: as in RegisterSerializer, a bare `validators=[validate_password]`
    # passes user=None and disables UserAttributeSimilarityValidator. The view
    # supplies the request in the serializer context.
    new_password = serializers.CharField(write_only=True)

    def validate_new_password(self, value):
        request = self.context.get("request")
        try:
            validate_password(value, user=getattr(request, "user", None))
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages))
        return value
