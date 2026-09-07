"""One language per person, whichever door it was set from.

`User.language_preference` and `Student.language_preference` were two
independent columns written by two different screens: the header language
switch (`PATCH /api/auth/me/`) touched the first, the student profile select
(`PATCH /api/student/profile/`) the second. They drifted, and the e-mails
split with them — welcome/reset followed the User row, booking/purchase/
no-show/credits-low the Student row, so a student could read "es" in the UI
and receive her booking confirmation in Italian (QA R2-M13).

The source of truth is `User.language_preference`: it exists for every
account (teachers, school staff, HQ have no Student row), it is what the
authentication flows already use, and it is what registration/invitation set
from the UI locale. `Student.language_preference` stays as a *mirror* so the
dozens of `student.language_preference` reads in notifications keep working
and keep resolving the same value; both receivers write with `.update()`,
which does not re-fire post_save, so there is no ping-pong.
"""

from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import User

# The five shipped locales (frontend/src/i18n/routing.ts).
LOCALES = ("en", "it", "es", "fr", "de")


@receiver(post_save, sender=User, dispatch_uid="accounts.mirror_language_to_student")
def mirror_language_to_student(sender, instance, **kwargs):
    lang = (instance.language_preference or "").strip()
    if not lang:
        return
    from students.models import Student

    Student.objects.filter(user_id=instance.pk).exclude(language_preference=lang).update(
        language_preference=lang
    )


def mirror_language_to_user(sender, instance, **kwargs):
    """post_save on students.Student — registered here (not in students/, which
    has no signals module) so both halves of the mirror read as one rule."""
    lang = (instance.language_preference or "").strip()
    if not lang or not instance.user_id:
        return
    User.objects.filter(pk=instance.user_id).exclude(language_preference=lang).update(
        language_preference=lang
    )


def connect_student_signal():
    from students.models import Student

    post_save.connect(
        mirror_language_to_user, sender=Student, dispatch_uid="accounts.mirror_language_to_user"
    )
