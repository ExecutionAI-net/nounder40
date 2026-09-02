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
    memberCount = serializers.SerializerMethodField()

    class Meta:
        model = HQRole
        fields = ("key", "label", "builtin", "permissions", "created_at", "memberCount")
        extra_kwargs = {"key": {"required": False}}

    def get_memberCount(self, obj):
        return HQMember.objects.filter(sub_role=obj.key, active=True).count()


class PendingInvitationSerializer(serializers.ModelSerializer):
    class Meta:
        model = PendingInvitation
        fields = "__all__"
        read_only_fields = ("id", "invited_by", "created_at")
