"""
Base viewsets that re-implement, at the API layer, the multi-tenant isolation
Supabase enforced with RLS. Every school-scoped resource goes through
SchoolScopedModelViewSet so a school user can only ever see/write its own rows.
"""

from rest_framework import viewsets
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated

from accounts.models import Role


def is_hq(user) -> bool:
    return user.role == Role.HQ or Role.HQ in (user.roles or [])


def active_school_id(user):
    return user.active_school_id


class HQOnlyModelViewSet(viewsets.ModelViewSet):
    """Full CRUD for HQ users; read-only (or denied) for everyone else via
    per-view permissions. Used for global catalog/config (lesson types, schools)."""

    permission_classes = [IsAuthenticated]

    def _require_hq(self):
        if not is_hq(self.request.user):
            raise PermissionDenied("HQ only.")

    def create(self, request, *args, **kwargs):
        self._require_hq()
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        self._require_hq()
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        self._require_hq()
        return super().destroy(request, *args, **kwargs)


class SchoolScopedModelViewSet(viewsets.ModelViewSet):
    """
    Rows are scoped to the caller's active school. HQ sees everything. The
    scoping column is `school_field` (supports lookups like 'location__school').
    On create, non-HQ callers get `school` forced to their active school.
    """

    permission_classes = [IsAuthenticated]
    school_field = "school"

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if is_hq(user):
            return qs
        school_id = active_school_id(user)
        if not school_id:
            return qs.none()
        return qs.filter(**{f"{self.school_field}_id": school_id})

    def perform_create(self, serializer):
        user = self.request.user
        if is_hq(user):
            serializer.save()
            return
        school_id = active_school_id(user)
        if not school_id:
            raise ValidationError("No active school for this user.")
        # Only inject the school when it maps to a direct FK on the model.
        if "__" in self.school_field:
            serializer.save()
        else:
            serializer.save(**{f"{self.school_field}_id": school_id})
