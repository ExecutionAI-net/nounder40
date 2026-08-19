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


class HQRoleViewSet(viewsets.ModelViewSet):
    """Dynamic HQ role → permission matrix (migration 032)."""

    queryset = HQRole.objects.all().order_by("key")
    serializer_class = HQRoleSerializer
    permission_classes = [IsAuthenticated, IsHQ]

    def destroy(self, request, *args, **kwargs):
        role = self.get_object()
        if role.builtin:
            return Response({"error": "builtin roles cannot be deleted"}, status=status.HTTP_400_BAD_REQUEST)
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
            user = User(email=invite.email, full_name=invite.name, role=Role.HQ, roles=[Role.HQ])
            user.set_unusable_password()
            user.hq_sub_role = invite.role_detail
            user.save()
        member, _ = HQMember.objects.update_or_create(
            user=user,
            defaults=dict(email=invite.email, name=invite.name, sub_role=invite.role_detail or "support", active=True),
        )
        invite.delete()
        return Response(HQMemberSerializer(member).data, status=status.HTTP_201_CREATED)
