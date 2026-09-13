from django.apps import apps as django_apps
from django.contrib import admin

from .models import LibraryContent, Tutorial, VideoProgress


@admin.register(LibraryContent)
class LibraryContentAdmin(admin.ModelAdmin):
    """`visible_to_students` + `student_access` + `price` sono la regola di
    accesso: visibile o no, incluso o a pagamento, e a quanto."""

    list_display = ("title_en", "school", "lesson_type", "type", "level", "language",
                    "visible_to_students", "student_access", "price", "active")
    list_filter = ("active", "type", "visible_to_students", "student_access",
                   "school", "language", "level")
    search_fields = ("title_en", "title_it", "title_fr", "title_es", "description")
    list_select_related = ("school", "lesson_type")


@admin.register(VideoProgress)
class VideoProgressAdmin(admin.ModelAdmin):
    list_display = ("user", "content", "progress_seconds", "completed", "last_watched_at")
    list_filter = ("completed",)
    search_fields = ("user__email", "content__title_en", "content__title_it")
    ordering = ("-last_watched_at",)
    date_hierarchy = "last_watched_at"
    list_select_related = ("user", "content")


@admin.register(Tutorial)
class TutorialAdmin(admin.ModelAdmin):
    list_display = ("title", "language", "type", "topic", "sort_order", "active", "has_file", "updated_at")
    list_filter = ("active", "type", "language")
    search_fields = ("title", "description", "topic")
    ordering = ("sort_order", "-created_at")
    readonly_fields = ("file_path", "file_name", "file_size", "created_at", "updated_at")

    @admin.display(boolean=True, description="PDF")
    def has_file(self, obj):
        return obj.has_file


for _model in django_apps.get_app_config("library").get_models():
    try:
        admin.site.register(_model)
    except admin.sites.AlreadyRegistered:
        pass
