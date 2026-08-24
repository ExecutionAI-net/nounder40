"""
Base viewsets that re-implement, at the API layer, the multi-tenant isolation
Supabase enforced with RLS. Every school-scoped resource goes through
SchoolScopedModelViewSet so a school user can only ever see/write its own rows.
"""

from rest_framework import status, viewsets
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from accounts.models import Role


def is_hq(user) -> bool:
    return user.role == Role.HQ or Role.HQ in (user.roles or [])


def active_school_id(user):
    return user.active_school_id


class HQOnlyModelViewSet(viewsets.ModelViewSet):
    """HQ-only CRUD for global catalog/config (packages, shop, schools…).

    Reads are HQ-only too: for a long time only the writes were guarded, so
    any logged-in user — a student included — could list HQ's rows (verified
    on /api/hq/packages/ and /api/hq/discount-codes/, where the whole point of
    a promo code is that it stays private).

    A subclass that is genuinely shared sets `hq_reads_only = False`: today
    only the lesson-type catalogue, which the school panel reads from its own
    /api/school/lesson-types/ route (same viewset, two mount points).
    """

    permission_classes = [IsAuthenticated]
    hq_reads_only = True

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if self.hq_reads_only:
            self._require_hq()

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
            # HQ still sees across schools, but honours an explicit ?school=
            # filter (HQ panel drill-downs) or the active school when set —
            # a multi-role HQ+school account browsing the school panel must
            # see that school's rows only, not the whole network's.
            school_id = self.request.query_params.get("school") or active_school_id(user)
            if school_id:
                return qs.filter(**{f"{self.school_field}_id": school_id})
            return qs
        school_id = active_school_id(user)
        if not school_id:
            return qs.none()
        return qs.filter(**{f"{self.school_field}_id": school_id})

    def create(self, request, *args, **kwargs):
        """
        Inject the caller's school into the payload BEFORE validation, not
        after. Serializers for models with a UniqueConstraint that includes
        `school` (e.g. school+code) get an implicit UniqueTogetherValidator
        that requires every constrained field to be present in the input data
        regardless of the field's own `required=False` — so injecting the
        school only in perform_create() (which runs after is_valid()) made
        those creates fail with a spurious "this field is required".
        """
        user = self.request.user
        if "__" not in self.school_field:
            # School routes create for the caller's active school, ALWAYS —
            # HQ role included (a multi-role account creating from the school
            # panel used to save rows with school=NULL, an HQ-owned orphan
            # that the scoped list then hid).
            school_id = active_school_id(user)
            if not school_id:
                raise ValidationError("No active school for this user.")
            data = request.data.copy()
            data[self.school_field] = school_id
            serializer = self.get_serializer(data=data)
            serializer.is_valid(raise_exception=True)
            self.perform_create(serializer)
            headers = self.get_success_headers(serializer.data)
            return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        serializer.save()
