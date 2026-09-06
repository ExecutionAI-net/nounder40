"""HQRole.permissions / SchoolRole.permissions are Postgres ArrayFields, and
the admin renders them as a bare comma-separated text widget. Pasting a
JSON-looking value (e.g. `["dashboard"]`) used to be silently accepted as one
garbage permission key — no error, no parsing, just a broken role. The admin
form now rejects entries containing `[`, `]` or `"`.
"""
import pytest
from django.contrib.admin.sites import site
from django.contrib.auth import get_user_model
from django.test import RequestFactory

from accounts.models import HQRole
from schools.models import SchoolRole

pytestmark = pytest.mark.django_db


@pytest.fixture
def request_():
    req = RequestFactory().get("/admin/")
    req.user = get_user_model()(email="su@example.com", is_superuser=True, is_staff=True)
    return req


@pytest.mark.parametrize("model", [HQRole, SchoolRole])
def test_pasted_json_is_rejected(request_, model):
    form = site._registry[model].get_form(request_)({
        "key": "ops", "label": "Ops", "permissions": '["dashboard"]',
    })
    assert not form.is_valid()
    assert "permissions" in form.errors


@pytest.mark.parametrize("model", [HQRole, SchoolRole])
def test_plain_comma_separated_keys_are_accepted(request_, model):
    form = site._registry[model].get_form(request_)({
        "key": "ops", "label": "Ops", "permissions": "dashboard, bookings, students",
        "created_at_0": "2026-01-01", "created_at_1": "00:00:00",
    })
    assert form.is_valid(), form.errors
    role = form.save()
    assert role.permissions == ["dashboard", "bookings", "students"]


@pytest.mark.parametrize("model", [HQRole, SchoolRole])
def test_permissions_field_has_help_text(request_, model):
    form = site._registry[model].get_form(request_)()
    help_text = form.fields["permissions"].help_text
    assert "comma" in help_text.lower()
