"""Discount codes: two owners (HQ for the shop, each school for its packages)
and one set of rules — scadenza, ambito, minimo d'ordine, limite di usi.
"""
import uuid
from decimal import Decimal

import pytest
from django.utils import timezone

from commerce.discounts import DiscountError, mark_redeemed, resolve_discount
from commerce.models import DiscountCode
from schools.models import School

pytestmark = pytest.mark.django_db


@pytest.fixture
def school():
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")


def make(**kw):
    defaults = dict(name="Promo", code="PROMO10", type="percentage", value=10, school=None)
    return DiscountCode.objects.create(**{**defaults, **kw})


def test_no_code_is_not_an_error():
    assert resolve_discount(None, school=None, scope="shop", subtotal=Decimal("50")) == (None, Decimal("0"))


def test_percentage_and_fixed(school):
    make(school=school, code="TEN")
    _, off = resolve_discount("TEN", school=school, scope="packages", subtotal=Decimal("80"))
    assert off == Decimal("8")

    make(school=school, code="FIVE", type="fixed", value=5)
    _, off = resolve_discount("FIVE", school=school, scope="packages", subtotal=Decimal("80"))
    assert off == Decimal("5")


def test_code_is_case_insensitive_and_trimmed(school):
    make(school=school, code="ESTATE")
    dc, _ = resolve_discount("  estate ", school=school, scope="packages", subtotal=Decimal("10"))
    assert dc.code == "ESTATE"


def test_discount_never_exceeds_the_price(school):
    make(school=school, code="BIG", type="fixed", value=500)
    _, off = resolve_discount("BIG", school=school, scope="packages", subtotal=Decimal("60"))
    assert off == Decimal("60")


def test_hq_code_does_not_work_on_a_school_package(school):
    make(code="HQONLY")  # school = None → HQ shop
    with pytest.raises(DiscountError, match="invalid_discount_code"):
        resolve_discount("HQONLY", school=school, scope="packages", subtotal=Decimal("50"))


def test_school_code_does_not_work_in_the_hq_shop(school):
    make(school=school, code="MYSCHOOL")
    with pytest.raises(DiscountError, match="invalid_discount_code"):
        resolve_discount("MYSCHOOL", school=None, scope="shop", subtotal=Decimal("50"))


def test_a_school_code_does_not_work_at_another_school(school):
    other = School.objects.create(name="O", slug=f"o-{uuid.uuid4().hex[:8]}", email="o@example.com")
    make(school=school, code="SHARED")
    with pytest.raises(DiscountError, match="invalid_discount_code"):
        resolve_discount("SHARED", school=other, scope="packages", subtotal=Decimal("50"))


def test_inactive_expired_and_scope(school):
    make(school=school, code="OFF", active=False)
    with pytest.raises(DiscountError, match="invalid_discount_code"):
        resolve_discount("OFF", school=school, scope="packages", subtotal=Decimal("50"))

    make(school=school, code="OLD", expires_at=timezone.now() - timezone.timedelta(days=1))
    with pytest.raises(DiscountError, match="discount_code_expired"):
        resolve_discount("OLD", school=school, scope="packages", subtotal=Decimal("50"))

    make(school=school, code="SHOPONLY", valid_for="shop")
    with pytest.raises(DiscountError, match="discount_code_wrong_scope"):
        resolve_discount("SHOPONLY", school=school, scope="packages", subtotal=Decimal("50"))


def test_minimum_order_and_max_uses(school):
    make(school=school, code="MIN50", minimum_order=50)
    with pytest.raises(DiscountError, match="discount_code_minimum_not_met"):
        resolve_discount("MIN50", school=school, scope="packages", subtotal=Decimal("40"))
    assert resolve_discount("MIN50", school=school, scope="packages", subtotal=Decimal("50"))[1] == Decimal("5")

    dc = make(school=school, code="FIRST3", max_uses=3, usage_count=2)
    mark_redeemed(dc.id)
    with pytest.raises(DiscountError, match="discount_code_exhausted"):
        resolve_discount("FIRST3", school=school, scope="packages", subtotal=Decimal("50"))


def test_hq_and_school_panels_see_only_their_own_codes(school):
    """Each panel manages its own codes: HQ never lists a school's, and a
    school never lists HQ's (nor another school's)."""
    from django.contrib.auth import get_user_model
    from rest_framework.test import APIClient

    from accounts.models import Role

    User = get_user_model()
    hq_user = User.objects.create(email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ)
    school_user = User.objects.create(
        email=f"sc-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, active_school=school
    )

    hq = APIClient()
    hq.force_authenticate(user=hq_user)
    sc = APIClient()
    sc.force_authenticate(user=school_user)

    assert hq.post("/api/hq/discount-codes/", {"name": "HQ", "code": "hqsummer", "value": 10}, format="json").status_code == 201
    assert sc.post("/api/school/discount-codes/", {"name": "Scuola", "code": "myschool", "value": 15}, format="json").status_code == 201

    hq_codes = {c["code"] for c in hq.get("/api/hq/discount-codes/").json()}
    sc_codes = {c["code"] for c in sc.get("/api/school/discount-codes/").json()}
    assert hq_codes == {"HQSUMMER"}  # stored uppercase
    assert sc_codes == {"MYSCHOOL"}

    # Same code string may exist on both sides, but not twice on one side.
    assert hq.post("/api/hq/discount-codes/", {"name": "Dup", "code": "HQSUMMER", "value": 5}, format="json").status_code == 400


def test_student_check_endpoint_previews_the_discount(school):
    """Quello che l'allieva vede prima di pagare è quello che paga: stesso
    motore del checkout, stessi rifiuti."""
    from django.contrib.auth import get_user_model
    from rest_framework.test import APIClient

    from students.models import Student

    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    Student.objects.create(user=user, name="Stu", school=school)
    api = APIClient()
    api.force_authenticate(user=user)

    make(school=school, code="SPRING", value=20)
    res = api.post("/api/student/discount-code/check/", {
        "code": "spring", "scope": "packages", "school_id": str(school.id), "subtotal": "100",
    }, format="json")
    assert res.status_code == 200
    assert Decimal(res.json()["amount_off"]) == Decimal("20")
    assert Decimal(res.json()["total"]) == Decimal("80")

    # Lo stesso codice nel negozio HQ non esiste.
    res = api.post("/api/student/discount-code/check/", {
        "code": "spring", "scope": "shop", "subtotal": "100",
    }, format="json")
    assert res.status_code == 400
    assert res.json()["error"] == "invalid_discount_code"


def test_code_limited_to_specific_items(school):
    """Un codice legato a un pacchetto/prodotto sconta solo quello: sulle
    altre righe non si applica, e da solo non è spendibile."""
    pkg_a, pkg_b = str(uuid.uuid4()), str(uuid.uuid4())
    make(school=school, code="SOLOA", value=10, applies_to=[pkg_a])

    _, off = resolve_discount("SOLOA", school=school, scope="packages",
                              lines=[{"id": pkg_a, "amount": Decimal("100")}])
    assert off == Decimal("10")

    with pytest.raises(DiscountError, match="discount_code_not_applicable"):
        resolve_discount("SOLOA", school=school, scope="packages",
                         lines=[{"id": pkg_b, "amount": Decimal("100")}])


def test_in_a_mixed_cart_only_the_matching_lines_are_discounted(school):
    """Carrello con due prodotti, codice valido su uno solo: lo sconto si
    calcola su quella riga, non sul totale."""
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    make(code="TSHIRT", value=50, applies_to=[a])  # HQ, negozio

    _, off = resolve_discount("TSHIRT", school=None, scope="shop", lines=[
        {"id": a, "amount": Decimal("40")},   # scontato del 50% → 20
        {"id": b, "amount": Decimal("100")},  # non toccato
    ])
    assert off == Decimal("20")


def test_fixed_amount_never_exceeds_the_matching_lines(school):
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    make(code="MENO30", type="fixed", value=30, applies_to=[a])
    _, off = resolve_discount("MENO30", school=None, scope="shop", lines=[
        {"id": a, "amount": Decimal("20")},
        {"id": b, "amount": Decimal("500")},
    ])
    assert off == Decimal("20")


def test_minimum_order_looks_at_the_whole_basket(school):
    """La spesa minima si misura sul totale del carrello, anche se lo sconto
    riguarda una riga sola."""
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    make(code="MIN100", value=10, minimum_order=100, applies_to=[a])
    _, off = resolve_discount("MIN100", school=None, scope="shop", lines=[
        {"id": a, "amount": Decimal("40")},
        {"id": b, "amount": Decimal("70")},
    ])
    assert off == Decimal("4")


def test_hq_codes_are_not_readable_by_students(school):
    """Un codice promozionale vale finché non è pubblico: nessuno può
    sfogliare l'elenco dei codici HQ se non è HQ."""
    from django.contrib.auth import get_user_model
    from rest_framework.test import APIClient

    from students.models import Student

    make(code="SEGRETO", value=50)  # HQ

    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    Student.objects.create(user=user, name="Stu", school=school)
    api = APIClient()
    api.force_authenticate(user=user)

    assert api.get("/api/hq/discount-codes/").json() == []
    assert api.post("/api/hq/discount-codes/", {"name": "X", "code": "X1", "value": 5}, format="json").status_code == 403


def test_applies_to_must_come_from_the_owner_catalogue(school):
    """Legare un codice a un pacchetto di un'altra scuola (o a un id
    inventato) è un errore, non un codice che poi non funziona mai."""
    from django.contrib.auth import get_user_model
    from rest_framework.test import APIClient

    from accounts.models import Role
    from catalog.models import Package

    other = School.objects.create(name="O", slug=f"o-{uuid.uuid4().hex[:8]}", email="o@example.com")
    mine = Package.objects.create(school=school, credits=10, price=100)
    theirs = Package.objects.create(school=other, credits=10, price=100)

    user = get_user_model().objects.create(
        email=f"sc-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, active_school=school
    )
    api = APIClient()
    api.force_authenticate(user=user)

    ok = api.post("/api/school/discount-codes/",
                  {"name": "Ok", "code": "MIO", "value": 10, "applies_to": [str(mine.id)]}, format="json")
    assert ok.status_code == 201

    for bad in ([str(theirs.id)], [str(uuid.uuid4())], ["non-un-id"]):
        res = api.post("/api/school/discount-codes/",
                       {"name": "No", "code": f"NO{uuid.uuid4().hex[:4]}", "value": 10, "applies_to": bad},
                       format="json")
        assert res.status_code == 400, bad

    # E il codice non può cambiare proprietario in un secondo momento.
    moved = api.patch(f"/api/school/discount-codes/{ok.json()['id']}/",
                      {"school": str(other.id)}, format="json")
    assert moved.status_code == 200
    assert moved.json()["school"] == str(school.id)


def test_the_discount_is_rounded_to_the_cent(school):
    """Stripe lavora in centesimi: quello che l'allieva vede prima di pagare
    deve essere esattamente quello che paga."""
    make(school=school, code="TERZO", value=33)
    _, off = resolve_discount("TERZO", school=school, scope="packages",
                              lines=[{"id": str(uuid.uuid4()), "amount": Decimal("10")}])
    assert off == Decimal("3.30")

    make(school=school, code="SETTE", value=7)
    _, off = resolve_discount("SETTE", school=school, scope="packages",
                              lines=[{"id": str(uuid.uuid4()), "amount": Decimal("99.99")}])
    assert off == Decimal("7.00")  # 6.9993 → 7.00, non 6.99 troncato
