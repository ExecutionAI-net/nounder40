"""Self-registration: first name, last name and phone are mandatory and land
in the split fields on both User and Student (full_name/name are composed)."""
import pytest

from accounts.serializers import RegisterSerializer

pytestmark = pytest.mark.django_db

BASE = {"email": "new@example.com", "password": "Str0ng-passw0rd!", "phone": "+39 392 0618000", "country": "IT"}


def test_first_and_last_name_are_required():
    s = RegisterSerializer(data={**BASE, "full_name": "Maria Rossi"})
    assert not s.is_valid()
    assert {"first_name", "last_name"} <= set(s.errors)


def test_phone_is_required():
    s = RegisterSerializer(data={**BASE, "first_name": "Maria", "last_name": "Rossi", "phone": "+39"})
    assert not s.is_valid() and "phone" in s.errors


def test_names_land_in_split_fields_and_compose_the_display_name():
    s = RegisterSerializer(data={**BASE, "first_name": "  Maria ", "last_name": "Rossi  Bianchi"})
    assert s.is_valid(), s.errors
    user = s.save()
    assert (user.first_name, user.last_name, user.full_name) == ("Maria", "Rossi Bianchi", "Maria Rossi Bianchi")
    assert (user.student.first_name, user.student.last_name, user.student.name) == ("Maria", "Rossi Bianchi", "Maria Rossi Bianchi")
