from rest_framework import serializers

from .models import HQMember, HQRole, PendingInvitation


class HQMemberSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source="user_id", read_only=True)
    phone = serializers.CharField(source="user.phone", read_only=True)

    class Meta:
        model = HQMember
        fields = ("id", "email", "name", "phone", "sub_role", "active", "created_at")
        read_only_fields = ("created_at",)


class HQRoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = HQRole
        fields = "__all__"


class PendingInvitationSerializer(serializers.ModelSerializer):
    class Meta:
        model = PendingInvitation
        fields = "__all__"
        read_only_fields = ("id", "invited_by", "created_at")
