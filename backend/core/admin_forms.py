"""Tendine per i sub-ruoli nell'admin.

`HQMember.sub_role` e `SchoolMembership.sub_role` sono CharField liberi, ma i
valori validi non sono liberi affatto: sono le chiavi di `HQRole` / `SchoolRole`,
la matrice che decide quali sezioni vede quel ruolo. Scritti a mano, un refuso
non dà errore — dà un ruolo che la matrice non conosce, e il section guard lo
tratta di conseguenza. Meglio sceglierli da un elenco.

L'elenco si legge a ogni apertura della scheda, non all'avvio: la matrice è
editabile da HQ e un ruolo aggiunto oggi deve comparire subito.
"""

from django import forms


def permissions_array_form(model, field_name="permissions"):
    """ModelForm for a role model whose `field_name` is a Postgres ArrayField
    of permission keys, rendered by the admin as a bare comma-separated text
    widget.

    Nothing stops someone pasting a JSON-looking value like `["dashboard"]`
    into that widget: the ArrayField splits on commas only, so the whole
    string (brackets, quotes and all) is silently accepted as one garbage
    permission key — the role ends up with a broken list and no error is
    ever shown. Reject anything containing `[`, `]` or `"`, and explain the
    expected format so the mistake doesn't happen again.

    No `Meta` is declared here on purpose (same reason as `role_choice_form`
    above): admin's `get_form()` computes `fields`/`exclude` itself and feeds
    them into `modelform_factory`, and a base form that already fixes
    `Meta.fields` trips `modelform_defines_fields()` into leaving admin's own
    `fields` as `None` — which then collides with `exclude=None` and raises
    `ImproperlyConfigured` on the generated Meta. Setting the help text in
    `__init__` and validating in `clean_<field_name>` avoids Meta entirely.
    """

    clean_method_name = f"clean_{field_name}"

    def _clean(self):
        values = self.cleaned_data.get(field_name) or []
        bad = [v for v in values if any(ch in v for ch in ("[", "]", '"'))]
        if bad:
            raise forms.ValidationError(
                "Looks like JSON was pasted in, not a comma-separated list "
                f"({', '.join(bad)!r}). Use plain permission keys separated by "
                'commas, e.g. "dashboard, bookings, students" — no brackets or quotes.'
            )
        return values

    def _init(self, *args, **kwargs):
        forms.ModelForm.__init__(self, *args, **kwargs)
        self.fields[field_name].help_text = (
            "Comma-separated permission keys (the section names in the nav), "
            'e.g. "dashboard, bookings, students". Do not paste JSON — no '
            "brackets or quotes."
        )

    attrs = {"__init__": _init, clean_method_name: _clean}
    return type("PermissionsArrayForm", (forms.ModelForm,), attrs)


def role_choice_form(role_model, field_name="sub_role"):
    """ModelForm che rende `field_name` una tendina sui ruoli di `role_model`."""

    class RoleChoiceForm(forms.ModelForm):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            old = self.fields[field_name]
            current = self.initial.get(field_name) or ""

            choices = [
                (role.key, f"{role.label} ({role.key})")
                for role in role_model.objects.order_by("label")
            ]
            if current and current not in {key for key, _ in choices}:
                # Ruolo che la matrice non ha (più): mostrarlo comunque. Se lo
                # nascondessimo, aprire la scheda per cambiare tutt'altro lo
                # riscriverebbe di nascosto al primo salvataggio.
                choices.insert(0, (current, f"{current} — non in matrice"))
            if not choices:
                choices = [(current, current or "— nessun ruolo configurato —")]

            self.fields[field_name] = forms.ChoiceField(
                choices=choices,
                required=old.required,
                label=old.label,
                help_text=old.help_text,
            )

    return RoleChoiceForm
