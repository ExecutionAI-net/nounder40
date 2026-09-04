"""Il comando che trova i profili scuola configurati a metà.

Le due classi riparabili sono esattamente quelle che l'admin scriveva a metà
prima di SchoolMembershipAdmin.save_model; le altre due si riportano soltanto,
perché sceglierne l'esito è una decisione di permessi.
"""
import uuid
from io import StringIO

import pytest
from django.core.management import call_command

from accounts.models import Role, User
from schools.models import School, SchoolMembership

pytestmark = pytest.mark.django_db


def _school(name):
    return School.objects.create(
        name=name, slug=f"s-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com",
    )


def _user(email, **kwargs):
    return User.objects.create(email=f"{email}-{uuid.uuid4().hex[:6]}@example.com", **kwargs)


def _run(*flags):
    out = StringIO()
    call_command("audit_school_memberships", *flags, stdout=out)
    return out.getvalue()


def test_a_clean_setup_reports_nothing():
    school = _school("Pulita")
    user = _user("ok", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school)
    SchoolMembership.objects.create(profile=user, school=school, sub_role="admin")

    assert "Nessuna incoerenza" in _run()


def test_students_are_not_flagged():
    """`active_school` è popolato anche sulle allieve: senza questo filtro ogni
    allieva della piattaforma risulterebbe un'anomalia."""
    school = _school("Con allieve")
    _user("allieva", role=Role.STUDENT, roles=[Role.STUDENT], active_school=school)

    assert "Nessuna incoerenza" in _run()


def test_missing_role_and_active_school_are_found_and_repaired():
    school = _school("Da riparare")
    user = _user("mezzo")  # membership e basta: il caso dell'admin
    SchoolMembership.objects.create(profile=user, school=school, sub_role="staff")

    report = _run()
    assert user.email in report
    assert "--fix" in report

    _run("--fix")
    user.refresh_from_db()
    assert "school" in user.roles
    assert user.active_school_id == school.id
    assert user.effective_school_sub_role() == "staff"


def test_repair_picks_the_oldest_membership_as_active_school():
    first, second = _school("Prima"), _school("Seconda")
    user = _user("due", role=Role.SCHOOL, roles=[Role.SCHOOL])
    older = SchoolMembership.objects.create(profile=user, school=first, sub_role="owner")
    newer = SchoolMembership.objects.create(profile=user, school=second, sub_role="staff")
    newer.created_at = older.created_at.replace(year=older.created_at.year + 1)
    newer.save(update_fields=["created_at"])

    _run("--fix")
    user.refresh_from_db()
    assert user.active_school_id == first.id


def test_an_active_school_without_membership_is_reported_but_not_touched():
    """Spostarlo significa decidere su quale scuola deve lavorare: si riporta."""
    member_of, working_on = _school("Membro qui"), _school("Lavora qui")
    user = _user("estraneo", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=working_on)
    SchoolMembership.objects.create(profile=user, school=member_of, sub_role="staff")

    assert "NON è membro" in _run()

    _run("--fix")
    user.refresh_from_db()
    assert user.active_school_id == working_on.id  # invariato


def test_a_school_role_without_any_membership_is_reported_but_not_touched():
    user = _user("senza", role=Role.SCHOOL, roles=[Role.SCHOOL], school_sub_role="admin")

    report = _run()
    assert "nessuna membership" in report
    assert "Non riparabile automaticamente" in report

    _run("--fix")
    assert not SchoolMembership.objects.filter(profile=user).exists()
