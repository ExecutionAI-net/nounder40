import uuid

from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.contrib.postgres.fields import ArrayField
from django.db import models
from django.utils import timezone


class Role(models.TextChoices):
    HQ = "hq", "HQ"
    SCHOOL = "school", "School"
    TEACHER = "teacher", "Teacher"
    STUDENT = "student", "Student"


class UserManager(BaseUserManager):
    """Email-based user manager (no username field)."""

    use_in_migrations = True

    def _create_user(self, email, password, **extra_fields):
        if not email:
            raise ValueError("The email must be set")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("role", Role.HQ)
        if extra_fields.get("is_staff") is not True:
            raise ValueError("Superuser must have is_staff=True.")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_superuser=True.")
        return self._create_user(email, password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    """
    The platform's single account model — merges Supabase `auth.users` and the
    `profiles` table. One person = one primary role (`role`); `roles` carries the
    multi-role set added in migration 013.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    full_name = models.CharField(max_length=255, blank=True)  # profiles.name
    # Nome e cognome separati (per Carlo); full_name resta il display composto
    first_name = models.CharField(max_length=120, blank=True)
    last_name = models.CharField(max_length=120, blank=True)

    role = models.CharField(max_length=20, choices=Role.choices, blank=True)
    roles = ArrayField(models.CharField(max_length=20), default=list, blank=True)
    hq_sub_role = models.CharField(max_length=40, blank=True)
    school_sub_role = models.CharField(max_length=40, blank=True)

    # profiles.school_id — the ACTIVE school for a school-role user (see SchoolMembership).
    active_school = models.ForeignKey(
        "schools.School", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    language_preference = models.CharField(max_length=8, default="en")
    phone = models.CharField(max_length=40, blank=True)
    city = models.CharField(max_length=120, blank=True)

    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(default=timezone.now)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    class Meta:
        db_table = "accounts_user"

    def save(self, *args, **kwargs):
        # first/last presenti → full_name è sempre la loro composizione
        composed = f"{self.first_name} {self.last_name}".strip()
        if composed:
            self.full_name = composed
        super().save(*args, **kwargs)

    def __str__(self):
        return self.email


class HQMember(models.Model):
    """HQ team member — 1:1 with a User (hq_members.id → profiles.id)."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, primary_key=True, related_name="hq_member"
    )
    email = models.EmailField()
    name = models.CharField(max_length=255)
    sub_role = models.CharField(max_length=40, default="support")
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "hq_members"

    def __str__(self):
        return f"{self.name} ({self.sub_role})"


class HQRole(models.Model):
    """Dynamic HQ role → permission matrix (migration 032)."""

    key = models.CharField(max_length=40, primary_key=True)
    label = models.CharField(max_length=120)
    builtin = models.BooleanField(default=False)
    permissions = ArrayField(models.CharField(max_length=60), default=list, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "hq_roles"

    def __str__(self):
        return self.label


class PendingInvitation(models.Model):
    class Kind(models.TextChoices):
        HQ_MEMBER = "hq_member", "HQ member"
        SCHOOL_TEACHER = "school_teacher", "School teacher"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    type = models.CharField(max_length=20, choices=Kind.choices)
    name = models.CharField(max_length=255)
    email = models.EmailField()
    role_detail = models.CharField(max_length=60, blank=True)  # hq_sub_role for HQ members
    school = models.ForeignKey(
        "schools.School", on_delete=models.SET_NULL, null=True, blank=True, related_name="pending_invitations"
    )
    phone = models.CharField(max_length=40, blank=True)
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "pending_invitations"

    def __str__(self):
        return f"{self.email} ({self.type})"
