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


class IsHQOrSchool(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        allowed = {Role.HQ, Role.SCHOOL}
        return user.role in allowed or bool(allowed.intersection(user.roles or []))
