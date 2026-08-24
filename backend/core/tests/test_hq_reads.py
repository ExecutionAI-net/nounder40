"""Gli elenchi HQ non sono pubblici: per molto tempo la classe base guardava
solo le scritture, quindi qualsiasi utente autenticato (allieva compresa)
poteva sfogliare pacchetti HQ, prodotti, scuole e codici sconto.
"""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Role

pytestmark = pytest.mark.django_db


@pytest.fixture
def student_client():
    user = get_user_model().objects.create(
        email=f"stu-{uuid.uuid4().hex[:8]}@example.com", role=Role.STUDENT, roles=[Role.STUDENT]
    )
    api = APIClient()
    api.force_authenticate(user=user)
    return api


@pytest.fixture
def hq_client():
    user = get_user_model().objects.create(
        email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ]
    )
    api = APIClient()
    api.force_authenticate(user=user)
    return api


@pytest.mark.parametrize("path", [
    "/api/hq/packages/",
    "/api/hq/shop/",
    "/api/hq/schools/",
    "/api/hq/discount-codes/",
    "/api/hq/school-permissions/",
])
def test_hq_lists_are_closed_to_non_hq(student_client, hq_client, path):
    assert student_client.get(path).status_code == 403
    assert hq_client.get(path).status_code == 200


def test_the_lesson_type_catalogue_stays_readable(student_client):
    """Unica eccezione: il catalogo Metodo, che scuole e insegnanti leggono
    dalla loro rotta (stessa viewset)."""
    assert student_client.get("/api/school/lesson-types/").status_code == 200
    assert student_client.get("/api/hq/lesson-types/").status_code == 200
