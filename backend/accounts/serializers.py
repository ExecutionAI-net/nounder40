from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import Role, User


class UserSerializer(serializers.ModelSerializer):
    """The 'profile' payload returned to the frontend."""

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


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, validators=[validate_password])
    full_name = serializers.CharField(required=False, allow_blank=True, default="")
    language_preference = serializers.CharField(required=False, default="en")
    phone = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_email(self, value):
        value = value.lower().strip()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value

    @transaction.atomic
    def create(self, validated_data):
        from students.models import Student

        password = validated_data.pop("password")
        user = User(
            email=validated_data["email"],
            full_name=validated_data.get("full_name", ""),
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
            name=user.full_name,
            email=user.email,
            phone=user.phone,
            language_preference=user.language_preference,
        )
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
        data = super().validate(attrs)
        data["user"] = UserSerializer(self.user).data
        return data


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, validators=[validate_password])
