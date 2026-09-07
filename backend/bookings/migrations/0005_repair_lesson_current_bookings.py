"""One-off repair of the counters SCH-R2-11 left behind.

Before `bookings.signals.free_seat_on_booking_delete` existed, deleting a
student (cascade on `bookings`) never decremented `lessons.current_bookings`:
the seat stayed occupied for good. Realign every lesson with the bookings
that actually exist — the same definition the runtime uses (everything that
is not `cancelled` holds a seat).
"""

from django.db import migrations

REPAIR_SQL = """
UPDATE lessons AS l
SET current_bookings = sub.real_count
FROM (
    SELECT c.id AS id,
           COALESCE((
               SELECT COUNT(*) FROM bookings b
               WHERE b.lesson_id = c.id AND b.status <> 'cancelled'
           ), 0) AS real_count
    FROM lessons c
) AS sub
WHERE l.id = sub.id AND COALESCE(l.current_bookings, 0) <> sub.real_count;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("bookings", "0004_alter_booking_credits_deducted"),
        ("catalog", "0016_course_lesson_email_info"),
    ]

    operations = [
        migrations.RunSQL(REPAIR_SQL, migrations.RunSQL.noop),
    ]
