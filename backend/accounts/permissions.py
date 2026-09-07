"""
Role-based DRF permissions. These are the building blocks the Phase 3 API uses
to re-implement what Supabase RLS enforced at the database level.
"""

from rest_framework.permissions import BasePermission

from .models import Role


class _RolePermission(BasePermission):
    role: str = ""

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        return user.role == self.role or self.role in (user.roles or [])


class IsHQ(_RolePermission):
    role = Role.HQ


class IsSchool(_RolePermission):
    role = Role.SCHOOL


class IsTeacher(_RolePermission):
    role = Role.TEACHER


class IsStudent(_RolePermission):
    role = Role.STUDENT


class IsHQOrDjangoStaff(BasePermission):
    """R2-L5a: the OpenAPI schema and the Swagger UI (`/api/schema/`,
    `/api/docs/`) were served to anonymous callers, publishing the whole API
    surface — every route, parameter and serializer shape — to anyone who
    could reach the host. They are a developer tool, not a product surface,
    so they are gated to HQ (the platform's own operators). Django
    staff/superusers pass too: that is the account a developer already has
    on `/admin/`, and it keeps the Swagger UI openable in a browser through
    the admin session (the JWT lives in localStorage and an `<iframe>`-less
    page load carries no Authorization header)."""

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if user.is_staff or user.is_superuser:
            return True
        return user.role == Role.HQ or Role.HQ in (user.roles or [])


class IsHQOrSchool(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        allowed = {Role.HQ, Role.SCHOOL}
        return user.role in allowed or bool(allowed.intersection(user.roles or []))
