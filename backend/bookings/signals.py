"""`Lesson.current_bookings` must survive a booking that disappears without
passing through the cancellation path.

The counter is denormalised on purpose: every state transition bumps it
(`services._bump_lesson`, the `F("current_bookings") + 1` in `staff_enrol`)
and every read path — calendars, lesson feeds, `assert_bookable` — trusts the
stored value. A hard delete of the *booking row* (in practice a cascade from
`students.Student` / `accounts.User` deletion, but also an admin delete) is
the one transition nobody bumped, so the seat stayed occupied forever
(QA SCH-R2-11: `current_bookings: 1, enrollments: []`).

Recomputing on read was the alternative; it was rejected because it would
have to be repeated in every reader (and in the DB column that the school
panel and the ETL still export), while the write side already has a single,
well-defined moment to correct. Same shape as `schools/signals.py`.
"""

from django.db.models import F
from django.db.models.functions import Greatest
from django.db.models.signals import post_delete
from django.dispatch import receiver

from .models import Booking


@receiver(post_delete, sender=Booking, dispatch_uid="bookings.free_seat_on_booking_delete")
def free_seat_on_booking_delete(sender, instance, **kwargs):
    # A cancelled booking already gave its seat back when it was cancelled:
    # decrementing again would under-count.
    if instance.status == Booking.Status.CANCELLED:
        return
    from catalog.models import Lesson

    Lesson.objects.filter(pk=instance.lesson_id).update(
        current_bookings=Greatest(F("current_bookings") - 1, 0)
    )
