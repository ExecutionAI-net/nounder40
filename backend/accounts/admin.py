from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import HQMember, HQRole, PendingInvitation, User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    ordering = ("email",)
    list_display = ("email", "full_name", "role", "is_staff", "is_active")
    list_filter = ("role", "is_staff", "is_active")
    search_fields = ("email", "full_name")
    readonly_fields = ("id", "date_joined", "last_login")
    fieldsets = (
        (None, {"fields": ("id", "email", "password")}),
        ("Profile", {"fields": ("full_name", "role")}),
        ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
        ("Dates", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (None, {"classes": ("wide",), "fields": ("email", "role", "password1", "password2")}),
    )


@admin.register(HQMember)
class HQMemberAdmin(admin.ModelAdmin):
    list_display = ("name", "email", "sub_role", "active")
    list_filter = ("sub_role", "active")
    search_fields = ("name", "email")


@admin.register(HQRole)
class HQRoleAdmin(admin.ModelAdmin):
    list_display = ("key", "label", "builtin")
    list_filter = ("builtin",)


@admin.register(PendingInvitation)
class PendingInvitationAdmin(admin.ModelAdmin):
    list_display = ("email", "name", "type", "created_at")
    list_filter = ("type",)
    search_fields = ("email", "name")
