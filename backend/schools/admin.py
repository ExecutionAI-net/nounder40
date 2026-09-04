from django.apps import apps as django_apps
from django.contrib import admin, messages

from .models import School, SchoolMembership, SchoolRole, SchoolStudent


@admin.register(School)
class SchoolAdmin(admin.ModelAdmin):
    list_display = ("name", "city", "country", "active", "stripe_onboarding_complete", "created_at")
    list_filter = ("active", "country", "stripe_onboarding_complete")
    search_fields = ("name", "slug", "city", "email", "vat_number")
    ordering = ("name",)


@admin.register(SchoolRole)
class SchoolRoleAdmin(admin.ModelAdmin):
    """La matrice ruolo → sezioni che il SchoolSectionGuardMiddleware applica
    alle rotte /api/school/*. Un sub_role senza riga qui NON viene bloccato:
    il guard fa fail-open (vedi core/section_guard.py)."""

    list_display = ("key", "label", "builtin", "permission_count")
    list_filter = ("builtin",)
    search_fields = ("key", "label")

    @admin.display(description="sections", ordering="key")
    def permission_count(self, obj):
        return f"{len(obj.permissions)} — {', '.join(obj.permissions[:6])}"


@admin.register(SchoolMembership)
class SchoolMembershipAdmin(admin.ModelAdmin):
    """Chi appartiene a quale scuola, con quale sub-ruolo.

    Attenzione: la membership da sola NON dà accesso al pannello scuola. Servono
    anche `roles` con "school" (lo legge la guardia di rotta del frontend) e
    `active_school` sul profilo (è quello che scope-a le query lato API, vedi
    core/viewsets.active_school_id). Il flusso di invito del pannello scuola
    (POST /api/school/team/) scrive tutti e tre; salvando qui li allineiamo allo
    stesso modo, altrimenti l'utente resta membro sulla carta e fuori dai fatti.
    """

    list_display = ("school", "member_email", "member_name", "sub_role", "is_active_school", "created_at")
    list_filter = ("sub_role", "school")
    search_fields = ("profile__email", "profile__full_name", "profile__first_name",
                     "profile__last_name", "school__name", "school__city")
    autocomplete_fields = ("profile", "school")
    ordering = ("-created_at",)
    list_select_related = ("profile", "school")

    @admin.display(description="email", ordering="profile__email")
    def member_email(self, obj):
        return obj.profile.email

    @admin.display(description="name", ordering="profile__full_name")
    def member_name(self, obj):
        return obj.profile.full_name or "—"

    @admin.display(description="active school?", boolean=True)
    def is_active_school(self, obj):
        """Falso = l'utente è membro ma sta lavorando su un'altra scuola (o su
        nessuna): le API risponderanno con i dati di quell'altra, non di questa."""
        return obj.profile.active_school_id == obj.school_id

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)

        user = obj.profile
        changed = []
        if "school" not in (user.roles or []):
            user.roles = [*(user.roles or []), "school"]
            changed.append("roles")
        if not user.role:
            user.role = "school"
            changed.append("role")
        if not user.active_school_id:
            user.active_school_id = obj.school_id
            changed.append("active_school")

        if changed:
            user.save(update_fields=changed)
            self.message_user(
                request,
                f"{user.email}: aggiornato anche il profilo ({', '.join(changed)}) — "
                "senza questo la membership non dà accesso al pannello scuola.",
                messages.WARNING,
            )
        elif user.active_school_id != obj.school_id:
            self.message_user(
                request,
                f"{user.email} ha come scuola attiva un'altra ({user.active_school}). "
                "La membership è valida, ma per lavorare su questa deve cambiarla "
                "dal selettore di scuola (o va cambiata qui nel profilo utente).",
                messages.INFO,
            )

    def delete_model(self, request, obj):
        email = obj.profile.email
        super().delete_model(request, obj)  # schools/signals.py revoca il resto
        self._report_revocation(request, [email])

    def delete_queryset(self, request, queryset):
        emails = list(queryset.values_list("profile__email", flat=True))
        super().delete_queryset(request, queryset)
        self._report_revocation(request, emails)

    def _report_revocation(self, request, emails):
        """La cancellazione non toglie solo la riga: chi resta senza nessuna
        membership perde anche il ruolo 'school' e la scuola attiva. È l'effetto
        che si voleva, ma senza dirlo non si vede da nessuna parte."""
        User = self.model._meta.get_field("profile").related_model
        stripped = [
            u.email for u in User.objects.filter(email__in=emails)
            if not u.school_memberships.exists()
        ]
        if stripped:
            self.message_user(
                request,
                f"Accesso al pannello scuola revocato per: {', '.join(stripped)} "
                "(nessuna membership residua: rimossi ruolo 'school' e scuola attiva).",
                messages.WARNING,
            )


@admin.register(SchoolStudent)
class SchoolStudentAdmin(admin.ModelAdmin):
    list_display = ("school", "student", "free_lesson_used", "enrolled_at")
    list_filter = ("school", "free_lesson_used")
    search_fields = ("student__name", "student__email", "school__name")
    ordering = ("-enrolled_at",)
    list_select_related = ("school", "student")


# Gli altri modelli dell'app restano sull'admin di default (Fase 1): si
# registrano solo se nessun ModelAdmin esplicito qui sopra li ha già presi.
for _model in django_apps.get_app_config("schools").get_models():
    try:
        admin.site.register(_model)
    except admin.sites.AlreadyRegistered:
        pass
