"""A package that has just been created gets the closure days already on its
school's calendar (students/extensions.py, PACKAGE_EXTENSIONS.md).

One seam for every creation path — the Stripe one-time purchase
(commerce/services.py), the manual grant (students/school_views.py), the
recurring activation (commerce/webhooks.py, excluded by the rule itself), an
import — instead of a call each of them has to remember. Same shape as
schools/signals.py and bookings/signals.py.
"""

from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import StudentPackage


@receiver(post_save, sender=StudentPackage, dispatch_uid="students.settle_new_package_extensions")
def settle_new_package(sender, instance, created, raw=False, **kwargs):
    if not created or raw:
        return
    from .extensions import settle

    settle(instance)
