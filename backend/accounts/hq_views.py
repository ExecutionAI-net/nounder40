from django.db.models import Case, IntegerField, When
from django.utils.text import slugify
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .hq_serializers import HQMemberSerializer, HQRoleSerializer, PendingInvitationSerializer
from .models import HQMember, HQRole, PendingInvitation, Role, User
from .permissions import IsHQ

# Only these hq_sub_roles are equivalent to "full control" today (Group 7 of
# the QA report: owner and super_admin carry identical permission matrices).
# Kept as a fallback safety net alongside the 'team'/'permissions' permission
# keys below, in case a future role is granted one of those keys without
# actually being owner-equivalent.
_HQ_OWNER_EQUIVALENT = {"owner", "super_admin"}


def _caller_hq_permissions(user):
    # effective_hq_sub_role(), not the flat hq_sub_role column: HQMember.sub_role
    # is the source of truth (see User.effective_hq_sub_role docstring) -- a
    # blank flat column (qa_platform.py never writes it, and likely other
    # paths don't either) would otherwise silently resolve zero permissions
    # for every caller, or worse, fail open wherever a check treats blank as
    # "no matrix, don't block".
    role = HQRole.objects.filter(key=user.effective_hq_sub_role()).only("permissions").first()
    return set(role.permissions) if role else set()


class HQMemberViewSet(viewsets.ModelViewSet):
    """HQ team roster. HQ-only, both read and write (internal to HQ).

    Writing here used to only check `role == 'hq'` — any HQ sub-role (even
    `support`) could promote itself to owner, edit anyone's sub_role, or
    delete any member including the owner (QA report, Critical #1/#3).
    Mutating requests now additionally require the caller's HQRole to carry
    the 'team' permission — matching the matrix already shown in
    `/hq/permissions` and mirroring the owner/admin hierarchy enforced on
    the school side (`SchoolTeamView`)."""

    queryset = HQMember.objects.select_related("user").order_by("name")
    serializer_class = HQMemberSerializer
    permission_classes = [IsAuthenticated, IsHQ]
    filterset_fields = ["sub_role", "active"]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        # GET used to be ungated here (QA report, High #1): the middleware
        # exempts the "team" segment on the assumption enforcement "already
        # lives" in this initial() -- true for writes, but reads fell through
        # to IsHQ alone, leaking every real staff member's name/email/phone
        # to any HQ sub-role (even support: dashboard+inbox only). This page
        # is only ever linked from the sidebar for 'team'-permission holders,
        # so there is no legitimate all-roles read path to preserve here.
        if "team" not in _caller_hq_permissions(request.user):
            self.permission_denied(request, message="forbidden")

    def partial_update(self, request, *args, **kwargs):
        member = self.get_object()
        user = member.user
        caller_sub_role = request.user.effective_hq_sub_role()
        if "sub_role" in request.data:
            new_sub_role = request.data.get("sub_role") or ""
            if new_sub_role in _HQ_OWNER_EQUIVALENT and caller_sub_role not in _HQ_OWNER_EQUIVALENT:
                return Response({"error": "only_owner_assigns_owner"}, status=status.HTTP_403_FORBIDDEN)
            if member.sub_role in _HQ_OWNER_EQUIVALENT and caller_sub_role not in _HQ_OWNER_EQUIVALENT:
                return Response({"error": "forbidden"}, status=status.HTTP_403_FORBIDDEN)
        # Email is the login: keep User in sync and refuse duplicates upfront.
        new_email = (request.data.get("email") or "").strip().lower()
        if new_email and new_email != user.email.lower():
            if User.objects.filter(email__iexact=new_email).exclude(pk=user.pk).exists():
                return Response({"error": "email_taken"}, status=status.HTTP_400_BAD_REQUEST)
        response = super().partial_update(request, *args, **kwargs)
        update_fields = []
        if "phone" in request.data:
            user.phone = request.data.get("phone") or ""
            update_fields.append("phone")
        if new_email and new_email != user.email.lower():
            user.email = new_email
            update_fields.append("email")
        if "name" in request.data:
            # Nei campi separati, altrimenti save() ricomporrebbe dai vecchi
            head, _, rest = (request.data.get("name") or "").strip().partition(" ")
            user.first_name, user.last_name = head, rest
            update_fields += ["first_name", "last_name", "full_name"]
        if "sub_role" in request.data:
            user.hq_sub_role = request.data.get("sub_role") or ""
            update_fields.append("hq_sub_role")
        if update_fields:
            user.save(update_fields=update_fields)
        response.data["phone"] = user.phone
        return response

    def destroy(self, request, *args, **kwargs):
        member = self.get_object()
        if member.user_id == request.user.pk:
            # Un titolare che si rimuovesse da solo perderebbe l'accesso al
            # team management insieme al proprio account (self-lockout).
            return Response({"error": "cannot_remove_self"}, status=status.HTTP_400_BAD_REQUEST)
        if member.sub_role in _HQ_OWNER_EQUIVALENT and request.user.effective_hq_sub_role() not in _HQ_OWNER_EQUIVALENT:
            return Response({"error": "forbidden"}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)


class HQRoleViewSet(viewsets.ModelViewSet):
    """Dynamic HQ role → permission matrix (migration 032).

    Any HQ sub-role could previously PATCH this matrix — including its own
    role's permissions — with no caller check at all (QA report, Critical
    #2). Mutating requests now require the caller's HQRole to carry the
    'permissions' permission, same pattern as `HQMemberViewSet`."""

    # Ordine fisso per Carlo: Owner, Super Admin, poi gli altri
    queryset = HQRole.objects.annotate(
        _ord=Case(
            When(key="owner", then=0),
            When(key="super_admin", then=1),
            default=2,
            output_field=IntegerField(),
        )
    ).order_by("_ord", "created_at")
    serializer_class = HQRoleSerializer
    permission_classes = [IsAuthenticated, IsHQ]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        # `mine` is every HQ user's own role + permission list, not the full
        # matrix -- it must stay open regardless of the 'permissions' key so
        # the Dashboard/sidebar can keep filtering nav items and gating UI
        # for roles that (correctly) cannot see anyone else's data.
        if getattr(self, "action", None) == "mine":
            return
        # GET used to be ungated here too (QA report, High #1): same story as
        # HQMemberViewSet.initial() above -- the middleware exempts this
        # segment assuming enforcement "already lives" in this initial(), but
        # only writes were checked. Reads leaked the full role/permission
        # matrix, including custom roles, to any HQ sub-role.
        if "permissions" not in _caller_hq_permissions(request.user):
            self.permission_denied(request, message="forbidden")

    @action(detail=False, methods=["get"])
    def mine(self, request):
        """The caller's own effective role + permissions -- safe for every
        authenticated HQ user regardless of the 'permissions' key. Used by
        HQLayout/Dashboard to filter nav items and gate schools_view/
        schools_create_edit-only UI without exposing the full roster that
        GET /hq/permissions/ (list) now correctly restricts (QA report,
        High #1)."""
        sub_role = request.user.effective_hq_sub_role()
        role = HQRole.objects.filter(key=sub_role).only("key", "label", "permissions").first()
        if role is None:
            return Response({"key": sub_role or "", "label": "", "permissions": []})
        return Response({"key": role.key, "label": role.label, "permissions": role.permissions})

    def create(self, request, *args, **kwargs):
        data = request.data.copy()
        if not data.get("key"):
            base = slugify(data.get("label", "")) or "role"
            key, i = base, 1
            while HQRole.objects.filter(key=key).exists():
                i += 1
                key = f"{base}-{i}"
            data["key"] = key
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

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
        count = HQMember.objects.filter(sub_role=role.key, active=True).count()
        if count > 0:
            return Response({"error": "role_in_use", "count": count}, status=status.HTTP_400_BAD_REQUEST)
        return super().destroy(request, *args, **kwargs)


def _invitation_owner_guard(request, target_type, target_role_detail):
    """Same `_HQ_OWNER_EQUIVALENT` hierarchy check as `HQMemberViewSet`,
    applied to the invite->approve path (QA report, Critical #1). That
    ModelViewSet correctly blocks a non-owner-equivalent caller from setting
    `sub_role: "owner"` directly; `PendingInvitationViewSet` had no equivalent
    check at all -- any caller holding only the 'team' permission (enough to
    reach this segment at all, see the middleware in core/section_guard.py)
    could create+approve an invitation with `role_detail: "owner"` and mint a
    brand-new, fully active Owner. Only applies to HQ_MEMBER invitations:
    school-teacher invitations use a different `type`/`role_detail`
    semantics and must not be affected."""
    if target_type != PendingInvitation.Kind.HQ_MEMBER:
        return None
    if (target_role_detail or "") in _HQ_OWNER_EQUIVALENT and request.user.effective_hq_sub_role() not in _HQ_OWNER_EQUIVALENT:
        return Response({"error": "only_owner_assigns_owner"}, status=status.HTTP_403_FORBIDDEN)
    return None


class PendingInvitationViewSet(viewsets.ModelViewSet):
    """HQ member + school teacher invitations awaiting approval."""

    queryset = PendingInvitation.objects.all().order_by("-created_at")
    serializer_class = PendingInvitationSerializer
    permission_classes = [IsAuthenticated, IsHQ]
    filterset_fields = ["type"]

    def perform_create(self, serializer):
        serializer.save(invited_by=self.request.user)

    def create(self, request, *args, **kwargs):
        denied = _invitation_owner_guard(request, request.data.get("type"), request.data.get("role_detail"))
        if denied is not None:
            return denied
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        invite = self.get_object()
        target_type = request.data.get("type", invite.type)
        target_role_detail = request.data.get("role_detail", invite.role_detail)
        denied = _invitation_owner_guard(request, target_type, target_role_detail)
        if denied is not None:
            return denied
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        invite = self.get_object()
        target_type = request.data.get("type", invite.type)
        target_role_detail = request.data.get("role_detail", invite.role_detail)
        denied = _invitation_owner_guard(request, target_type, target_role_detail)
        if denied is not None:
            return denied
        return super().partial_update(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        """Turn a pending hq_member invitation into a real User + HQMember.
        The user gets an unusable password until the invite-email/reset flow
        (Phase 6) lets them set one."""
        invite = self.get_object()
        if invite.type != PendingInvitation.Kind.HQ_MEMBER:
            return Response({"error": "not_an_hq_invitation"}, status=status.HTTP_400_BAD_REQUEST)
        # Defense-in-depth: even if create()/update() are correctly guarded,
        # this is the point where the escalation actually materializes into a
        # real HQMember/User row, so it gets the same check again.
        denied = _invitation_owner_guard(request, invite.type, invite.role_detail)
        if denied is not None:
            return denied

        user = User.objects.filter(email__iexact=invite.email).first()
        if user is None:
            user = User(email=invite.email, full_name=invite.name, phone=invite.phone, role=Role.HQ, roles=[Role.HQ])
            user.set_unusable_password()
            user.hq_sub_role = invite.role_detail
            user.save()
        elif invite.phone and not user.phone:
            user.phone = invite.phone
            user.save(update_fields=["phone"])
        member, _ = HQMember.objects.update_or_create(
            user=user,
            defaults=dict(email=invite.email, name=invite.name, sub_role=invite.role_detail or "support", active=True),
        )
        self._send_invite_email(user)
        invite.delete()
        return Response(HQMemberSerializer(member).data, status=status.HTTP_201_CREATED)

    @staticmethod
    def _send_invite_email(user):
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
                context={"user_name": user.full_name or user.email, "user_first_name": user.first_name_display, "setup_url": setup_url, "platform_name": "No Under 40"},
            )
        )
