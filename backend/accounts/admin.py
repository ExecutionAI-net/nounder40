from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from core.admin_forms import role_choice_form

from .models import HQMember, HQRole, PendingInvitation, User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    ordering = ("email",)
    list_display = ("email", "first_name", "last_name", "role", "active_school", "city",
                    "language_preference", "is_staff", "is_active", "date_joined")
    list_filter = ("role", "active_school", "is_staff", "is_active", "language_preference")
    search_fields = ("email", "full_name", "first_name", "last_name", "phone", "city")
    date_hierarchy = "date_joined"
    list_select_related = ("active_school",)
    readonly_fields = ("id", "date_joined", "last_login")
    fieldsets = (
        (None, {"fields": ("id", "email", "password")}),
        # full_name is recomposed from first/last on save (models.User.save)
        ("Profile", {"fields": ("first_name", "last_name", "full_name", "role", "roles", "active_school",
                                "phone", "city", "language_preference")}),
        ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
        ("Dates", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (None, {"classes": ("wide",), "fields": ("email", "role", "password1", "password2")}),
    )


@admin.register(HQMember)
class HQMemberAdmin(admin.ModelAdmin):
    form = role_choice_form(HQRole)  # sub_role scelto dalla matrice HQ, non digitato
    list_display = ("name", "email", "sub_role", "active", "created_at")
    list_filter = ("sub_role", "active")
    search_fields = ("name", "email")
    ordering = ("name",)


@admin.register(HQRole)
class HQRoleAdmin(admin.ModelAdmin):
    """Gemello di schools.SchoolRoleAdmin: senza il conteggio dei permessi
    l'elenco non dice cosa quel ruolo possa effettivamente aprire."""

    list_display = ("key", "label", "builtin", "permission_count", "created_at")
    list_filter = ("builtin",)
    search_fields = ("key", "label")
    ordering = ("label",)

    @admin.display(description="sections", ordering="key")
    def permission_count(self, obj):
        return f"{len(obj.permissions)} — {', '.join(obj.permissions[:6])}"


@admin.register(PendingInvitation)
class PendingInvitationAdmin(admin.ModelAdmin):
    list_display = ("email", "name", "type", "role_detail", "school", "phone",
                    "invited_by", "created_at")
    list_filter = ("type", "school")
    search_fields = ("email", "name", "phone", "school__name")
    ordering = ("-created_at",)
    date_hierarchy = "created_at"
    list_select_related = ("school", "invited_by")
