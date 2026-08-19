from rest_framework import serializers

from .models import QuickReplyTemplate


class QuickReplyTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = QuickReplyTemplate
        fields = "__all__"
        extra_kwargs = {"school": {"required": False}}
