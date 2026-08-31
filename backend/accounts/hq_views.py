from django.db.models import Case, IntegerField, When
from django.utils.text import slugify
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .hq_serializers import HQMemberSerializer, HQRoleSerializer, PendingInvitationSerializer
from .models import HQMember, HQRole, PendingInvitation, Role, User
from .permissions import IsHQ


class HQMemberViewSet(viewsets.ModelViewSet):
    """HQ team roster. HQ-only, both read and write (internal to HQ)."""

    queryset = HQMember.objects.select_related("user").order_by("name")
    serializer_class = HQMemberSerializer
    permission_classes = [IsAuthenticated, IsHQ]
    filterset_fields = ["sub_role", "active"]

    def partial_update(self, request, *args, **kwargs):
        member = self.get_object()
        user = member.user
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


class HQRoleViewSet(viewsets.ModelViewSet):
    """Dynamic HQ role → permission matrix (migration 032)."""

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


class PendingInvitationViewSet(viewsets.ModelViewSet):
    """HQ member + school teacher invitations awaiting approval."""

    queryset = PendingInvitation.objects.all().order_by("-created_at")
    serializer_class = PendingInvitationSerializer
    permission_classes = [IsAuthenticated, IsHQ]
    filterset_fields = ["type"]

    def perform_create(self, serializer):
        serializer.save(invited_by=self.request.user)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        """Turn a pending hq_member invitation into a real User + HQMember.
        The user gets an unusable password until the invite-email/reset flow
        (Phase 6) lets them set one."""
        invite = self.get_object()
        if invite.type != PendingInvitation.Kind.HQ_MEMBER:
            return Response({"error": "not_an_hq_invitation"}, status=status.HTTP_400_BAD_REQUEST)

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
