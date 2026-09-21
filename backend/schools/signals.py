"""Quando una SchoolMembership sparisce, deve sparire anche l'accesso.

`profiles.active_school_id` è una colonna a sé: cancellare la membership non la
tocca. Finché resta puntata alla scuola l'utente continua a comparire come
utente-scuola (`roles` con "school") e il pannello continua a scopare su quella
colonna — da cui il caso segnalato dall'admin: membership cancellata, scuola
ancora accessibile. Il guard delle sezioni ora chiude la porta a runtime
(core/section_guard.py); questo receiver evita che il dato resti incoerente
alle spalle, così l'admin, lo switcher di scuola e le API raccontano la stessa
storia.
"""

from django.db.models.signals import post_delete, post_save, pre_delete, pre_save
from django.dispatch import receiver

from .models import SchoolClosure, SchoolMembership


@receiver(post_delete, sender=SchoolMembership, dispatch_uid="schools.revoke_access_on_membership_delete")
def revoke_school_access(sender, instance, **kwargs):
    user = instance.profile
    User = type(user)

    if not User.objects.filter(pk=user.pk).exists():
        # Cancellazione a cascata dell'utente stesso: non c'è nulla da
        # riallineare, e riscrivere qui sarebbe solo rumore.
        return

    remaining = list(
        SchoolMembership.objects
        .filter(profile_id=user.pk)
        .order_by("created_at")
        .only("school_id")
    )
    changed = []

    if user.active_school_id == instance.school_id:
        # Se resta un'altra scuola lo spostiamo lì invece di lasciarlo senza:
        # un membro di due scuole rimosso da una deve continuare a lavorare
        # sull'altra, non ritrovarsi fuori da tutto.
        user.active_school_id = remaining[0].school_id if remaining else None
        changed.append("active_school")

    if not remaining:
        if "school" in (user.roles or []):
            user.roles = [r for r in user.roles if r != "school"]
            changed.append("roles")
        if user.role == "school":
            # `role` è il ruolo primario: se era "school" e non lo è più,
            # lasciamo il primo ruolo residuo (spesso "student") o nulla.
            user.role = user.roles[0] if user.roles else ""
            changed.append("role")
        if user.school_sub_role:
            user.school_sub_role = ""
            changed.append("school_sub_role")

    if changed:
        user.save(update_fields=changed)


# --- closures and the packages they extend (students/extensions.py) ----------
# The days a closure gives back are recomputed here, on the model's own
# lifecycle, so the school API, the Django admin and any bulk delete all keep
# the packages in line; a viewset hook alone left the admin path behind.

_CLOSURE_EXTENSION_FIELDS = ("date", "end_date", "type", "extends_packages", "school_id")


@receiver(pre_save, sender=SchoolClosure, dispatch_uid="schools.remember_closure_before_save")
def remember_closure_before_save(sender, instance, raw=False, **kwargs):
    instance._before_save = (
        SchoolClosure.objects.filter(pk=instance.pk).values(*_CLOSURE_EXTENSION_FIELDS).first()
        if instance.pk and not raw else None
    )


@receiver(post_save, sender=SchoolClosure, dispatch_uid="schools.resettle_packages_after_closure_save")
def resettle_packages_after_closure_save(sender, instance, created, raw=False, **kwargs):
    if raw:
        return
    before = getattr(instance, "_before_save", None)
    if not created and before is not None and all(before[f] == getattr(instance, f) for f in _CLOSURE_EXTENSION_FIELDS):
        return  # the notes alone changed: nothing moves
    from students.extensions import resettle_school

    resettle_school(instance.school_id, closure=instance)
    if before is not None and before["school_id"] != instance.school_id:
        resettle_school(before["school_id"])  # moved to another school: the old one lets go


@receiver(pre_delete, sender=SchoolClosure, dispatch_uid="schools.resettle_packages_before_closure_delete")
def resettle_packages_before_closure_delete(sender, instance, **kwargs):
    # Before the FK is nulled: the rows still name the closure, so the
    # recompute can revoke them and take the days back.
    from students.extensions import resettle_school

    resettle_school(instance.school_id, ignore=instance.pk)
