"""Creare una SchoolMembership dall'admin deve dare accesso davvero.

La membership da sola non basta: la guardia di rotta del frontend legge
`user.roles` e lo scoping delle API legge `user.active_school_id`. Prima di
questo allineamento un HQ che aggiungeva la riga dall'admin otteneva un membro
che risultava tale nel database e non poteva entrare in nessuna schermata.
"""
import uuid

import pytest
from django.contrib.admin.sites import AdminSite
from django.test import RequestFactory

from accounts.models import Role, User
from core.viewsets import active_school_id
from schools.admin import SchoolMembershipAdmin
from schools.models import School, SchoolMembership

pytestmark = pytest.mark.django_db


def _school(name="Danza Milano"):
    return School.objects.create(
        name=name, slug=f"s-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com",
    )


def _user(**kwargs):
    return User.objects.create(email=f"u-{uuid.uuid4().hex[:8]}@example.com", **kwargs)


def _save_through_admin(membership):
    """Esegue lo stesso percorso del bottone "Save" nell'admin."""
    model_admin = SchoolMembershipAdmin(SchoolMembership, AdminSite())
    request = RequestFactory().post("/admin/schools/schoolmembership/add/")
    request.user = _user(role=Role.HQ, roles=[Role.HQ], is_staff=True, is_superuser=True)
    # message_user ha bisogno dello storage dei messaggi
    request._messages = type("Storage", (), {"add": lambda self, *a, **k: None})()
    model_admin.save_model(request, membership, form=None, change=False)


def test_saving_a_membership_grants_the_school_role_and_active_school():
    school, user = _school(), _user()
    membership = SchoolMembership(profile=user, school=school, sub_role="staff")

    _save_through_admin(membership)

    user.refresh_from_db()
    assert "school" in user.roles           # guardia di rotta del frontend
    assert user.active_school_id == school.id  # scoping delle query API
    assert active_school_id(user) == school.id
    assert user.effective_school_sub_role() == "staff"


def test_an_existing_role_is_kept_and_school_is_appended():
    """Un'allieva promossa a staff resta un'allieva: i ruoli si sommano."""
    school = _school()
    user = _user(role=Role.STUDENT, roles=[Role.STUDENT])

    _save_through_admin(SchoolMembership(profile=user, school=school, sub_role="admin"))

    user.refresh_from_db()
    assert set(user.roles) == {"student", "school"}
    assert user.role == Role.STUDENT  # il ruolo primario non viene sovrascritto


def test_a_second_membership_does_not_steal_the_active_school():
    """Chi lavora già su una scuola non viene spostato aggiungendone un'altra:
    il cambio resta una scelta esplicita (selettore di scuola)."""
    first, second = _school("Prima"), _school("Seconda")
    user = _user(role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=first)
    SchoolMembership.objects.create(profile=user, school=first, sub_role="owner")

    _save_through_admin(SchoolMembership(profile=user, school=second, sub_role="staff"))

    user.refresh_from_db()
    assert user.active_school_id == first.id
    assert user.effective_school_sub_role() == "owner"  # ancora quello di "Prima"
    assert SchoolMembership.objects.filter(profile=user).count() == 2


def test_membership_is_readable_in_the_admin_list():
    """Le colonne dell'elenco: prima erano tutte "SchoolMembership object (N)"."""
    school, user = _school(), _user(full_name="Giulia Bianchi")
    membership = SchoolMembership.objects.create(profile=user, school=school, sub_role="staff")
    model_admin = SchoolMembershipAdmin(SchoolMembership, AdminSite())

    assert model_admin.member_email(membership) == user.email
    assert model_admin.member_name(membership) == "Giulia Bianchi"
    assert model_admin.is_active_school(membership) is False
    assert str(membership) == f"{user.email} @ {school.name} (staff)"

    user.active_school = school
    user.save(update_fields=["active_school"])
    membership.refresh_from_db()
    assert model_admin.is_active_school(membership) is True
