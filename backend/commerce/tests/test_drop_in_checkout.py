"""Drop-in: compro la singola lezione e me la ritrovo prenotata.

Copre le tre cose che possono andare storte quando il pagamento e la
prenotazione viaggiano insieme (DROP_IN_BOOKING.md §5.1-5.2):
  - Stripe consegna lo stesso evento due volte  → niente crediti doppi;
  - la lezione si riempie mentre l'allieva paga → credito in tasca, non
    rimborso automatico, e glielo diciamo;
  - un pacchetto normale non deve prenotare da solo (decisione §7.3).
"""
import uuid
from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from bookings.models import Booking
from bookings.services import resolve_drop_in_package
from catalog.models import Course, Lesson, LessonType, Package
from commerce.models import Transaction
from commerce.services import activate_package_payment
from schools.models import School
from students.models import Student, StudentPackage

pytestmark = pytest.mark.django_db


@pytest.fixture
def school():
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com",
        stripe_account_id="acct_x", stripe_onboarding_complete=True,
    )


@pytest.fixture
def student(school):
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    return Student.objects.create(user=user, name="Stu", school=school)


@pytest.fixture
def lesson(school):
    course = Course.objects.create(school=school, name="C", credit_cost=Decimal("1"), min_booking_notice_hours=0)
    when = timezone.localtime(timezone.now()) + timedelta(days=3)
    return Lesson.objects.create(
        school=school, course=course, date=when.date(), start_time=when.time(),
        end_time=(when + timedelta(hours=1)).time(), max_capacity=5, current_bookings=0,
    )


@pytest.fixture
def drop_in(school):
    return Package.objects.create(
        school=school, credits=Decimal("1"), price=Decimal("19.97"), is_drop_in=True, active=True
    )


def _meta(school, student, package, lesson=None):
    meta = {
        "kind": "package", "school_id": str(school.id),
        "student_id": str(student.id), "item_id": str(package.id),
    }
    if lesson is not None:
        meta["lesson_id"] = str(lesson.id)
    return meta


# --- Fase 0: idempotenza -----------------------------------------------------

def test_the_same_payment_delivered_twice_credits_once(school, student, drop_in):
    meta = _meta(school, student, drop_in)
    first = activate_package_payment(payment_id="pi_1", amount_cents=1997, metadata=meta)
    second = activate_package_payment(payment_id="pi_1", amount_cents=1997, metadata=meta)

    assert first == "package_activated"
    assert second == "already_processed"
    assert Transaction.objects.filter(stripe_payment_id="pi_1").count() == 1
    assert StudentPackage.objects.filter(student=student).count() == 1


def test_a_second_distinct_payment_still_credits(school, student, drop_in):
    meta = _meta(school, student, drop_in)
    activate_package_payment(payment_id="pi_1", amount_cents=1997, metadata=meta)
    activate_package_payment(payment_id="pi_2", amount_cents=1997, metadata=meta)
    assert StudentPackage.objects.filter(student=student).count() == 2


# --- Fase 2: il pagamento prenota -------------------------------------------

def test_paying_books_the_lesson_and_spends_the_credit(school, student, drop_in, lesson):
    result = activate_package_payment(
        payment_id="pi_1", amount_cents=1997, metadata=_meta(school, student, drop_in, lesson)
    )
    assert result == "package_activated_booked"

    booking = Booking.objects.get(student=student, lesson=lesson)
    assert booking.status == "confirmed"
    assert booking.credits_deducted == Decimal("1")
    lesson.refresh_from_db()
    assert lesson.current_bookings == 1
    assert StudentPackage.objects.get(student=student).credits_remaining == Decimal("0")


def test_a_retry_does_not_book_twice(school, student, drop_in, lesson):
    meta = _meta(school, student, drop_in, lesson)
    activate_package_payment(payment_id="pi_1", amount_cents=1997, metadata=meta)
    activate_package_payment(payment_id="pi_1", amount_cents=1997, metadata=meta)

    assert Booking.objects.filter(student=student, lesson=lesson).count() == 1
    lesson.refresh_from_db()
    assert lesson.current_bookings == 1


def test_lesson_filled_up_during_payment_keeps_the_credit(school, student, drop_in, lesson):
    """Nessun rimborso automatico in denaro: il credito resta spendibile."""
    from notifications.models import Notification

    lesson.current_bookings = lesson.max_capacity
    lesson.save(update_fields=["current_bookings"])

    result = activate_package_payment(
        payment_id="pi_1", amount_cents=1997, metadata=_meta(school, student, drop_in, lesson)
    )

    assert result == "package_activated_not_booked_full"
    assert not Booking.objects.filter(student=student, lesson=lesson).exists()
    assert StudentPackage.objects.get(student=student).credits_remaining == Decimal("1")
    assert Transaction.objects.get(stripe_payment_id="pi_1").status == "completed"
    assert Notification.objects.filter(user=student.user, type="drop_in_booking_failed").exists()


def test_a_vanished_lesson_does_not_break_the_activation(school, student, drop_in, lesson):
    meta = _meta(school, student, drop_in, lesson)
    lesson.delete()
    result = activate_package_payment(payment_id="pi_1", amount_cents=1997, metadata=meta)
    assert result == "package_activated_lesson_gone"
    assert StudentPackage.objects.get(student=student).credits_remaining == Decimal("1")


# --- Fase 2: il checkout rivaluta prima di incassare -------------------------

@pytest.fixture
def api(student):
    client = APIClient()
    client.force_authenticate(user=student.user)
    return client


def _checkout(api, package, lesson=None, **extra):
    body = {"kind": "package", "item_id": str(package.id), **extra}
    if lesson is not None:
        body["lesson_id"] = str(lesson.id)
    return api.post("/api/stripe/checkout/", body, format="json")


def test_checkout_carries_the_lesson_into_stripe_metadata(api, drop_in, lesson):
    with patch("commerce.stripe_service.stripe.checkout.Session.create") as create:
        create.return_value = type("S", (), {"url": "https://stripe.test/c", "id": "cs_1"})()
        res = _checkout(api, drop_in, lesson)
    assert res.status_code == 200, res.content
    assert create.call_args.kwargs["metadata"]["lesson_id"] == str(lesson.id)


def test_checkout_refuses_a_lesson_that_is_already_full(api, drop_in, lesson):
    lesson.current_bookings = lesson.max_capacity
    lesson.save(update_fields=["current_bookings"])
    with patch("commerce.stripe_service.stripe.checkout.Session.create") as create:
        res = _checkout(api, drop_in, lesson)
    assert res.status_code == 409
    assert res.json() == {"error": "lesson_not_bookable", "reason": "full"}
    create.assert_not_called()


def test_checkout_refuses_a_cancelled_lesson(api, drop_in, lesson):
    lesson.status = "cancelled"
    lesson.save(update_fields=["status"])
    with patch("commerce.stripe_service.stripe.checkout.Session.create") as create:
        res = _checkout(api, drop_in, lesson)
    assert res.status_code == 409
    assert res.json()["reason"] == "lesson_not_bookable"
    create.assert_not_called()


def test_a_normal_package_cannot_auto_book(api, school, lesson):
    """Decisione §7.3: chi compra dieci lezioni riapre la modale, non prenota."""
    normal = Package.objects.create(school=school, credits=Decimal("10"), price=Decimal("150"), active=True)
    with patch("commerce.stripe_service.stripe.checkout.Session.create") as create:
        res = _checkout(api, normal, lesson)
    assert res.status_code == 400
    assert res.json()["error"] == "lesson_requires_drop_in_package"
    create.assert_not_called()


def test_a_drop_in_that_does_not_cover_the_lesson_is_refused(api, school, lesson):
    other_type = LessonType.objects.create(code=f"t-{uuid.uuid4().hex[:6]}")
    narrow = Package.objects.create(
        school=school, credits=Decimal("1"), price=Decimal("19.97"), is_drop_in=True,
        active=True, allowed_lesson_types=[str(other_type.id)],
    )
    with patch("commerce.stripe_service.stripe.checkout.Session.create") as create:
        res = _checkout(api, narrow, lesson)
    assert res.status_code == 400
    assert res.json()["error"] == "package_does_not_cover_lesson"
    create.assert_not_called()


def test_a_lesson_from_another_school_is_refused(api, drop_in, lesson):
    other = School.objects.create(name="O", slug=f"o-{uuid.uuid4().hex[:8]}", email="o@example.com")
    lesson.school = other
    lesson.save(update_fields=["school"])
    with patch("commerce.stripe_service.stripe.checkout.Session.create") as create:
        res = _checkout(api, drop_in, lesson)
    assert res.status_code == 404
    create.assert_not_called()


# --- Fase 1: risoluzione del drop-in ----------------------------------------

def test_the_cheapest_covering_drop_in_wins(school, lesson, drop_in):
    Package.objects.create(school=school, credits=Decimal("1"), price=Decimal("25"), is_drop_in=True, active=True)
    assert resolve_drop_in_package(lesson) == drop_in


def test_a_drop_in_with_too_few_credits_is_ignored(school, lesson):
    lesson.course.credit_cost = Decimal("2")
    lesson.course.save(update_fields=["credit_cost"])
    Package.objects.create(school=school, credits=Decimal("1"), price=Decimal("19.97"), is_drop_in=True, active=True)
    assert resolve_drop_in_package(lesson) is None


def test_an_inactive_or_unflagged_package_is_not_a_drop_in(school, lesson):
    Package.objects.create(school=school, credits=Decimal("1"), price=Decimal("5"), is_drop_in=True, active=False)
    Package.objects.create(school=school, credits=Decimal("1"), price=Decimal("5"), is_drop_in=False, active=True)
    assert resolve_drop_in_package(lesson) is None


def test_no_drop_in_configured_returns_none(lesson):
    assert resolve_drop_in_package(lesson) is None


# --- Fase 2: verify-session come seconda strada ------------------------------

def _stripe_session(payment_id, amount, metadata, payment_status="paid"):
    return type("S", (), {
        "status": "complete", "payment_status": payment_status,
        "payment_intent": payment_id, "amount_total": amount, "metadata": metadata, "id": "cs_1",
    })()


def test_verify_session_activates_when_the_webhook_has_not_landed_yet(api, school, student, drop_in, lesson):
    meta = _meta(school, student, drop_in, lesson)
    with patch("commerce.stripe_views.stripe.checkout.Session.retrieve") as retrieve:
        retrieve.return_value = _stripe_session("pi_1", 1997, meta)
        res = api.get("/api/stripe/verify-session/?session_id=cs_1")

    assert res.status_code == 200
    assert res.json()["activation"] == "package_activated_booked"
    assert Booking.objects.filter(student=student, lesson=lesson).count() == 1


def test_webhook_after_verify_session_is_a_no_op(api, school, student, drop_in, lesson):
    """Chi arriva primo scrive, l'altro non raddoppia niente."""
    meta = _meta(school, student, drop_in, lesson)
    with patch("commerce.stripe_views.stripe.checkout.Session.retrieve") as retrieve:
        retrieve.return_value = _stripe_session("pi_1", 1997, meta)
        api.get("/api/stripe/verify-session/?session_id=cs_1")

    from commerce.webhooks import handle_event

    result = handle_event({
        "type": "payment_intent.succeeded",
        "data": {"object": {"id": "pi_1", "amount": 1997, "metadata": meta}},
    })

    assert result == "already_processed"
    assert StudentPackage.objects.filter(student=student).count() == 1
    assert Booking.objects.filter(student=student, lesson=lesson).count() == 1


def test_an_unpaid_session_activates_nothing(api, school, student, drop_in, lesson):
    meta = _meta(school, student, drop_in, lesson)
    with patch("commerce.stripe_views.stripe.checkout.Session.retrieve") as retrieve:
        retrieve.return_value = _stripe_session("pi_1", 1997, meta, payment_status="unpaid")
        res = api.get("/api/stripe/verify-session/?session_id=cs_1")

    assert res.json()["activation"] is None
    assert not StudentPackage.objects.filter(student=student).exists()
    assert not Booking.objects.filter(student=student, lesson=lesson).exists()


# --- Fase 1: un drop-in non puo' essere ricorrente ---------------------------

def test_a_drop_in_cannot_be_recurring(school):
    ser = _serializer(school=str(school.id), credits="1", price="19.97",
                      is_drop_in=True, is_recurring=True)
    assert not ser.is_valid()
    assert "is_drop_in" in ser.errors


def test_a_package_must_say_which_lessons_it_covers(school):
    """"Vuoto = tutti i tipi" rendeva impossibile dire quanto costa una lezione
    dentro il pacchetto — numero che ora le allieve leggono nella modale."""
    from catalog.serializers import PackageSerializer

    ser = PackageSerializer(data={"school": str(school.id), "credits": "10", "price": "150"})
    assert not ser.is_valid()
    assert "allowed_lesson_types" in ser.errors

    ser = PackageSerializer(data={
        "school": str(school.id), "credits": "10", "price": "150", "allowed_lesson_types": [],
    })
    assert not ser.is_valid()


def test_a_partial_update_that_does_not_touch_the_types_still_works(school):
    """Un PATCH parziale (es. l'auto-traduzione) non deve inciampare sulla
    regola: si controlla solo quando il campo viene scritto."""
    from catalog.serializers import PackageSerializer

    pkg = Package.objects.create(school=school, credits=Decimal("10"), price=Decimal("150"))
    ser = PackageSerializer(pkg, data={"name_it": "Nuovo nome"}, partial=True)
    assert ser.is_valid(), ser.errors


# --- Fase 1: cosa non ha senso su una lezione singola ------------------------

def _serializer(**data):
    """Un pacchetto valido richiede sempre i tipi di lezione che copre: qui se
    ne mette uno di default, i test che parlano d'altro non devono ripeterlo."""
    from catalog.serializers import PackageSerializer

    data.setdefault("allowed_lesson_types", [str(LessonType.objects.create(code=f"t-{uuid.uuid4().hex[:6]}").id)])
    return PackageSerializer(data=data)


def test_unlimited_and_weekly_cap_are_cleared_on_a_drop_in(school):
    """La UI li nasconde; qui si azzerano, cosi' un client vecchio non lascia
    addosso valori che poi nessuno potra' piu' vedere ne' correggere."""
    ser = _serializer(
        school=str(school.id), credits="1", price="19.97",
        is_drop_in=True, is_unlimited=True, weekly_booking_cap=3,
    )
    assert ser.is_valid(), ser.errors
    pkg = ser.save()
    assert pkg.is_drop_in is True
    assert pkg.is_unlimited is False
    assert pkg.weekly_booking_cap is None


def test_a_normal_package_keeps_unlimited_and_weekly_cap(school):
    ser = _serializer(
        school=str(school.id), credits="10", price="150",
        is_drop_in=False, is_unlimited=True, weekly_booking_cap=3,
    )
    assert ser.is_valid(), ser.errors
    pkg = ser.save()
    assert pkg.is_unlimited is True
    assert pkg.weekly_booking_cap == 3


def test_flagging_an_existing_unlimited_package_as_drop_in_clears_it(school):
    from catalog.serializers import PackageSerializer

    pkg = Package.objects.create(
        school=school, credits=Decimal("1"), price=Decimal("19.97"),
        is_unlimited=True, weekly_booking_cap=2,
    )
    ser = PackageSerializer(pkg, data={"is_drop_in": True}, partial=True)
    assert ser.is_valid(), ser.errors
    pkg = ser.save()
    assert (pkg.is_drop_in, pkg.is_unlimited, pkg.weekly_booking_cap) == (True, False, None)


def test_one_drop_in_may_cover_several_lesson_types(school, lesson):
    """Piu' tipi sono leciti — e utili — finche' costano gli stessi crediti."""
    other_type = LessonType.objects.create(code=f"t-{uuid.uuid4().hex[:6]}")
    lesson.lesson_type = LessonType.objects.create(code=f"t-{uuid.uuid4().hex[:6]}")
    lesson.save(update_fields=["lesson_type"])
    wide = Package.objects.create(
        school=school, credits=Decimal("1"), price=Decimal("19.97"), is_drop_in=True, active=True,
        allowed_lesson_types=[str(other_type.id), str(lesson.lesson_type_id)],
    )
    assert resolve_drop_in_package(lesson) == wide


# --- Fase 3: cosa proporre a chi non ha crediti ------------------------------

def _options(api, lesson):
    return api.get(f"/api/student/lessons/{lesson.id}/purchase-options/")


def test_purchase_options_offer_the_drop_in_and_the_upsell(api, school, drop_in, lesson):
    Package.objects.create(school=school, credits=Decimal("10"), price=Decimal("150"), active=True)

    body = _options(api, lesson).json()

    assert body["credit_cost"] == "1.0"
    assert body["drop_in"]["id"] == str(drop_in.id)
    assert body["drop_in"]["price"] == "19.97"
    # "Con 10 Lezioni questa lezione ti costerebbe 15,00"
    assert body["upsell"]["price_per_lesson"] == "15.00"


def test_the_upsell_compares_per_lesson_not_on_the_total(api, school, lesson):
    """Un pacchetto piu' caro in totale puo' essere il piu' conveniente."""
    Package.objects.create(school=school, credits=Decimal("5"), price=Decimal("100"), active=True)   # 20/lezione
    cheap = Package.objects.create(school=school, credits=Decimal("20"), price=Decimal("200"), active=True)  # 10/lezione

    body = _options(api, lesson).json()
    assert body["upsell"]["id"] == str(cheap.id)
    assert body["upsell"]["price_per_lesson"] == "10.00"


def test_a_drop_in_is_never_offered_as_the_upsell(api, school, drop_in, lesson):
    body = _options(api, lesson).json()
    assert body["upsell"] is None


def test_without_a_drop_in_only_the_package_route_is_offered(api, school, lesson):
    Package.objects.create(school=school, credits=Decimal("10"), price=Decimal("150"), active=True)
    body = _options(api, lesson).json()
    assert body["drop_in"] is None
    assert body["upsell"] is not None


def test_a_school_without_stripe_still_shows_the_drop_in_and_fails_at_the_click(api, school, drop_in, lesson):
    """Decisione §3.1: il bottone si mostra comunque e il rifiuto arriva al
    click, esattamente come per l'acquisto di un pacchetto. Nasconderlo solo
    per il drop-in sarebbe stata l'incoerenza."""
    school.stripe_onboarding_complete = False
    school.save(update_fields=["stripe_onboarding_complete"])

    assert _options(api, lesson).json()["drop_in"]["id"] == str(drop_in.id)

    with patch("commerce.stripe_service.stripe.checkout.Session.create") as create:
        res = _checkout(api, drop_in, lesson)
    assert res.status_code == 400
    assert res.json()["error"] == "school_not_connected"
    create.assert_not_called()


def test_purchase_options_need_a_real_lesson(api):
    assert api.get(f"/api/student/lessons/{uuid.uuid4()}/purchase-options/").status_code == 404


def test_credits_and_booking_commit_together(school, student, drop_in, lesson):
    """Se il processo morisse fra l'accredito e la prenotazione, il retry di
    Stripe direbbe "already_processed" e la lezione non verrebbe prenotata mai.
    Devono stare nella stessa transazione."""
    from unittest.mock import patch as _patch

    meta = _meta(school, student, drop_in, lesson)
    with _patch("bookings.services.Booking.objects.create", side_effect=RuntimeError("boom")):
        with pytest.raises(RuntimeError):
            activate_package_payment(payment_id="pi_1", amount_cents=1997, metadata=meta)

    # niente e' rimasto a meta': il retry rifara' tutto da capo
    assert not Transaction.objects.filter(stripe_payment_id="pi_1").exists()
    assert not StudentPackage.objects.filter(student=student).exists()

    assert activate_package_payment(
        payment_id="pi_1", amount_cents=1997, metadata=meta
    ) == "package_activated_booked"
    assert Booking.objects.filter(student=student, lesson=lesson).count() == 1


def test_the_student_is_actually_told_when_the_lesson_filled_up(
    school, student, drop_in, lesson, django_capture_on_commit_callbacks
):
    """La riga in `notifications` non basta: il centro notifiche studente non
    esiste come pagina, quindi senza email l'allieva vedrebbe solo dei crediti
    comparsi dal nulla. Il template built-in deve risolvere in tutte le lingue
    e il bottone deve puntare da qualche parte."""
    from unittest.mock import patch as _patch

    from notifications.builtin_templates import get_builtin

    lesson.current_bookings = lesson.max_capacity
    lesson.save(update_fields=["current_bookings"])
    student.user.language_preference = "it"
    student.user.save(update_fields=["language_preference"])

    # L'email parte da transaction.on_commit (mai dentro l'atomic: un rollback
    # manderebbe una mail fantasma), quindi va catturato il commit.
    with _patch("notifications.tasks.send_transactional_email_task.delay") as send:
        with django_capture_on_commit_callbacks(execute=True):
            activate_package_payment(
                payment_id="pi_1", amount_cents=1997, metadata=_meta(school, student, drop_in, lesson)
            )

    send.assert_called_once()
    ctx = send.call_args.kwargs["context"]
    assert send.call_args.kwargs["key"] == "drop_in_booking_failed"
    assert ctx["booking_url"].endswith("/student/book")
    assert ctx["school_name"] == school.name

    for loc in ("en", "it", "es", "fr", "de"):
        subject, body = get_builtin("drop_in_booking_failed", loc)
        assert subject and "{{booking_url}}" in body


def test_verify_session_refuses_someone_elses_session(api, school, student, drop_in, lesson):
    """L'id di sessione viaggia nell'URL di rientro, non e' un segreto: senza
    controllo chiunque fosse loggato poteva leggere i metadata altrui (che
    contengono student_id e school_id) e innescarne l'accredito."""
    other_user = get_user_model().objects.create(email=f"other-{uuid.uuid4().hex[:8]}@example.com")
    Student.objects.create(user=other_user, name="Other", school=school)
    intruder = APIClient()
    intruder.force_authenticate(user=other_user)

    with patch("commerce.stripe_views.stripe.checkout.Session.retrieve") as retrieve:
        retrieve.return_value = _stripe_session("pi_1", 1997, _meta(school, student, drop_in, lesson))
        res = intruder.get("/api/stripe/verify-session/?session_id=cs_1")

    assert res.status_code == 403
    assert res.json() == {"error": "not_your_session"}
    assert not StudentPackage.objects.filter(student=student).exists()
    assert not Booking.objects.filter(lesson=lesson).exists()


def test_verify_session_still_works_for_the_owner(api, school, student, drop_in, lesson):
    with patch("commerce.stripe_views.stripe.checkout.Session.retrieve") as retrieve:
        retrieve.return_value = _stripe_session("pi_1", 1997, _meta(school, student, drop_in, lesson))
        res = api.get("/api/stripe/verify-session/?session_id=cs_1")

    assert res.status_code == 200
    assert res.json()["activation"] == "package_activated_booked"


def test_prices_are_visible_before_signing_up(school, drop_in, lesson):
    """Chiedere l'account prima ancora di dire il prezzo faceva scappare chi
    stava valutando: il catalogo e' pubblico (spec 9.2), il muro e' al
    pagamento."""
    anon = APIClient()
    res = anon.get(f"/api/student/lessons/{lesson.id}/purchase-options/")

    assert res.status_code == 200
    assert res.json()["drop_in"]["price"] == "19.97"


def test_buying_still_requires_an_account(drop_in, lesson):
    anon = APIClient()
    res = anon.post(
        "/api/stripe/checkout/",
        {"kind": "package", "item_id": str(drop_in.id), "lesson_id": str(lesson.id)},
        format="json",
    )
    assert res.status_code in (401, 403)


def test_the_drop_in_stays_out_of_the_storefront(api, school, drop_in):
    """Si compra dal calendario, sulla lezione: in vetrina, fra i pacchetti da
    dieci o venti lezioni, sarebbe solo il prodotto col peggior prezzo per
    credito. Deve pero' restare comprabile per id — il checkout passa di li'."""
    normale = Package.objects.create(
        school=school, credits=Decimal("10"), price=Decimal("150"), active=True
    )

    listati = {r["id"] for r in api.get("/api/student/school-packages/").json()}
    assert str(normale.id) in listati
    assert str(drop_in.id) not in listati


def test_a_hidden_drop_in_is_still_buyable(api, drop_in, lesson):
    with patch("commerce.stripe_service.stripe.checkout.Session.create") as create:
        create.return_value = type("S", (), {"url": "https://stripe.test/c", "id": "cs_1"})()
        res = _checkout(api, drop_in, lesson)
    assert res.status_code == 200, res.content


# --- Ordine dei pacchetti ----------------------------------------------------

def test_the_school_decides_the_order_students_see(api, school):
    """Riordinare non serve a niente se poi la vetrina ignora la scelta."""
    caro = Package.objects.create(school=school, credits=Decimal("10"), price=Decimal("200"), active=True)
    economico = Package.objects.create(school=school, credits=Decimal("5"), price=Decimal("50"), active=True)

    # senza ordine esplicito vince il prezzo, come prima
    assert [r["id"] for r in api.get("/api/student/school-packages/").json()] == [
        str(economico.id), str(caro.id)
    ]

    caro.sort_order = 1
    caro.save(update_fields=["sort_order"])
    assert [r["id"] for r in api.get("/api/student/school-packages/").json()] == [
        str(caro.id), str(economico.id)
    ]


def test_reorder_writes_the_positions(school):
    from accounts.models import Role
    from schools.models import SchoolMembership

    a = Package.objects.create(school=school, credits=Decimal("10"), price=Decimal("100"), active=True)
    b = Package.objects.create(school=school, credits=Decimal("5"), price=Decimal("50"), active=True)

    admin = get_user_model().objects.create(
        email=f"adm-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL],
        active_school=school,
    )
    SchoolMembership.objects.create(profile=admin, school=school, sub_role="owner")
    client = APIClient()
    client.force_authenticate(user=admin)

    res = client.post("/api/school/packages/reorder/", {"ids": [str(b.id), str(a.id)]}, format="json")
    assert res.status_code == 200
    b.refresh_from_db()
    a.refresh_from_db()
    assert (b.sort_order, a.sort_order) == (1, 2)


def test_reorder_cannot_touch_another_school(school):
    """Gli id arrivano dal client: uno di un'altra scuola non deve mordere."""
    from accounts.models import Role
    from schools.models import SchoolMembership

    altra = School.objects.create(name="O", slug=f"o-{uuid.uuid4().hex[:8]}", email="o@example.com")
    estraneo = Package.objects.create(school=altra, credits=Decimal("10"), price=Decimal("100"), active=True)
    mio = Package.objects.create(school=school, credits=Decimal("10"), price=Decimal("100"), active=True)

    admin = get_user_model().objects.create(
        email=f"adm-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL],
        active_school=school,
    )
    SchoolMembership.objects.create(profile=admin, school=school, sub_role="owner")
    client = APIClient()
    client.force_authenticate(user=admin)

    client.post("/api/school/packages/reorder/", {"ids": [str(estraneo.id), str(mio.id)]}, format="json")
    estraneo.refresh_from_db()
    mio.refresh_from_db()
    assert estraneo.sort_order is None
    assert mio.sort_order == 2


# --- Vetrina: crediti tradotti in lezioni ------------------------------------

def test_the_storefront_speaks_in_lessons_not_credits(api, school, lesson):
    """"100 crediti a 95 euro" non dice niente a chi compra; "5 lezioni a 19
    euro l'una" si confronta con la lezione singola in un secondo."""
    lesson.course.credit_cost = Decimal("20")
    lesson.course.save(update_fields=["credit_cost"])
    lesson.lesson_type = LessonType.objects.create(code=f"t-{uuid.uuid4().hex[:6]}")
    lesson.save(update_fields=["lesson_type"])
    lesson.course.lesson_type = lesson.lesson_type
    lesson.course.save(update_fields=["lesson_type"])

    Package.objects.create(
        school=school, credits=Decimal("100"), price=Decimal("95"), active=True,
        allowed_lesson_types=[str(lesson.lesson_type_id)],
    )

    row = api.get("/api/student/school-packages/").json()[0]
    assert row["lesson_credit_cost"] == "20.0"
    assert row["lessons_included"] == 5
    assert row["price_per_lesson"] == "19.00"


def test_mixed_costs_leave_the_storefront_on_credits(api, school, lesson):
    """Con corsi da 11 e da 15 crediti un "numero di lezioni" non esiste: non
    si inventa, si resta sui crediti."""
    caro = LessonType.objects.create(code=f"t-{uuid.uuid4().hex[:6]}")
    economico = LessonType.objects.create(code=f"t-{uuid.uuid4().hex[:6]}")
    Course.objects.create(school=school, lesson_type=caro, credit_cost=Decimal("15"), active=True)
    Course.objects.create(school=school, lesson_type=economico, credit_cost=Decimal("11"), active=True)

    Package.objects.create(
        school=school, credits=Decimal("100"), price=Decimal("95"), active=True,
        allowed_lesson_types=[str(caro.id), str(economico.id)],
    )

    row = next(r for r in api.get("/api/student/school-packages/").json() if float(r["price"]) == 95)
    assert row["lessons_included"] is None
    assert row["price_per_lesson"] is None


def test_an_online_only_package_ignores_in_person_costs(api, school):
    """Il filtro modalita' fa parte del conto: un pacchetto solo-online non
    deve prendere il costo dei corsi in sala dello stesso tipo."""
    tipo = LessonType.objects.create(code=f"t-{uuid.uuid4().hex[:6]}")
    Course.objects.create(school=school, lesson_type=tipo, credit_cost=Decimal("20"), active=True, is_online=False)
    Course.objects.create(school=school, lesson_type=tipo, credit_cost=Decimal("15"), active=True, is_online=True)

    Package.objects.create(
        school=school, credits=Decimal("150"), price=Decimal("120"), active=True,
        allowed_lesson_types=[str(tipo.id)], mode_filter="online",
    )

    row = next(r for r in api.get("/api/student/school-packages/").json() if float(r["price"]) == 120)
    assert row["lesson_credit_cost"] == "15.0"
    assert row["lessons_included"] == 10


def test_the_school_panel_shows_the_same_figures_as_the_storefront(school, lesson):
    """La scuola deve vedere il numero che vedra' l'allieva: se i due conti
    divergono, pubblica un prezzo credendone un altro."""
    from accounts.models import Role
    from schools.models import SchoolMembership

    lesson.course.credit_cost = Decimal("20")
    lesson.course.lesson_type = LessonType.objects.create(code=f"t-{uuid.uuid4().hex[:6]}")
    lesson.course.save(update_fields=["credit_cost", "lesson_type"])

    Package.objects.create(
        school=school, credits=Decimal("100"), price=Decimal("95"), active=True,
        allowed_lesson_types=[str(lesson.course.lesson_type_id)],
    )

    admin = get_user_model().objects.create(
        email=f"adm-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL],
        active_school=school,
    )
    SchoolMembership.objects.create(profile=admin, school=school, sub_role="owner")
    panel = APIClient()
    panel.force_authenticate(user=admin)

    dal_pannello = panel.get("/api/school/packages/").json()[0]
    dalla_vetrina = APIClient().get("/api/student/school-packages/").json()[0]

    for campo in ("lessons_included", "price_per_lesson", "lesson_credit_cost"):
        assert dal_pannello[campo] == dalla_vetrina[campo], campo
    assert dal_pannello["lessons_included"] == 5
    assert dal_pannello["price_per_lesson"] == "19.00"


def test_an_hq_package_has_no_lesson_figures(school):
    """Un pacchetto HQ non appartiene a una scuola: non ci sono corsi da cui
    dedurre quanto costa una lezione, e non si inventa."""
    from catalog.serializers import PackageSerializer
    from catalog.services import course_cost_index

    hq = Package.objects.create(school=None, credits=Decimal("100"), price=Decimal("95"), active=True)
    data = PackageSerializer(hq, context={"course_costs": course_cost_index([school.id])}).data
    assert data["lessons_included"] is None
    assert data["price_per_lesson"] is None


def test_public_schools_carry_the_country_code():
    """`country` e' testo libero ("Italy", "Spain", "IT"): il client non deve
    indovinare per scrivere il nome del paese nella lingua di chi guarda."""
    School.objects.create(name="A", slug=f"a-{uuid.uuid4().hex[:8]}", email="a@e.com", country="Spain", active=True)
    School.objects.create(name="B", slug=f"b-{uuid.uuid4().hex[:8]}", email="b@e.com", country="IT", active=True)
    School.objects.create(name="C", slug=f"c-{uuid.uuid4().hex[:8]}", email="c@e.com", country="", active=True)

    rows = {r["name"]: r["country_code"] for r in APIClient().get("/api/schools/public/").json()}
    assert rows["A"] == "ES"
    assert rows["B"] == "IT"
    assert rows["C"] is None


def test_a_purchased_package_cannot_be_deleted(school, student):
    """Lo storico dell'allieva punta al pacchetto: si disattiva, non si
    cancella. Il pannello lo dice invece di far sparire il bottone."""
    from accounts.models import Role
    from schools.models import SchoolMembership

    pkg = Package.objects.create(school=school, credits=Decimal("10"), price=Decimal("150"), active=True)
    StudentPackage.objects.create(
        student=student, school=school, package=pkg,
        credits_total=pkg.credits, credits_remaining=pkg.credits, status="active",
    )

    admin = get_user_model().objects.create(
        email=f"adm-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL],
        active_school=school,
    )
    SchoolMembership.objects.create(profile=admin, school=school, sub_role="owner")
    client = APIClient()
    client.force_authenticate(user=admin)

    riga = next(r for r in client.get("/api/school/packages/").json() if r["id"] == str(pkg.id))
    assert riga["has_purchases"] is True

    assert client.delete(f"/api/school/packages/{pkg.id}/").status_code == 400
    assert Package.objects.filter(pk=pkg.id).exists()

    # disattivarlo invece funziona, ed e' la strada che il messaggio indica
    assert client.patch(f"/api/school/packages/{pkg.id}/", {"active": False}, format="json").status_code == 200
    pkg.refresh_from_db()
    assert pkg.active is False


def test_the_wallet_counts_lessons_package_by_package(api, school, student, lesson):
    """Il totale NON si ottiene convertendo i crediti del portafoglio: un
    credito non si spalma su due pacchetti — la prenotazione scala da uno solo
    — quindi 20 crediti a 20 piu' 150 a 15 sono 1 + 10 = 11 lezioni, mentre
    170 diviso "quanto" non vorrebbe dire niente."""
    sala = LessonType.objects.create(code=f"t-{uuid.uuid4().hex[:6]}")
    zoom = LessonType.objects.create(code=f"t-{uuid.uuid4().hex[:6]}")
    Course.objects.create(school=school, lesson_type=sala, credit_cost=Decimal("20"), active=True, is_online=False)
    Course.objects.create(school=school, lesson_type=zoom, credit_cost=Decimal("15"), active=True, is_online=True)

    p_sala = Package.objects.create(
        school=school, credits=Decimal("20"), price=Decimal("20"), active=True,
        allowed_lesson_types=[str(sala.id)], mode_filter="in_person",
    )
    p_zoom = Package.objects.create(
        school=school, credits=Decimal("150"), price=Decimal("135"), active=True,
        allowed_lesson_types=[str(zoom.id)], mode_filter="online",
    )
    for pkg, resto in ((p_sala, "20"), (p_zoom, "150")):
        StudentPackage.objects.create(
            student=student, school=school, package=pkg,
            credits_total=pkg.credits, credits_remaining=Decimal(resto), status="active",
        )

    righe = api.get("/api/student/packages/").json()
    per_pacchetto = {float(r["credits_total"]): r["lessons_remaining"] for r in righe}
    assert per_pacchetto == {20.0: 1, 150.0: 10}
    assert sum(r["lessons_remaining"] for r in righe) == 11


def test_a_package_with_mixed_lesson_costs_has_no_lesson_count(api, school, student):
    caro = LessonType.objects.create(code=f"t-{uuid.uuid4().hex[:6]}")
    economico = LessonType.objects.create(code=f"t-{uuid.uuid4().hex[:6]}")
    Course.objects.create(school=school, lesson_type=caro, credit_cost=Decimal("15"), active=True)
    Course.objects.create(school=school, lesson_type=economico, credit_cost=Decimal("11"), active=True)

    pkg = Package.objects.create(
        school=school, credits=Decimal("100"), price=Decimal("95"), active=True,
        allowed_lesson_types=[str(caro.id), str(economico.id)],
    )
    StudentPackage.objects.create(
        student=student, school=school, package=pkg,
        credits_total=pkg.credits, credits_remaining=pkg.credits, status="active",
    )

    riga = api.get("/api/student/packages/").json()[0]
    assert riga["lessons_remaining"] is None
    assert riga["lesson_credit_cost"] is None


def test_credits_granted_with_a_package_inherit_its_expiry(school, student):
    """Il form disabilita il campo data e scrive "la scadenza viene dal
    pacchetto": se poi nessuno la calcola, quei crediti non scadono mai."""
    from accounts.models import Role
    from schools.models import SchoolMembership, SchoolStudent

    catalogo = Package.objects.create(
        school=school, credits=Decimal("10"), price=Decimal("150"), active=True,
        validity_days=3, validity_unit="months",
    )
    SchoolStudent.objects.get_or_create(school=school, student=student)

    admin = get_user_model().objects.create(
        email=f"adm-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL],
        active_school=school,
    )
    SchoolMembership.objects.create(profile=admin, school=school, sub_role="owner")
    client = APIClient()
    client.force_authenticate(user=admin)

    res = client.post("/api/school/credits/grant/", {
        "student_id": str(student.id), "amount": 10, "reason": "gift",
        "package_catalog_id": str(catalogo.id),
    }, format="json")
    assert res.status_code == 201, res.content

    sp = StudentPackage.objects.get(student=student, package=catalogo)
    assert sp.expires_at is not None
    attesa = timezone.now() + catalogo.validity_delta()
    assert abs((sp.expires_at - attesa).total_seconds()) < 60


def test_credits_granted_without_a_package_can_stay_open_ended(school, student):
    """"Lascia vuoto per nessuna scadenza" deve continuare a voler dire quello."""
    from accounts.models import Role
    from schools.models import SchoolMembership, SchoolStudent

    SchoolStudent.objects.get_or_create(school=school, student=student)
    admin = get_user_model().objects.create(
        email=f"adm-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL],
        active_school=school,
    )
    SchoolMembership.objects.create(profile=admin, school=school, sub_role="owner")
    client = APIClient()
    client.force_authenticate(user=admin)

    client.post("/api/school/credits/grant/", {
        "student_id": str(student.id), "amount": 5, "reason": "gift",
    }, format="json")

    sp = StudentPackage.objects.filter(student=student, package__isnull=True).first()
    assert sp is not None and sp.expires_at is None
