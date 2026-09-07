from datetime import timedelta

from django.db.models import Case, Count, IntegerField, When
from django.utils import timezone
from django.utils.text import slugify
from rest_framework import generics, status
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.viewsets import HQOnlyModelViewSet, SchoolScopedModelViewSet, is_hq

from .models import (
    School,
    SchoolClosure,
    SchoolDocumentType,
    SchoolLocation,
    SchoolMembership,
    SchoolRole,
    SchoolRoom,
    SchoolStudent,
)
from .serializers import (
    PublicSchoolSerializer,
    SchoolClosureSerializer,
    SchoolDocumentTypeSerializer,
    SchoolLocationSerializer,
    SchoolRoleSerializer,
    SchoolRoomSerializer,
    SchoolSerializer,
)


def notify_hq_new_school(school) -> None:
    """HQ > Emails "hq.new_school_registered": every active HQ member, each in
    their own language. Queued on commit like every other email."""
    from django.conf import settings
    from django.db import transaction

    from accounts.models import HQMember
    from notifications.tasks import send_transactional_email_task

    members = list(HQMember.objects.filter(active=True).select_related("user"))

    def _send():
        for member in members:
            locale = getattr(member.user, "language_preference", "") or "en"
            send_transactional_email_task.delay(
                to_email=member.email or member.user.email, to_name=member.name, key="hq.new_school_registered",
                context={
                    "school_name": school.name, "school_city": school.city, "school_email": school.email,
                    "school_url": f"{settings.FRONTEND_URL}/{locale}/hq/schools",
                },
                locale=locale,
            )

    transaction.on_commit(_send)


class PublicSchoolsView(generics.ListAPIView):
    """Active schools, public (booking/browse). Filter with ?city= ?country=."""

    permission_classes = [AllowAny]
    serializer_class = PublicSchoolSerializer

    def get_queryset(self):
        qs = School.objects.filter(active=True).order_by("name")
        p = self.request.query_params
        if p.get("city"):
            qs = qs.filter(city__iexact=p["city"])
        if p.get("country"):
            qs = qs.filter(country__iexact=p["country"])
        return qs


class SchoolViewSet(HQOnlyModelViewSet):
    """HQ manages every school; a school user can read their own."""

    queryset = School.objects.all().order_by("name")
    serializer_class = SchoolSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["active", "city", "country"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if is_hq(user):
            return qs
        return qs.filter(id=user.active_school_id)

    @action(detail=True, methods=["post"])
    def activate(self, request, pk=None):
        self._require_hq()
        school = self.get_object()
        school.active = True
        school.save(update_fields=["active"])
        return Response(self.get_serializer(school).data)

    @action(detail=True, methods=["post"])
    def deactivate(self, request, pk=None):
        self._require_hq()
        school = self.get_object()
        school.active = False
        school.save(update_fields=["active"])
        # R2-M19b: spegnere la scuola deve spegnere anche le sessioni dei suoi
        # membri. Il guard di sezione (core.section_guard) chiude subito
        # /api/school/* rileggendo School.active; qui si invalidano i refresh
        # token cosi' nessuno si rinnova la sessione per giorni. Ruoli e
        # membership restano intatti: alla riattivazione torna tutto.
        from accounts.security import lock_out_school_members

        lock_out_school_members(school)
        return Response(self.get_serializer(school).data)

    def create(self, request, *args, **kwargs):
        self._require_hq()
        data = request.data.copy()
        data.setdefault("active", True)
        free_trial_days = data.pop("free_trial_days", None)
        if isinstance(free_trial_days, list):
            free_trial_days = free_trial_days[0] if free_trial_days else None
        if free_trial_days:
            try:
                days = int(free_trial_days)
            except (TypeError, ValueError):
                days = 0
            if days > 0:
                data["free_trial_ends_at"] = (timezone.now() + timedelta(days=days)).isoformat()
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        notify_hq_new_school(serializer.instance)
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        if not is_hq(request.user):
            return response
        rows = response.data
        counts = _school_counts([row["id"] for row in rows])
        # Sedi fisiche per scuola (pagina HQ "Città, Scuole e Sedi")
        loc_map: dict[str, list] = {}
        for loc in SchoolLocation.objects.filter(school_id__in=[row["id"] for row in rows]).order_by("name"):
            loc_map.setdefault(str(loc.school_id), []).append(
                {"id": str(loc.id), "name": loc.name, "address": loc.address}
            )
        for row in rows:
            row.update(counts.get(row["id"], {"teacherCount": 0, "studentCount": 0, "activeLessonCount": 0}))
            row["locations"] = loc_map.get(row["id"], [])
        return response

    def retrieve(self, request, *args, **kwargs):
        response = super().retrieve(request, *args, **kwargs)
        if is_hq(request.user):
            counts = _school_counts([response.data["id"]])
            response.data.update(
                counts.get(response.data["id"], {"teacherCount": 0, "studentCount": 0, "activeLessonCount": 0})
            )
        return response

    @action(detail=True, methods=["get"])
    def linked(self, request, pk=None):
        self._require_hq()
        school = self.get_object()
        return Response(_linked_records(school))

    @action(detail=True, methods=["post"], url_path="resend-invite")
    def resend_invite(self, request, pk=None):
        self._require_hq()
        school = self.get_object()

        from accounts.models import Role, User

        locale = _school_invite_locale(request.data.get("locale"), school)

        user = User.objects.filter(email__iexact=school.email).first()
        if user is None:
            user = User(
                email=school.email, full_name=f"{school.name} Admin", role=Role.SCHOOL, roles=[Role.SCHOOL],
                language_preference=locale,
            )
            user.set_unusable_password()
            user.active_school_id = school.id
            user.save()
        else:
            update_fields = []
            if not user.active_school_id:
                user.active_school_id = school.id
                update_fields.append("active_school")
            if Role.SCHOOL not in (user.roles or []):
                user.roles = [*(user.roles or []), Role.SCHOOL]
                update_fields.append("roles")
            if update_fields:
                user.save(update_fields=update_fields)

        # QA SCH-R2-07 / R2-M4: il primo account della scuola nasceva `admin`
        # e nessun endpoint HQ assegnava mai `owner` — risultato: la scuola non
        # poteva avere un titolare, `only_owner_assigns_owner` bloccava tutti e
        # un admin qualsiasi poteva declassare o cacciare il fondatore.
        # Il primo membro della scuola e' il titolare; se una membership c'e'
        # gia' e la scuola non ha ancora nessun titolare, viene promossa.
        membership, created = SchoolMembership.objects.get_or_create(
            profile=user, school=school, defaults={"sub_role": "owner"}
        )
        if (
            not created
            and membership.sub_role != "owner"
            and not SchoolMembership.objects.filter(school=school, sub_role="owner").exists()
        ):
            membership.sub_role = "owner"
            membership.save(update_fields=["sub_role"])
        if school.owner_id is None:
            school.owner = user
            school.save(update_fields=["owner"])

        email_sent = _send_school_team_invite_email(user, locale=locale, school=school, sub_role=membership.sub_role)
        return Response({"success": True, "email_sent": email_sent})

    def destroy(self, request, *args, **kwargs):
        self._require_hq()
        school = self.get_object()
        linked = _linked_records(school)
        if linked["blocking"]["transactions"] > 0 or linked["blocking"]["shopOrders"] > 0:
            return Response({"error": "has_financial_records", "linked": linked}, status=status.HTTP_409_CONFLICT)

        from accounts.models import Role, User

        member_ids = list(SchoolMembership.objects.filter(school=school).values_list("profile_id", flat=True).distinct())
        school.delete()

        for user_id in member_ids:
            user = User.objects.filter(pk=user_id).first()
            if user is None:
                continue
            still_has_schools = SchoolMembership.objects.filter(profile=user).exists()
            other_roles = [r for r in (user.roles or []) if r != Role.SCHOOL]
            if not still_has_schools and not other_roles:
                user.delete()

        return Response({"ok": True, "linked": linked})


def _school_counts(school_ids):
    """{school_id: {teacherCount, studentCount, activeLessonCount}} for the
    HQ schools list/detail KPI columns."""
    from catalog.models import Lesson
    from teachers.models import TeacherSchool

    today = timezone.now().date()
    t_map = {
        str(r["school_id"]): r["n"]
        for r in TeacherSchool.objects.filter(school_id__in=school_ids, active=True)
        .values("school_id").annotate(n=Count("id"))
    }
    s_map = {
        str(r["school_id"]): r["n"]
        for r in SchoolStudent.objects.filter(school_id__in=school_ids)
        .values("school_id").annotate(n=Count("id"))
    }
    l_map = {
        str(r["school_id"]): r["n"]
        for r in Lesson.objects.filter(school_id__in=school_ids, status="scheduled", date__gte=today)
        .values("school_id").annotate(n=Count("id"))
    }
    return {
        sid: {
            "teacherCount": t_map.get(sid, 0),
            "studentCount": s_map.get(sid, 0),
            "activeLessonCount": l_map.get(sid, 0),
        }
        for sid in school_ids
    }


def _linked_records(school):
    """Cascading records are deleted/detached automatically and shown to the
    caller before confirming; blocking ones (financial history) prevent
    deletion outright."""
    from catalog.models import Course, Lesson
    from commerce.models import ShopOrder, Transaction
    from teachers.models import TeacherSchool

    return {
        "cascading": {
            "students": SchoolStudent.objects.filter(school=school).count(),
            "teachers": TeacherSchool.objects.filter(school=school).count(),
            "courses": Course.objects.filter(school=school).count(),
            "lessons": Lesson.objects.filter(school=school).count(),
        },
        "blocking": {
            "transactions": Transaction.objects.filter(school=school).count(),
            "shopOrders": ShopOrder.objects.filter(school=school).count(),
        },
    }


class SchoolLocationViewSet(SchoolScopedModelViewSet):
    queryset = SchoolLocation.objects.all()
    serializer_class = SchoolLocationSerializer
    filterset_fields = ["school"]


class SchoolRoomViewSet(SchoolScopedModelViewSet):
    queryset = SchoolRoom.objects.select_related("location").all()
    serializer_class = SchoolRoomSerializer
    school_field = "location__school"


class SchoolClosureViewSet(SchoolScopedModelViewSet):
    queryset = SchoolClosure.objects.all()
    serializer_class = SchoolClosureSerializer


class SchoolDocumentTypeViewSet(SchoolScopedModelViewSet):
    queryset = SchoolDocumentType.objects.all().order_by("sort_order")
    serializer_class = SchoolDocumentTypeSerializer

    def create(self, request, *args, **kwargs):
        """The frontend only collects a display name — derive `code` (a
        required, school-unique slug) from it when the caller doesn't
        supply one. Injects both school and code into a copied payload
        before validation, same reasoning as SchoolScopedModelViewSet's own
        create() override: the UniqueConstraint on (school, code) makes
        both fields implicitly required by DRF's validator."""
        school_id = request.user.active_school_id
        data = request.data.copy()
        data["school"] = school_id
        if not data.get("code"):
            base = slugify(data.get("name", "")) or "document"
            code, i = base, 1
            while SchoolDocumentType.objects.filter(school_id=school_id, code=code).exists():
                i += 1
                code = f"{base}-{i}"
            data["code"] = code
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def destroy(self, request, *args, **kwargs):
        """A type already referenced by student documents is deactivated
        instead of deleted (type_ref is SET_NULL, so a hard delete would
        silently strip the type off every document that used it)."""
        from students.models import StudentDocument

        doc_type = self.get_object()
        doc_count = StudentDocument.objects.filter(type_ref=doc_type).count()
        if doc_count:
            doc_type.active = False
            doc_type.save(update_fields=["active"])
            return Response({"deactivated": True, "documents": doc_count})
        doc_type.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class SchoolMembershipsView(APIView):
    """GET/POST /api/school/memberships/ — list this user's school memberships
    and the currently active one; POST switches the active school."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        memberships = SchoolMembership.objects.filter(profile=request.user).select_related("school")
        return Response({
            "memberships": [
                {
                    "school_id": str(m.school_id),
                    "sub_role": m.sub_role,
                    "school": {"id": str(m.school_id), "name": m.school.name, "city": m.school.city},
                }
                for m in memberships
            ],
            "activeSchoolId": str(request.user.active_school_id) if request.user.active_school_id else None,
        })

    def post(self, request):
        school_id = request.data.get("school_id")
        if not SchoolMembership.objects.filter(profile=request.user, school_id=school_id).exists():
            return Response({"error": "not_a_member"}, status=403)
        request.user.active_school_id = school_id
        request.user.save(update_fields=["active_school"])
        return Response({"activeSchoolId": school_id})


class SchoolDocumentTypesPublicView(generics.ListAPIView):
    """GET /api/schools/<school_id>/document-types/ — public (any authenticated
    or anonymous visitor can see what a school requires before enrolling),
    matching the original RLS policy `USING (true)`."""

    permission_classes = [AllowAny]
    serializer_class = SchoolDocumentTypeSerializer

    def get_queryset(self):
        return SchoolDocumentType.objects.filter(school_id=self.kwargs["school_id"], active=True).order_by("sort_order")


# Campi del form "Settings" (soglia cancellazione, notice booking, toggle
# vari): chiunque abbia una membership può leggerli (GET, sotto), ma solo chi
# ha il permesso 'settings' (o è owner) può modificarli via PATCH.
_SCHOOL_SETTINGS_FIELDS = {
    "cancellation_policy_hours", "min_booking_notice_hours", "free_first_lesson",
    "show_teacher_to_students", "block_booking_on_documents", "language",
}
# Mai scrivibili da /school/profile/, qualunque sia il ruolo: infrastruttura
# HQ/Stripe (attivazione, commissioni piattaforma, onboarding, slug...).
_SCHOOL_HQ_ONLY_FIELDS = {
    "id", "slug", "active", "owner", "platform_fee_percentage", "shop_commission_percentage",
    "stripe_account_id", "stripe_onboarding_complete", "grace_period_days", "free_trial_ends_at",
    "ical_token", "created_at", "updated_at",
}
# QA H-7: the school's identity fields (name/contact/address/branding) fell
# through both allow-lists above with zero permission check -- any member,
# `staff` with no `settings` permission included, could rewrite them. They
# are ordinary "Profile" data (not booking policy, not HQ/Stripe infra), but
# writing them is still an account-identity change, so they're gated behind
# the same 'settings' permission as _SCHOOL_SETTINGS_FIELDS rather than left
# open to anyone with a membership.
_SCHOOL_IDENTITY_FIELDS = {
    "name", "email", "phone", "address", "address_line2", "city", "province",
    "country", "vat_number", "website", "logo_url",
}
# QA L-1 (companion to H-7): GET returned these to every member regardless of
# permission -- Stripe account id and the platform's fee cut are HQ/owner-tier
# billing info, not used anywhere in the school panel's own pages (only the
# HQ schools admin reads them, through a separate HQ-only endpoint).
_SCHOOL_SETTINGS_ONLY_READ_FIELDS = {
    "stripe_account_id", "platform_fee_percentage", "shop_commission_percentage",
    "stripe_onboarding_complete",
}


class SchoolProfileView(APIView):
    """GET/PATCH /api/school/profile/ — the caller's own school record
    (self-service, unlike SchoolViewSet which is HQ-only). Powers both the
    Profile page (name/contact/address, open to every school member — it's
    not in `SECTION_PATHS`/the role matrix, see `SchoolLayout.tsx`) and the
    Settings page (booking policy toggles, gated behind the 'settings'
    permission) — same underlying School row, different field subsets.

    The `profile` URL segment is deliberately absent from
    `core.section_guard.SECTION_BY_SEGMENT` (GET must stay open to every
    member), but that left every PATCH here completely unchecked: a `staff`
    member with no `settings` permission could rewrite *any* School field,
    Stripe/platform-fee/activation included (QA report, Critical #4). The
    field split below is the guard that segment intentionally doesn't
    provide."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        school = School.objects.filter(pk=request.user.active_school_id).first()
        if school is None:
            return Response({"error": "no_active_school"}, status=400)
        return Response(self._readable(SchoolSerializer(school).data, request.user, school))

    def patch(self, request):
        school = School.objects.filter(pk=request.user.active_school_id).first()
        if school is None:
            return Response({"error": "no_active_school"}, status=400)

        requested_fields = set(request.data.keys())
        if requested_fields & _SCHOOL_HQ_ONLY_FIELDS:
            return Response({"error": "forbidden", "fields": sorted(requested_fields & _SCHOOL_HQ_ONLY_FIELDS)}, status=403)

        # Settings-tier and identity fields share the same gate: only a
        # caller with the 'settings' permission (or the owner) may write
        # either group. Checked together so one 403 covers both.
        permission_gated_fields = requested_fields & (_SCHOOL_SETTINGS_FIELDS | _SCHOOL_IDENTITY_FIELDS)
        if permission_gated_fields and not self._caller_has_settings_permission(request.user, school):
            return Response({"error": "forbidden", "fields": sorted(permission_gated_fields)}, status=403)

        serializer = SchoolSerializer(school, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        # R2-L11a: la risposta della PATCH e' una lettura come un'altra e
        # passa dallo stesso filtro della GET. Prima tornava il record
        # completo, quindi un `staff` che non poteva VEDERE i campi
        # Stripe/fee se li faceva stampare da una `PATCH {}`.
        return Response(self._readable(serializer.data, request.user, school))

    def _readable(self, data, user, school):
        """Unico punto in cui si decide cosa il chiamante puo' LEGGERE di
        School: usato sia dalla GET sia dalla risposta della PATCH."""
        if not self._caller_has_settings_permission(user, school):
            for field in _SCHOOL_SETTINGS_ONLY_READ_FIELDS:
                data.pop(field, None)
        return data

    @staticmethod
    def _caller_has_settings_permission(user, school):
        membership = SchoolMembership.objects.filter(profile=user, school=school).only("sub_role").first()
        sub_role = membership.sub_role if membership else (user.school_sub_role or "")
        if sub_role == "owner":
            return True
        role = SchoolRole.objects.filter(key=sub_role).only("permissions").first()
        return bool(role and "settings" in role.permissions)


_LOCALES = ("en", "it", "es", "fr", "de")


def _school_invite_locale(explicit_locale, school):
    """Resolve the locale for a school-team invite: an explicit UI locale
    from the request wins, otherwise the school's own configured language
    (School.language), otherwise English. Mirrors the fallback shape of
    teachers.views._send_teacher_invite_email, adapted since a school-team
    invite doesn't have a per-teacher saved preference to start from."""
    if explicit_locale in _LOCALES:
        return explicit_locale
    school_language = getattr(school, "language", None)
    if school_language in _LOCALES:
        return school_language
    return "en"


def _invite_org_and_role(user, school, sub_role, locale):
    """R2-M20a: quale scuola e quale ruolo nominare nell'invito.

    Se il chiamante non li passa si risalgono dalla membership (una sola,
    quella appena creata, nel 99% dei casi); l'etichetta del ruolo viene
    sempre dalla matrice `SchoolRole`, mai da una lista scritta a mano.
    """
    from notifications.invites import invite_context, school_role_label

    membership = None
    if school is None or not sub_role:
        qs = SchoolMembership.objects.filter(profile=user).select_related("school")
        if school is not None:
            qs = qs.filter(school=school)
        membership = qs.order_by("created_at").first()
    if school is None and membership is not None:
        school = membership.school
    if not sub_role and membership is not None:
        sub_role = membership.sub_role
    return invite_context(
        org_name=getattr(school, "name", "") or "",
        role_label=school_role_label(sub_role or "", locale),
        locale=locale,
    )


def _send_school_team_invite_email(user, locale=None, school=None, sub_role=None) -> bool:
    """Same shape as accounts.hq_views._send_invite_email / teachers.views'
    equivalent — the invited team member sets their password via the
    generic /api/auth/complete-invite/ flow.

    QA R2-H15: returns whether the email will actually be sent, so the
    three callers below can report it honestly instead of unconditionally
    claiming success -- "team_invite" being switched off in HQ > Emails
    used to silently drop every school owner/team invite while the API
    still answered {"success": true} / {"sent": true}."""
    from notifications.emails import is_enabled

    email_sent = is_enabled("team_invite")

    from django.conf import settings
    from django.contrib.auth.tokens import default_token_generator
    from django.db import transaction
    from django.utils.encoding import force_bytes
    from django.utils.http import urlsafe_base64_encode

    from notifications.tasks import send_transactional_email_task

    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    # Email and setup page in the invite's language (the locale prefix keeps
    # the i18n middleware from falling back to English on the page) — falls
    # back to the user's own saved preference when no locale was resolved by
    # the caller, then English.
    if locale not in _LOCALES:
        locale = user.language_preference if user.language_preference in _LOCALES else "en"
    setup_url = f"{settings.FRONTEND_URL}/{locale}/setup-account?uid={uid}&token={token}"
    org_role = _invite_org_and_role(user, school, sub_role, locale)
    transaction.on_commit(
        lambda: send_transactional_email_task.delay(
            to_email=user.email, to_name=user.full_name, key="team_invite",
            context={
                "user_name": user.full_name or user.email, "user_first_name": user.first_name_display,
                "setup_url": setup_url, "platform_name": "No Under 40", **org_role,
            },
            locale=locale,
        )
    )
    return email_sent


class SchoolTeamView(APIView):
    """GET/POST/DELETE /api/school/team/ — the school's own staff roster
    (spec 6.3-style, school-side): owner/admin/staff sub-roles. A member is
    "pending" as long as their account still has an unusable password (the
    same signal used for teacher invites) — no separate approval queue."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        school_id = request.user.active_school_id
        memberships = SchoolMembership.objects.filter(school_id=school_id).select_related("profile").order_by("created_at")
        active, pending = [], []
        for m in memberships:
            row = {
                "id": str(m.id), "name": m.profile.full_name or m.profile.email, "email": m.profile.email,
                "first_name": m.profile.first_name, "last_name": m.profile.last_name,
                "phone": m.profile.phone, "created_at": m.created_at,
            }
            if m.profile.has_usable_password():
                active.append({**row, "school_sub_role": m.sub_role})
            else:
                pending.append({**row, "role_detail": m.sub_role})
        return Response({"active": active, "pending": pending})

    def post(self, request):
        from accounts.models import Role, User

        school_id = request.user.active_school_id
        if not school_id:
            return Response({"error": "no_active_school"}, status=400)

        email = (request.data.get("email") or "").strip().lower()
        name = (request.data.get("name") or "").strip()
        sub_role = request.data.get("school_sub_role") or "staff"
        if not email or not name:
            return Response({"error": "Email and name are required"}, status=400)

        if sub_role == "owner" and self._caller_role(request, school_id) != "owner":
            # Stessa regola della patch: nominare un titolare può farlo solo
            # il titolare, anche invitando un membro nuovo (no auto-promozione).
            return Response({"error": "only_owner_assigns_owner"}, status=403)

        # R2-M3: unlike .patch() below, this endpoint never validated
        # school_sub_role against the school's real role matrix -- a nonsense
        # value like "godmode" was stored as-is on the new SchoolMembership.
        # core/section_guard.py's SchoolSectionGuardMiddleware fails a role
        # it can't find in the matrix *open* (no restriction at all), so an
        # invented sub_role ended up with more access than any real one.
        # Reuse the same allow-list .patch() already checks.
        allowed_roles = {"owner", "admin", "staff"} | set(SchoolRole.objects.values_list("key", flat=True))
        if sub_role not in allowed_roles:
            return Response({"error": "invalid_school_sub_role"}, status=400)

        school = School.objects.filter(pk=school_id).only("id", "language").first()
        locale = _school_invite_locale(request.data.get("locale"), school)

        user = User.objects.filter(email__iexact=email).first()
        existing = user is not None
        if user is None:
            user = User(
                email=email, full_name=name, role=Role.SCHOOL, roles=[Role.SCHOOL], language_preference=locale,
            )
            user.set_unusable_password()
            user.active_school_id = school_id
            user.save()
        else:
            # Account esistente (allieva, insegnante...): senza "school" nei
            # ruoli il guard frontend lo rimanda alla sua dashboard e non
            # entra mai nel pannello scuola
            changed = []
            if Role.SCHOOL not in (user.roles or []):
                user.roles = [*(user.roles or []), Role.SCHOOL]
                changed.append("roles")
            if not user.active_school_id:
                user.active_school_id = school_id
                changed.append("active_school")
            if changed:
                user.save(update_fields=changed)

        membership, created = SchoolMembership.objects.get_or_create(
            profile=user, school_id=school_id, defaults={"sub_role": sub_role}
        )
        if not created:
            return Response({"error": "already_a_member"}, status=400)

        email_sent = False
        if not user.has_usable_password():
            email_sent = _send_school_team_invite_email(
                user, locale=locale, school=membership.school, sub_role=membership.sub_role
            )

        return Response({"id": str(membership.id), "existing": existing, "email_sent": email_sent}, status=201)

    def patch(self, request):
        """Edit a member: name (first/last), email, phone, sub_role.
        Owner edits everyone; admin everyone except the owner."""
        from accounts.models import User

        school_id = request.user.active_school_id
        membership = (
            SchoolMembership.objects.filter(pk=request.data.get("id"), school_id=school_id)
            .select_related("profile").first()
        )
        if membership is None:
            return Response({"error": "not_found"}, status=404)

        caller_role = self._caller_role(request, school_id)
        if caller_role not in ("owner", "admin"):
            return Response({"error": "forbidden"}, status=403)
        if self._is_owner_membership(membership, school_id) and caller_role != "owner":
            return Response({"error": "forbidden"}, status=403)

        user = membership.profile
        new_email = (request.data.get("email") or "").strip().lower()
        if new_email and new_email != user.email.lower():
            # L'email è la login di un account che può appartenere ad altre
            # scuole o ruoli: modificabile solo se vive in questa sola scuola
            shared = (
                SchoolMembership.objects.filter(profile=user).exclude(school_id=school_id).exists()
                or any(r != "school" for r in (user.roles or []))
            )
            if shared:
                return Response({"error": "email_not_editable_shared_account"}, status=400)
            if User.objects.filter(email__iexact=new_email).exclude(pk=user.pk).exists():
                return Response({"error": "email_taken"}, status=400)
            user.email = new_email
        if "first_name" in request.data:
            user.first_name = (request.data.get("first_name") or "").strip()
        if "last_name" in request.data:
            user.last_name = (request.data.get("last_name") or "").strip()
        if "name" in request.data and "first_name" not in request.data:
            # Nome intero → va nei campi separati, altrimenti save() lo
            # ricomporrebbe dai vecchi first/last annullando la modifica
            head, _, rest = (request.data.get("name") or "").strip().partition(" ")
            user.first_name, user.last_name = head, rest
        if "phone" in request.data:
            user.phone = request.data.get("phone") or ""
        user.save()

        new_role = request.data.get("school_sub_role")
        allowed_roles = {"owner", "admin", "staff"} | set(
            SchoolRole.objects.values_list("key", flat=True)
        )
        if new_role in allowed_roles and not self._is_owner_membership(membership, school_id):
            # Nominare un titolare può farlo solo il titolare (no auto-promozione)
            if new_role == "owner" and caller_role != "owner":
                return Response({"error": "only_owner_assigns_owner"}, status=403)
            membership.sub_role = new_role
            membership.save(update_fields=["sub_role"])

        return Response({
            "id": str(membership.id), "name": user.full_name, "email": user.email,
            "phone": user.phone, "school_sub_role": membership.sub_role,
        })

    def _caller_role(self, request, school_id):
        caller = SchoolMembership.objects.filter(profile=request.user, school_id=school_id).first()
        return caller.sub_role if caller else request.user.school_sub_role

    @staticmethod
    def _is_owner_membership(membership, school_id):
        """QA SCH-R2-07 / R2-M4: il fondatore era protetto solo se la sua
        membership aveva la stringa `sub_role == "owner"`. Nelle scuole create
        da HQ non l'aveva mai, quindi un admin poteva declassarlo o cacciarlo.
        Ora conta anche l'account che e' `School.owner`."""
        if membership.sub_role == "owner":
            return True
        return School.objects.filter(pk=school_id, owner_id=membership.profile_id).exists()

    def delete(self, request):
        """Stesse regole della patch: modificare e cacciare qualcuno sono la
        stessa autorità. Qui non c'era alcun controllo — chiunque della scuola
        poteva togliere chiunque altro, titolare compreso, e da quando la
        membership è la porta (core/section_guard.py) quella DELETE revoca
        l'accesso sul serio invece di lasciare una riga in meno."""
        school_id = request.user.active_school_id
        membership = SchoolMembership.objects.filter(pk=request.data.get("id"), school_id=school_id).first()
        if membership is None:
            return Response({"error": "not_found"}, status=404)

        caller_role = self._caller_role(request, school_id)
        if caller_role not in ("owner", "admin"):
            return Response({"error": "forbidden"}, status=403)
        if self._is_owner_membership(membership, school_id) and caller_role != "owner":
            return Response({"error": "forbidden"}, status=403)
        if membership.profile_id == request.user.pk:
            # Togliersi da soli ora significa perdere ruolo e scuola attiva:
            # un titolare che lo facesse chiuderebbe fuori se stesso, e con
            # sé la gestione del team.
            return Response({"error": "cannot_remove_self"}, status=400)

        membership.delete()
        return Response(status=204)


class SchoolTeamResendInviteView(APIView):
    """POST /api/school/team/resend/ — {id: SchoolMembership id}."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        school_id = request.user.active_school_id
        membership = (
            SchoolMembership.objects.filter(pk=request.data.get("id"), school_id=school_id)
            .select_related("profile", "school").first()
        )
        if membership is None:
            return Response({"error": "not_found"}, status=404)
        locale = _school_invite_locale(
            request.data.get("locale") or membership.profile.language_preference, membership.school
        )
        email_sent = _send_school_team_invite_email(
            membership.profile, locale=locale, school=membership.school, sub_role=membership.sub_role
        )
        return Response({"sent": email_sent})


class HQSchoolRoleViewSet(HQOnlyModelViewSet):
    """Matrice ruolo scuola → permessi: SOLO HQ scrive (gestione accentrata,
    per Carlo). Le scuole leggono la stessa matrice da /school/permissions/."""

    # Ordine fisso: Titolare, Amministratore, Staff, poi i personalizzati
    queryset = SchoolRole.objects.annotate(
        _ord=Case(
            When(key="owner", then=0),
            When(key="admin", then=1),
            When(key="staff", then=2),
            default=3,
            output_field=IntegerField(),
        )
    ).order_by("_ord", "created_at")
    serializer_class = SchoolRoleSerializer

    def create(self, request, *args, **kwargs):
        # La guardia del parent vive dentro il suo create(): qui va richiamata
        self._require_hq()
        data = request.data.copy()
        if not data.get("key"):
            base = slugify(data.get("label", "")) or "role"
            key, i = base, 1
            while SchoolRole.objects.filter(key=key).exists():
                i += 1
                key = f"{base}-{i}"
            data["key"] = key
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        # key è la PK (un cambio farebbe un INSERT duplicato) e builtin
        # protegge i ruoli seed: mai modificabili via API
        if hasattr(request.data, "_mutable"):
            request.data._mutable = True
        request.data.pop("key", None)
        request.data.pop("builtin", None)
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        role = self.get_object()
        if role.builtin:
            return Response({"error": "builtin roles cannot be deleted"}, status=status.HTTP_400_BAD_REQUEST)
        count = SchoolMembership.objects.filter(sub_role=role.key).count()
        if count > 0:
            return Response({"error": "role_in_use", "count": count}, status=status.HTTP_400_BAD_REQUEST)
        return super().destroy(request, *args, **kwargs)


class SchoolPermissionsView(APIView):
    """GET /api/school/permissions/ — lettura della matrice ruoli scuola:
    alimenta la nav del pannello scuola e la legenda in Team."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        # Solo chiave/etichetta/permessi: il conteggio membri di rete
        # (memberCount) è un dato HQ, non va esposto alle scuole
        return Response([
            {"key": r.key, "label": r.label, "permissions": list(r.permissions)}
            for r in HQSchoolRoleViewSet.queryset.all()
        ])
