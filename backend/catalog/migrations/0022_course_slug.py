from django.db import migrations, models
from django.utils.text import slugify


def backfill_event_slugs(apps, schema_editor):
    """Every special event created before the shareable link existed gets
    `<school slug>-<title>` (numbered when taken), the same suggestion
    catalog.events makes for a new one. Ordinary courses stay NULL."""
    Course = apps.get_model("catalog", "Course")
    taken = set(Course.objects.exclude(slug__isnull=True).values_list("slug", flat=True))
    events = Course.objects.filter(is_special_event=True, slug__isnull=True).select_related("school").order_by("created_at")
    for course in events:
        base = "-".join(p for p in (slugify(course.school.slug), slugify(course.name)) if p) or "event"
        base = base[:249].strip("-")
        slug, i = base, 1
        while slug in taken:
            i += 1
            slug = f"{base}-{i}"
        taken.add(slug)
        course.slug = slug
        course.save(update_fields=["slug"])


class Migration(migrations.Migration):
    dependencies = [
        ("catalog", "0021_package_extended_by_closures"),
    ]

    operations = [
        migrations.AddField(
            model_name="course",
            name="slug",
            field=models.SlugField(blank=True, max_length=255, null=True, unique=True),
        ),
        migrations.RunPython(backfill_event_slugs, migrations.RunPython.noop),
    ]
