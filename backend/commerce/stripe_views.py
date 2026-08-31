import logging
from decimal import Decimal

import stripe
from django.conf import settings
from django.http import HttpResponse
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.viewsets import is_hq
from schools.models import School

from . import webhooks as stripe_webhooks
from .discounts import DiscountError, resolve_discount
from .services import activate_package_payment
from .models import Transaction
from .stripe_service import (
    CheckoutError,
    create_checkout_session,
    refresh_onboarding_status,
    refund_transaction,
    start_connect_onboarding,
)

logger = logging.getLogger(__name__)


class CheckoutView(APIView):
    """POST /api/stripe/checkout/ — {kind: 'package'|'subscription', item_id,
    school_id?, discount_code?, success_url?, cancel_url?}. Also accepts the
    frontend's `type`/`product_id` naming as aliases; school_id is optional
    and, when omitted, derived from the item itself (each Package/
    SubscriptionCatalog row belongs to exactly one school)."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        from bookings.services import BookingError, assert_bookable, package_covers_lesson
        from catalog.models import Lesson, Package, SubscriptionCatalog
        from students.models import Student

        student = Student.objects.filter(user=request.user).first()
        if student is None:
            return Response({"error": "no_student_profile"}, status=400)

        kind = request.data.get("kind") or request.data.get("type")
        model = {"package": Package, "subscription": SubscriptionCatalog}.get(kind)
        if model is None:
            return Response({"error": "invalid_kind"}, status=400)

        # Deactivated items are unreachable, not just unlisted: the catalog
        # endpoints already hide them, and a stale checkout link (or a guessed
        # id) must not be able to sell one. Same rule the shop applies to
        # products in commerce/student_views.py.
        item_id = request.data.get("item_id") or request.data.get("product_id")
        item = model.objects.filter(pk=item_id, active=True).first()
        if item is None:
            return Response({"error": "item_not_found"}, status=404)

        school_id = request.data.get("school_id") or str(item.school_id)
        school = School.objects.filter(pk=school_id).first()
        if school is None or item.school_id != school.id:
            return Response({"error": "school_not_found"}, status=404)

        # Codes belong to the school whose package is being bought (scadenza,
        # minimo d'ordine e ambito sono verificati in commerce/discounts.py).
        try:
            discount, discount_amount = resolve_discount(
                request.data.get("discount_code"), school=school, scope=kind + "s",
                lines=[{"id": item.id, "amount": Decimal(item.price)}],
            )
        except DiscountError as exc:
            return Response({"error": str(exc)}, status=400)

        # Start of the credit window (Carlo: the student always chooses the
        # decorrenza — today, the current package's expiry, or a free date).
        # Payment is always immediate; only the validity window shifts.
        start_at = None
        if kind == "package" and request.data.get("start_date"):
            from datetime import datetime, timezone as dt_tz

            try:
                start_at = datetime.fromisoformat(str(request.data["start_date"]))
            except ValueError:
                return Response({"error": "invalid_start_date"}, status=400)
            if start_at.tzinfo is None:
                start_at = start_at.replace(tzinfo=dt_tz.utc)
        elif request.data.get("start") == "after_current" and kind == "package":
            from django.utils import timezone as dj_tz

            from students.models import StudentPackage

            current = (
                StudentPackage.objects.filter(
                    student=student, school=school, status="active", expires_at__gt=dj_tz.now()
                )
                .order_by("-expires_at")
                .first()
            )
            if current is not None:
                start_at = current.expires_at

        # Drop-in (DROP_IN_BOOKING.md §5.1): il checkout porta con se' la
        # lezione gia' scelta, cosi' il webhook la prenota da solo appena i
        # crediti sono accreditati. La rivalidiamo QUI: non prendiamo soldi
        # per una lezione che gia' sappiamo non prenotabile.
        lesson = None
        lesson_id = request.data.get("lesson_id")
        if lesson_id:
            # Solo il drop-in prenota da solo. Un pacchetto normale comprato
            # partendo da una lezione riapre la modale e chiede un tap (§7.3):
            # chi compra dieci lezioni puo' star comprando per il mese, non
            # per quella lezione.
            if kind != "package" or not item.is_drop_in:
                return Response({"error": "lesson_requires_drop_in_package"}, status=400)
            lesson = Lesson.objects.filter(pk=lesson_id).first()
            if lesson is None or lesson.school_id != school.id:
                return Response({"error": "lesson_not_found"}, status=404)
            if not package_covers_lesson(item, lesson):
                return Response({"error": "package_does_not_cover_lesson"}, status=400)
            try:
                assert_bookable(student, lesson)
            except BookingError as exc:
                return Response({"error": "lesson_not_bookable", "reason": str(exc)}, status=409)

        redirect_to = request.data.get("redirect_to")
        # `{CHECKOUT_SESSION_ID}` lo sostituisce Stripe al redirect. Senza,
        # la pagina di rientro non puo' chiamare verify-session e l'accredito
        # resta appeso alla sola consegna del webhook (che puo' arrivare dopo).
        # Acquisto "puro" (nessun redirect da una lezione): si atterra dritte
        # su I miei pacchetti — prima si passava da /student/buy che rimbalzava
        # a sua volta (doppio salto visibile)
        default_success = f"{settings.FRONTEND_URL}{redirect_to or '/student/packages'}" + (
            "&payment=success" if redirect_to and "?" in redirect_to else "?payment=success"
        ) + "&session_id={CHECKOUT_SESSION_ID}"
        default_cancel = f"{settings.FRONTEND_URL}/student/buy?payment=cancelled"

        try:
            session = create_checkout_session(
                kind=kind, item=item, school=school, student=student,
                success_url=request.data.get("success_url") or default_success,
                cancel_url=request.data.get("cancel_url") or default_cancel,
                discount_code=discount,
                discount_amount=discount_amount,
                start_at=start_at,
                lesson=lesson,
            )
        except CheckoutError as exc:
            return Response({"error": str(exc)}, status=400)
        except Exception as exc:
            # A misconfigured/placeholder STRIPE_SECRET_KEY raises a raw
            # UnicodeEncodeError (or similar transport error) from the HTTP
            # layer, not a stripe.error.StripeError — catch broadly so a bad
            # key surfaces as a clean 502 instead of crashing the request.
            return Response({"error": "stripe_error", "detail": str(exc)}, status=502)

        return Response({"url": session.url, "checkout_url": session.url, "session_id": session.id})




def _meta_dict(obj) -> dict:
    """Metadata di un oggetto Stripe → dict. In stripe 15 StripeObject non è
    più un dict (niente keys()/__iter__): dict(obj) ci provava col protocollo
    sequenza → obj[0] → il famigerato KeyError: 0 in prod."""
    if not obj:
        return {}
    if hasattr(obj, "to_dict"):
        return dict(obj.to_dict())
    return dict(obj)


def _exc_detail(exc) -> str:
    """Tipo, messaggio, ultimo frame assoluto E ultimo frame nel NOSTRO codice
    (quello di libreria da solo non dice chi ha chiamato)."""
    import traceback

    frames = traceback.extract_tb(exc.__traceback__)
    parts = []
    if frames:
        last = frames[-1]
        parts.append(f"{last.filename.split('/')[-1]}:{last.lineno} in {last.name}")
        ours = next((f for f in reversed(frames) if "site-packages" not in f.filename), None)
        if ours is not None and ours is not last:
            parts.append(f"da {ours.filename.split('/')[-1]}:{ours.lineno} in {ours.name}")
    where = f" @ {' — '.join(parts)}" if parts else ""
    return f"{type(exc).__name__}: {exc}{where}"[:300]


class VerifySessionView(APIView):
    """GET /api/stripe/verify-session/?session_id= — frontend calls this after
    the Checkout redirect to confirm status before showing the success page."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        # Cintura totale: QUALSIASI eccezione qui dentro torna col suo dettaglio
        # (e traceback nei log) invece di un 500 muto — in prod "codice: 500"
        # senza causa non era diagnosticabile.
        try:
            return self._get(request)
        except Exception as exc:  # noqa: BLE001
            logger.exception("verify-session failed (session_id=%s)", request.query_params.get("session_id"))
            return Response({"error": "verify_failed", "detail": _exc_detail(exc)}, status=502)

    def _get(self, request):
        from students.models import Student

        session_id = request.query_params.get("session_id")
        if not session_id:
            return Response({"error": "session_id required"}, status=400)
        try:
            session = stripe.checkout.Session.retrieve(session_id)
        except Exception as exc:  # noqa: BLE001 — il dettaglio va in pagina/log, non un 500 muto
            logger.exception("verify-session: Session.retrieve failed (session_id=%s)", session_id)
            return Response({"error": "stripe_retrieve_failed", "detail": _exc_detail(exc)}, status=502)
        metadata = _meta_dict(getattr(session, "metadata", None))

        # Una sessione si verifica solo se e' la propria. L'id di sessione non
        # e' un segreto (viaggia nell'URL di rientro) e i metadata contengono
        # student_id/school_id: senza questo controllo chiunque fosse loggato
        # poteva leggere i metadata delle sessioni altrui, e adesso anche
        # innescarne l'accredito.
        student = Student.objects.filter(user=request.user).first()
        owner_id = metadata.get("student_id")
        if owner_id and (student is None or str(student.id) != owner_id):
            return Response({"error": "not_your_session"}, status=403)

        # Seconda strada verso l'accredito: capita che il browser rientri qui
        # prima che Stripe abbia consegnato il webhook. Chi arriva primo
        # scrive, l'altro e' un no-op (commerce/services.py dedupa su
        # stripe_payment_id) — cosi' la pagina di successo non mostra un
        # portafoglio ancora vuoto, ne' una lezione non ancora prenotata.
        result = None
        try:
            result = self._activate(session, metadata)
        except Exception as exc:  # noqa: BLE001 — vedi sopra: dettaglio in pagina/log
            logger.exception("verify-session: activation failed (session_id=%s)", session_id)
            return Response({"error": "activation_failed", "detail": _exc_detail(exc)}, status=502)

        return Response({
            "status": session.status, "payment_status": session.payment_status,
            "metadata": metadata, "activation": result,
        })

    def _activate(self, session, metadata):
        result = None
        if session.payment_status == "paid":
            payment_id = session.payment_intent
            if isinstance(payment_id, dict):
                payment_id = payment_id.get("id")
            if payment_id:
                result = activate_package_payment(
                    payment_id=payment_id,
                    amount_cents=session.amount_total or 0,
                    metadata=metadata,
                )
            elif getattr(session, "subscription", None):
                # Pacchetto ricorrente / abbonamento: mode=subscription NON ha
                # un payment_intent, quindi questo ramo mancava e l'attivazione
                # restava appesa al solo webhook (mai consegnato se l'endpoint
                # non è configurato per l'ambiente, es. Sandbox). Stesso handler
                # del webhook, idempotente (update_or_create sull'id Stripe).
                from commerce.webhooks import _handle_subscription_created

                sub_id = session.subscription
                if isinstance(sub_id, dict):
                    sub_id = sub_id.get("id")
                sub = stripe.Subscription.retrieve(sub_id)
                period_end = sub.get("current_period_end")
                if not period_end:
                    # API Stripe recenti: current_period_end vive sugli items
                    items = (sub.get("items") or {}).get("data") or []
                    if items:
                        period_end = items[0].get("current_period_end")
                if period_end:
                    result = _handle_subscription_created({
                        "id": sub.get("id"), "status": sub.get("status"),
                        "current_period_end": period_end,
                        "customer": sub.get("customer"),
                        "metadata": _meta_dict(sub.get("metadata")) or metadata,
                    })
                else:
                    result = "missing_period_end"

        return result


class InvoicesView(APIView):
    """GET /api/stripe/invoices/ — invoice history + live subscription status
    for the current student's recurring packages/subscriptions."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from students.models import Student, StudentPackage, StudentSubscription

        student = Student.objects.filter(user=request.user).first()
        if student is None:
            return Response({"invoices": [], "subscriptions": []})

        customer_ids = set(
            StudentPackage.objects.filter(student=student)
            .exclude(stripe_customer_id="")
            .values_list("stripe_customer_id", flat=True)
        )
        sub_ids = list(
            StudentPackage.objects.filter(student=student)
            .exclude(stripe_subscription_id="")
            .values_list("stripe_subscription_id", flat=True)
        ) + list(
            StudentSubscription.objects.filter(student=student)
            .exclude(stripe_subscription_id="")
            .values_list("stripe_subscription_id", flat=True)
        )

        invoices = []
        for customer_id in customer_ids:
            try:
                for inv in stripe.Invoice.list(customer=customer_id, limit=20).auto_paging_iter():
                    invoices.append({
                        "id": inv.id, "amount_paid": inv.amount_paid, "currency": inv.currency,
                        "status": inv.status, "created": inv.created,
                        "invoice_pdf": inv.invoice_pdf, "hosted_invoice_url": inv.hosted_invoice_url,
                    })
            except Exception:
                continue
        invoices.sort(key=lambda i: i["created"], reverse=True)

        subscriptions = []
        for sub_id in sub_ids:
            try:
                sub = stripe.Subscription.retrieve(sub_id)
            except Exception:
                continue
            item = sub["items"]["data"][0] if sub["items"]["data"] else None
            subscriptions.append({
                "subscription_id": sub.id,
                "next_payment_at": sub.current_period_end if sub.status == "active" and not sub.cancel_at_period_end else None,
                "next_payment_amount": item["price"]["unit_amount"] if item else None,
                "cancel_at": sub.cancel_at,
                "cancelled_at": sub.canceled_at,
                "currency": sub.currency,
                "status": sub.status,
            })

        return Response({"invoices": invoices, "subscriptions": subscriptions})


class BillingPortalView(APIView):
    """POST /api/stripe/portal/ — opens the Stripe billing portal for the
    student's most recent recurring-purchase Stripe customer id."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        from students.models import Student, StudentPackage

        student = Student.objects.filter(user=request.user).first()
        if student is None:
            return Response({"error": "no_student_profile"}, status=400)

        sp = (
            StudentPackage.objects.filter(student=student)
            .exclude(stripe_customer_id="")
            .order_by("-purchased_at")
            .first()
        )
        if sp is None:
            return Response({"error": "no_billing_account"}, status=404)

        try:
            session = stripe.billing_portal.Session.create(
                customer=sp.stripe_customer_id, return_url=f"{settings.FRONTEND_URL}/student/buy",
            )
        except Exception as exc:
            return Response({"error": "stripe_error", "detail": str(exc)}, status=502)
        return Response({"url": session.url})


class OnboardView(APIView):
    """POST /api/stripe/onboard/ — school starts/resumes Connect Express onboarding."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        school = School.objects.filter(pk=request.user.active_school_id).first()
        if school is None:
            return Response({"error": "no_active_school"}, status=400)
        try:
            url = start_connect_onboarding(
                school,
                refresh_url=request.data.get("refresh_url") or f"{settings.FRONTEND_URL}/school/payments?onboard=refresh",
                return_url=request.data.get("return_url") or f"{settings.FRONTEND_URL}/school/payments?onboard=success",
            )
        except CheckoutError as exc:
            # Tipicamente il paese della scuola: va corretto prima di aprire
            # l'account, non dopo (il paese Stripe non si cambia).
            return Response({"error": str(exc), "country": school.country or None}, status=400)
        except Exception as exc:
            return Response({"error": "stripe_error", "detail": str(exc)}, status=502)
        return Response({"url": url})


class OnboardStatusView(APIView):
    """GET /api/stripe/onboard/status/ — {connected, onboarding_complete,
    account_id}: connected is true once a Stripe Connect account exists at
    all, onboarding_complete once Stripe has cleared it for charges."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        school = School.objects.filter(pk=request.user.active_school_id).first()
        if school is None:
            return Response({"error": "no_active_school"}, status=400)
        complete = refresh_onboarding_status(school)
        return Response({
            "connected": bool(school.stripe_account_id),
            "onboarding_complete": complete,
            "account_id": school.stripe_account_id or None,
        })


class RefundView(APIView):
    """POST /api/stripe/refund/ — {transaction_id}."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        tx = Transaction.objects.filter(pk=request.data.get("transaction_id")).first()
        if tx is None:
            return Response({"error": "not_found"}, status=404)
        if not is_hq(request.user) and tx.school_id != request.user.active_school_id:
            raise PermissionDenied()
        try:
            refund_transaction(tx)
        except CheckoutError as exc:
            return Response({"error": str(exc)}, status=400)
        except Exception as exc:
            return Response({"error": "stripe_error", "detail": str(exc)}, status=502)
        return Response({"status": "refunded"})


@method_decorator(csrf_exempt, name="dispatch")
class StripeWebhookView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        sig_header = request.META.get("HTTP_STRIPE_SIGNATURE", "")
        try:
            event = stripe.Webhook.construct_event(request.body, sig_header, settings.STRIPE_WEBHOOK_SECRET)
        except (ValueError, stripe.error.SignatureVerificationError):
            return HttpResponse(status=400)

        result = stripe_webhooks.handle_event(event)
        return Response({"received": True, "result": result})
