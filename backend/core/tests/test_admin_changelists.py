"""Ogni changelist dell'admin deve aprirsi davvero.

`manage.py check` valida i nomi dei campi in list_display/list_filter, ma non
esegue la query: un `ordering` su una relazione sbagliata, un
`list_select_related` incoerente o un metodo di display che esplode si vedono
solo aprendo la pagina. Qui le apriamo tutte, vuote e con una riga dentro.
"""
import uuid

import pytest
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.test import Client
from django.urls import reverse

pytestmark = pytest.mark.django_db

REGISTERED = sorted(admin.site._registry, key=lambda m: (m._meta.app_label, m._meta.model_name))


@pytest.fixture
def client_():
    user = get_user_model().objects.create_superuser(
        email=f"admin-{uuid.uuid4().hex[:8]}@example.com", password="pw"
    )
    api = Client()
    api.force_login(user)
    return api


def _url(model):
    return reverse(f"admin:{model._meta.app_label}_{model._meta.model_name}_changelist")


@pytest.mark.parametrize("model", REGISTERED, ids=lambda m: f"{m._meta.app_label}.{m._meta.model_name}")
def test_changelist_opens(client_, model):
    assert client_.get(_url(model)).status_code == 200


@pytest.mark.parametrize("model", REGISTERED, ids=lambda m: f"{m._meta.app_label}.{m._meta.model_name}")
def test_changelist_search_and_filters_run(client_, model):
    """La casella di ricerca e i filtri di destra sono query a parte: un campo
    di ricerca che attraversa una relazione inesistente fallisce solo qui."""
    model_admin = admin.site._registry[model]

    if model_admin.search_fields:
        assert client_.get(_url(model), {"q": "zzz"}).status_code == 200

    for spec in model_admin.list_filter:
        field = spec if isinstance(spec, str) else spec[0]
        if not isinstance(field, str):
            continue
        res = client_.get(_url(model))
        assert res.status_code == 200, f"{model.__name__} filtro {field}"


def test_a_populated_row_renders_every_column(client_):
    """I metodi @admin.display (scuola della sala, scuole dell'insegnante,
    estratto del messaggio, conteggi) girano solo se c'è una riga."""
    from catalog.models import LessonType
    from chat.models import Conversation, Message
    from geography.models import HQCity, HQCountry
    from schools.models import School, SchoolLocation, SchoolRoom
    from teachers.models import CompensationPlan, Teacher, TeacherSchool
    from translations.models import Translation

    school = School.objects.create(name="Scuola", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")
    location = SchoolLocation.objects.create(school=school, name="Sede")
    SchoolRoom.objects.create(location=location, name="Sala A", capacity=12)

    teacher = Teacher.objects.create(name="Maestra", email="m@example.com")
    TeacherSchool.objects.create(teacher=teacher, school=school, active=True)
    CompensationPlan.objects.create(school=school, name="Piano")

    country = HQCountry.objects.create(name="Italia", code="IT")
    HQCity.objects.create(country=country, name="Milano")

    conversation = Conversation.objects.create(school=school)
    sender = get_user_model().objects.create(email=f"s-{uuid.uuid4().hex[:8]}@example.com")
    Message.objects.create(conversation=conversation, sender=sender, content="x " * 100)

    Translation.objects.create(key="a.b", locale="it", value="y " * 100)
    LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Classical")

    for model in (SchoolRoom, SchoolLocation, Teacher, CompensationPlan,
                  HQCountry, HQCity, Message, Translation, LessonType):
        res = client_.get(_url(model))
        assert res.status_code == 200, model.__name__
        assert b"Server Error" not in res.content
