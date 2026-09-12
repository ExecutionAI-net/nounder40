"""
Base viewsets that re-implement, at the API layer, the multi-tenant isolation
Supabase enforced with RLS. Every school-scoped resource goes through
SchoolScopedModelViewSet so a school user can only ever see/write its own rows.
"""

from django.db import IntegrityError, transaction
from rest_framework import status, viewsets
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from accounts.models import Role
from core.params import ensure_object_body, parse_uuid


def is_hq(user) -> bool:
    return user.role == Role.HQ or Role.HQ in (user.roles or [])


def active_school_id(user):
    return user.active_school_id


def _hq_school_scope_allowed(user) -> bool:
    """R2-H2 / X-R2-03: `is_hq(user)` alone used to be treated as
    unconditional cross-school god-mode by every SchoolScopedModelViewSet
    subclass. For the /api/school/* mount point that hole is now closed one
    layer up, by core.section_guard.SchoolSectionGuardMiddleware (a narrow
    HQ role never reaches this view at all there). But SchoolScopedModelViewSet
    is also reused at other mount points the school middleware does not
    cover -- e.g. chat.views.QuickReplyTemplateViewSet under /api/chat/
    quick-replies/ -- so the same god-mode check belongs here too, not only
    in the middleware. Lazy import: core.section_guard does not import this
    module, but keeping the dependency lazy avoids any import-order surprise
    at Django app-loading time."""
    from core.section_guard import hq_school_godmode

    return hq_school_godmode(user)


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
        if is_hq(user) and _hq_school_scope_allowed(user):
            # HQ still sees across schools, but honours an explicit ?school=
            # filter (HQ panel drill-downs) or the active school when set —
            # a multi-role HQ+school account browsing the school panel must
            # see that school's rows only, not the whole network's.
            school_id = parse_uuid(self.request.query_params.get("school"), "school") or active_school_id(user)
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
            # X-R4-03: a top-level JSON array reached `.copy()`/`[key] =` here
            # and died as a 500 on every school router (packages, locations,
            # document types, quick replies...).
            data = ensure_object_body(request.data).copy()
            data[self.school_field] = school_id
            serializer = self.get_serializer(data=data)
            serializer.is_valid(raise_exception=True)
            self.perform_create(serializer)
            headers = self.get_success_headers(serializer.data)
            return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        # X-R4-06: the serializer's uniqueness check is SELECT-then-INSERT;
        # two identical creates in the same instant let one through to the
        # constraint, i.e. a 500. Here rather than in create() so the
        # subclasses with their own create() (document types...) get it too.
        try:
            with transaction.atomic():
                serializer.save()
        except IntegrityError:
            raise ValidationError({"non_field_errors": ["A row with these values already exists."]})


class CourseCostContextMixin:
    """Mette in `context["course_costs"]` i costi-credito dei corsi, con una
    query sola per richiesta.

    Serve ai serializer che traducono i crediti in lezioni (vetrina, pannello
    scuola, pacchetti dell'allieva, crediti manuali): senza il contesto quei
    campi tornerebbero vuoti. Era ricopiato in ognuna di quelle viste — quattro
    `get_serializer_context` identici, quattro occasioni di scordarne uno.
    """

    #: colonna da cui leggere la scuola sulle righe elencate
    course_cost_school_field = "school_id"

    def get_serializer_context(self):
        from catalog.services import course_cost_index

        context = super().get_serializer_context()
        if "course_costs" not in context:
            school_ids = set(
                self.filter_queryset(self.get_queryset())
                .values_list(self.course_cost_school_field, flat=True)
            )
            context["course_costs"] = course_cost_index({s for s in school_ids if s})
        return context
