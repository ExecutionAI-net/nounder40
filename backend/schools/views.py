from datetime import timedelta

from django.db.models import Count
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
    SchoolRoom,
    SchoolStudent,
)
from .serializers import (
    PublicSchoolSerializer,
    SchoolClosureSerializer,
    SchoolDocumentTypeSerializer,
    SchoolLocationSerializer,
    SchoolRoomSerializer,
    SchoolSerializer,
)


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

        user = User.objects.filter(email__iexact=school.email).first()
        if user is None:
            user = User(email=school.email, full_name=f"{school.name} Admin", role=Role.SCHOOL, roles=[Role.SCHOOL])
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

        SchoolMembership.objects.get_or_create(profile=user, school=school, defaults={"sub_role": "admin"})
        if school.owner_id is None:
            school.owner = user
            school.save(update_fields=["owner"])

        _send_school_team_invite_email(user)
        return Response({"success": True})

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


class SchoolProfileView(APIView):
    """GET/PATCH /api/school/profile/ — the caller's own school record
    (self-service, unlike SchoolViewSet which is HQ-only). Powers both the
    Profile page (name/contact/address) and the Settings page (booking
    policy toggles) — same underlying School row, different field subsets."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        school = School.objects.filter(pk=request.user.active_school_id).first()
        if school is None:
            return Response({"error": "no_active_school"}, status=400)
        return Response(SchoolSerializer(school).data)

    def patch(self, request):
        school = School.objects.filter(pk=request.user.active_school_id).first()
        if school is None:
            return Response({"error": "no_active_school"}, status=400)
        serializer = SchoolSerializer(school, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


def _send_school_team_invite_email(user):
    """Same shape as accounts.hq_views._send_invite_email / teachers.views'
    equivalent — the invited team member sets their password via the
    generic /api/auth/complete-invite/ flow."""
    from django.conf import settings
    from django.contrib.auth.tokens import default_token_generator
    from django.db import transaction
    from django.utils.encoding import force_bytes
    from django.utils.http import urlsafe_base64_encode

    from notifications.tasks import send_transactional_email_task

    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    setup_url = f"{settings.FRONTEND_URL}/setup-account?uid={uid}&token={token}"
    transaction.on_commit(
        lambda: send_transactional_email_task.delay(
            to_email=user.email, to_name=user.full_name, key="team_invite",
            context={"user_name": user.full_name or user.email, "setup_url": setup_url, "platform_name": "No Under 40"},
        )
    )


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
                "created_at": m.created_at,
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

        user = User.objects.filter(email__iexact=email).first()
        existing = user is not None
        if user is None:
            user = User(email=email, full_name=name, role=Role.SCHOOL, roles=[Role.SCHOOL])
            user.set_unusable_password()
            user.active_school_id = school_id
            user.save()
        elif not user.active_school_id:
            user.active_school_id = school_id
            user.save(update_fields=["active_school"])

        membership, created = SchoolMembership.objects.get_or_create(
            profile=user, school_id=school_id, defaults={"sub_role": sub_role}
        )
        if not created:
            return Response({"error": "already_a_member"}, status=400)

        if not user.has_usable_password():
            _send_school_team_invite_email(user)

        return Response({"id": str(membership.id), "existing": existing}, status=201)

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

        caller = SchoolMembership.objects.filter(profile=request.user, school_id=school_id).first()
        caller_role = caller.sub_role if caller else request.user.school_sub_role
        if caller_role not in ("owner", "admin"):
            return Response({"error": "forbidden"}, status=403)
        if membership.sub_role == "owner" and caller_role != "owner":
            return Response({"error": "forbidden"}, status=403)

        user = membership.profile
        new_email = (request.data.get("email") or "").strip().lower()
        if new_email and new_email != user.email.lower():
            if User.objects.filter(email__iexact=new_email).exclude(pk=user.pk).exists():
                return Response({"error": "email_taken"}, status=400)
            user.email = new_email
        if "first_name" in request.data:
            user.first_name = (request.data.get("first_name") or "").strip()
        if "last_name" in request.data:
            user.last_name = (request.data.get("last_name") or "").strip()
        if "name" in request.data and "first_name" not in request.data:
            user.full_name = (request.data.get("name") or "").strip()
        if "phone" in request.data:
            user.phone = request.data.get("phone") or ""
        user.save()

        new_role = request.data.get("school_sub_role")
        if new_role in ("owner", "admin", "staff") and membership.sub_role != "owner":
            membership.sub_role = new_role
            membership.save(update_fields=["sub_role"])

        return Response({
            "id": str(membership.id), "name": user.full_name, "email": user.email,
            "phone": user.phone, "school_sub_role": membership.sub_role,
        })

    def delete(self, request):
        school_id = request.user.active_school_id
        membership = SchoolMembership.objects.filter(pk=request.data.get("id"), school_id=school_id).first()
        if membership is None:
            return Response({"error": "not_found"}, status=404)
        membership.delete()
        return Response(status=204)


class SchoolTeamResendInviteView(APIView):
    """POST /api/school/team/resend/ — {id: SchoolMembership id}."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        school_id = request.user.active_school_id
        membership = (
            SchoolMembership.objects.filter(pk=request.data.get("id"), school_id=school_id)
            .select_related("profile").first()
        )
        if membership is None:
            return Response({"error": "not_found"}, status=404)
        _send_school_team_invite_email(membership.profile)
        return Response({"sent": True})
