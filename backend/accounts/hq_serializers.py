from rest_framework import serializers

from .models import HQMember, HQRole, PendingInvitation


class HQMemberSerializer(serializers.ModelSerializer):
    class Meta:
        model = HQMember
        fields = ("user", "email", "name", "sub_role", "active", "created_at")
        read_only_fields = ("user", "created_at")


class HQRoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = HQRole
        fields = "__all__"


class PendingInvitationSerializer(serializers.ModelSerializer):
    class Meta:
        model = PendingInvitation
        fields = "__all__"
        read_only_fields = ("id", "invited_by", "created_at")
