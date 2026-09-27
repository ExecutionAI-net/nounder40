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
from django.db.models.signals import post_delete, post_save, pre_save
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
    # ... and a seat that opens this way is a seat someone may be waiting for
    from .services import schedule_spot_alerts

    schedule_spot_alerts(instance.lesson_id)


# "Notify me if a spot frees up" (WAITLIST_ALERTS_AND_VIP.md): a seat can open
# without any booking moving — the school raises the lesson's capacity (the
# class page, the event sync) or puts a cancelled lesson back on — and a
# lesson cancelled here is one whose waiting rows are spent. The seat-count
# paths hook in bookings/services.py (`_bump_lesson`, `release_lesson_seats`);
# this pair covers the lesson row itself. Compared against the stored row
# only on an update that may touch those two fields; acted on after the
# save, so the task (queued on commit) reads what was written.


@receiver(pre_save, sender="catalog.Lesson", dispatch_uid="bookings.note_lesson_change_for_spot_alerts")
def note_lesson_change_for_spot_alerts(sender, instance, update_fields=None, **kwargs):
    instance._spot_alerts_check = False
    if instance._state.adding:
        return
    if update_fields is not None and not ({"max_capacity", "status"} & set(update_fields)):
        return
    old = sender.objects.filter(pk=instance.pk).values_list("max_capacity", "status").first()
    if old is None:
        return
    old_capacity, old_status = old
    instance._spot_alerts_check = (instance.max_capacity or 0) > (old_capacity or 0) or instance.status != old_status


@receiver(post_save, sender="catalog.Lesson", dispatch_uid="bookings.spot_alerts_on_lesson_change")
def spot_alerts_on_lesson_change(sender, instance, created, **kwargs):
    if created or not getattr(instance, "_spot_alerts_check", False):
        return
    instance._spot_alerts_check = False
    from .services import schedule_spot_alerts

    schedule_spot_alerts(instance.pk)
