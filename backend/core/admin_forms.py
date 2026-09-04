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
