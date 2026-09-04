from django.apps import apps as django_apps
from django.contrib import admin

from .models import Conversation, Message, QuickReplyTemplate


@admin.register(Conversation)
class ConversationAdmin(admin.ModelAdmin):
    """`type` dice fra chi corre la conversazione; le tre colonne successive
    sono i tre interlocutori possibili, e solo quella pertinente è piena."""

    list_display = ("created_at", "type", "school", "student", "teacher",
                    "status", "priority", "assigned_to", "last_message_at")
    list_filter = ("type", "status", "priority", "school")
    search_fields = ("school__name", "student__name", "student__email", "teacher__name")
    ordering = ("-created_at",)
    date_hierarchy = "created_at"
    list_select_related = ("school", "student", "teacher", "assigned_to")


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ("created_at", "conversation", "sender", "sender_role",
                    "extract", "is_internal", "read_at")
    list_filter = ("sender_role", "is_internal")
    search_fields = ("content", "sender__email")
    ordering = ("-created_at",)
    date_hierarchy = "created_at"
    list_select_related = ("conversation", "sender")

    @admin.display(description="content")
    def extract(self, obj):
        text = " ".join((obj.content or "").split())
        return f"{text[:80]}…" if len(text) > 80 else (text or "—")


@admin.register(QuickReplyTemplate)
class QuickReplyTemplateAdmin(admin.ModelAdmin):
    list_display = ("title", "school", "created_at")
    list_filter = ("school",)
    search_fields = ("title", "content", "school__name")
    list_select_related = ("school",)


for _model in django_apps.get_app_config("chat").get_models():
    try:
        admin.site.register(_model)
    except admin.sites.AlreadyRegistered:
        pass
