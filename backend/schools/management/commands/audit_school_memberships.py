"""Trova (e ripara) i profili scuola incoerenti.

L'accesso al pannello scuola non è una cosa sola ma tre, e finché l'admin non
le allineava (vedi schools/admin.SchoolMembershipAdmin) era facile scriverne
solo una:

- ``roles`` con "school"  → la guardia di rotta del frontend legge solo questo
- ``active_school``       → è ciò che scope-a ogni query lato API
- ``SchoolMembership``    → selettore scuola, roster del team, sub-ruolo

Questo comando controlla le combinazioni che lasciano qualcuno "membro sulla
carta e fuori dai fatti". Di default riporta soltanto; ``--fix`` ripara le
classi in cui la correzione è ovvia e non concede nulla di nuovo.

Da quando la membership è la porta (core/section_guard.py) le ultime due classi
non sono più ambigue: senza membership sulla scuola attiva si riceve 403 su
tutto il pannello, quindi lasciarle così non è prudenza, è solo un profilo che
mente. Ripararle significa o rimandare l'utente su una scuola di cui è
davvero membro, o togliergli di dosso i residui di un accesso che non ha più.

Nota: ``active_school`` è popolato anche sulle allieve (è la loro scuola
predefinita), quindi tutti i controlli guardano solo chi ha "school" nei ruoli
o almeno una membership — altrimenti ogni allieva risulterebbe un'anomalia.
"""
from django.core.management.base import BaseCommand
from django.db.models import Q

from accounts.models import User
from schools.models import SchoolMembership


class Command(BaseCommand):
    help = "Report (and optionally repair) school profiles whose access is half-configured."

    def add_arguments(self, parser):
        parser.add_argument(
            "--fix", action="store_true",
            help="Apply the safe repairs (missing 'school' role, missing/foreign active "
                 "school, and leftovers of a membership that no longer exists).",
        )

    def handle(self, *args, **options):
        fix = options["fix"]
        members = {m.profile_id for m in SchoolMembership.objects.only("profile_id")}
        users = (
            User.objects
            .filter(Q(roles__contains=["school"]) | Q(pk__in=members))
            .prefetch_related("school_memberships__school")
            .order_by("email")
        )

        missing_role, missing_active, stale_active, no_membership = [], [], [], []

        for user in users:
            memberships = list(user.school_memberships.all())
            if not memberships:
                # Ruolo scuola senza nessuna membership: il pannello risponde
                # 403 ovunque. Non possiamo indovinare quale scuola dargli —
                # ma possiamo togliere i residui, che è la stessa cosa che fa
                # ora schools/signals.py quando una membership viene cancellata.
                no_membership.append(user)
                continue

            if "school" not in (user.roles or []):
                missing_role.append((user, memberships))
            if not user.active_school_id:
                missing_active.append((user, memberships))
            elif not any(m.school_id == user.active_school_id for m in memberships):
                stale_active.append((user, memberships))

        self._report("Membership presente, ruolo 'school' assente "
                     "(il frontend lo rimanda alla sua dashboard)", missing_role)
        self._report("Membership presente, nessuna scuola attiva "
                     "(le API non hanno una scuola su cui scope-are)", missing_active)
        self._report("Scuola attiva su cui NON è membro "
                     "(sta lavorando su una scuola che non gli appartiene)", stale_active)

        if no_membership:
            self.stdout.write(self.style.WARNING(
                f"\n{len(no_membership)} profilo/i con ruolo 'school' e nessuna membership "
                "(il pannello risponde 403 ovunque):"))
            for user in no_membership:
                self.stdout.write(f"  - {user.email} (sub-ruolo piatto: {user.school_sub_role or '—'})")
            self.stdout.write(
                "  --fix toglie i residui (ruolo 'school', scuola attiva, sub-ruolo piatto).\n"
                "  Per ridargli accesso serve una membership: dal Team nel pannello scuola\n"
                "  oppure dall'admin Django (School memberships)."
            )

        if not fix:
            repairable = len(missing_role) + len(missing_active) + len(stale_active) + len(no_membership)
            if repairable:
                self.stdout.write(self.style.NOTICE(
                    f"\n{repairable} riparabile/i automaticamente — rilancia con --fix."))
            else:
                self.stdout.write(self.style.SUCCESS("\nNessuna incoerenza."))
            return

        repaired = 0
        for user, memberships in missing_role:
            user.roles = [*(user.roles or []), "school"]
            fields = ["roles"]
            if not user.role:
                user.role = "school"
                fields.append("role")
            user.save(update_fields=fields)
            self.stdout.write(f"  ✓ {user.email}: ruolo 'school' aggiunto")
            repaired += 1

        for user, memberships in missing_active + stale_active:
            # La più vecchia: deterministico, e per chi ne ha una sola è l'unica.
            # Per stale_active non è una scelta di permessi: la scuola dove si
            # trova ora gli è comunque chiusa, e qui lo rimandiamo soltanto su
            # una di cui è già membro.
            school = min(memberships, key=lambda m: m.created_at).school
            was = user.active_school
            user.active_school = school
            user.save(update_fields=["active_school"])
            origin = f"{was.name} (non è suo) → " if was else ""
            self.stdout.write(f"  ✓ {user.email}: scuola attiva {origin}{school.name}")
            repaired += 1

        for user in no_membership:
            fields = []
            if user.active_school_id:
                user.active_school = None
                fields.append("active_school")
            if "school" in (user.roles or []):
                user.roles = [r for r in user.roles if r != "school"]
                fields.append("roles")
            if user.role == "school":
                user.role = user.roles[0] if user.roles else ""
                fields.append("role")
            if user.school_sub_role:
                user.school_sub_role = ""
                fields.append("school_sub_role")
            if fields:
                user.save(update_fields=fields)
                self.stdout.write(f"  ✓ {user.email}: residui rimossi ({', '.join(fields)})")
                repaired += 1

        self.stdout.write(self.style.SUCCESS(f"\n{repaired} profilo/i riparato/i."))

    def _report(self, title, rows):
        if not rows:
            return
        self.stdout.write(self.style.WARNING(f"\n{len(rows)} — {title}:"))
        for user, memberships in rows:
            schools = ", ".join(f"{m.school.name} ({m.sub_role})" for m in memberships)
            self.stdout.write(f"  - {user.email}  →  {schools}")
