from django.db import migrations

FULL = [
    "dashboard", "schools_view", "schools_create_edit", "schools_activate",
    "schools_platform_fee", "payments", "reports", "inbox", "library", "shop",
    "packages", "lesson_types", "team", "permissions", "homepage_settings",
    "locations", "translations", "email_templates",
]

BUILTIN_ROLES = [
    ("owner", "Owner", FULL),
    ("super_admin", "Super Admin", FULL),
    ("operations", "Operations", [
        "dashboard", "schools_view", "schools_create_edit", "schools_activate",
        "inbox", "library", "shop", "packages", "lesson_types",
        "homepage_settings", "locations",
    ]),
    ("finance", "Finance", ["dashboard", "schools_view", "schools_platform_fee", "payments", "reports"]),
    ("tech_support", "Tech Support", ["dashboard", "inbox"]),
    ("analytics", "Analytics", ["dashboard", "schools_view", "reports"]),
    ("support", "Support", ["dashboard", "inbox"]),
]


def seed(apps, schema_editor):
    HQRole = apps.get_model("accounts", "HQRole")
    for key, label, perms in BUILTIN_ROLES:
        HQRole.objects.update_or_create(
            key=key, defaults={"label": label, "builtin": True, "permissions": perms}
        )


def unseed(apps, schema_editor):
    HQRole = apps.get_model("accounts", "HQRole")
    HQRole.objects.filter(key__in=[k for k, _, _ in BUILTIN_ROLES]).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0003_user_active_school_user_city_user_hq_sub_role_and_more")]
    operations = [migrations.RunPython(seed, unseed)]
