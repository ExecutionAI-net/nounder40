# Carlo, 2026-09-21: every course gets a position. Until now `sort_order` was
# written only by the drag-to-reorder on the Courses page, so a course created
# afterwards stayed without one (shown last, newest start date first). The
# model now assigns the next position on insert (Course.save); this numbers
# the rows that already exist, per school, in the exact order the Courses page
# showed them: positioned ones untouched, the rest appended by start date
# descending, so nothing moves on screen.
from django.db import migrations
from django.db.models import F, Max


def backfill(apps, schema_editor):
    Course = apps.get_model("catalog", "Course")
    school_ids = Course.objects.filter(sort_order__isnull=True).values_list("school_id", flat=True).distinct()
    for school_id in school_ids:
        top = Course.objects.filter(school_id=school_id).aggregate(m=Max("sort_order"))["m"] or 0
        pending = Course.objects.filter(school_id=school_id, sort_order__isnull=True).order_by(
            F("start_date").desc(nulls_last=True), "created_at"
        )
        for i, course in enumerate(pending, start=1):
            Course.objects.filter(pk=course.pk).update(sort_order=top + i)


class Migration(migrations.Migration):
    dependencies = [("catalog", "0019_special_events")]

    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
