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
from .models import DiscountCode, Transaction
from .stripe_service import (
    CheckoutError,
    create_checkout_session,
    refresh_onboarding_status,
    refund_transaction,
    start_connect_onboarding,
)


class CheckoutView(APIView):
    """POST /api/stripe/checkout/ — {kind: 'package'|'subscription', item_id,
    school_id?, discount_code?, success_url?, cancel_url?}. Also accepts the
    frontend's `type`/`product_id` naming as aliases; school_id is optional
    and, when omitted, derived from the item itself (each Package/
    SubscriptionCatalog row belongs to exactly one school)."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        from catalog.models import Package, SubscriptionCatalog
        from students.models import Student

        student = Student.objects.filter(user=request.user).first()
        if student is None:
            return Response({"error": "no_student_profile"}, status=400)

        kind = request.data.get("kind") or request.data.get("type")
        model = {"package": Package, "subscription": SubscriptionCatalog}.get(kind)
        if model is None:
            return Response({"error": "invalid_kind"}, status=400)

        item_id = request.data.get("item_id") or request.data.get("product_id")
        item = model.objects.filter(pk=item_id).first()
        if item is None:
            return Response({"error": "item_not_found"}, status=404)

        school_id = request.data.get("school_id") or str(item.school_id)
        school = School.objects.filter(pk=school_id).first()
        if school is None or item.school_id != school.id:
            return Response({"error": "school_not_found"}, status=404)

        discount = None
        code = request.data.get("discount_code")
        if code:
            discount = DiscountCode.objects.filter(school=school, code=code, active=True).first()
            if discount is None:
                return Response({"error": "invalid_discount_code"}, status=400)

        # Buy-ahead (start="after_current"): the new package's validity — and,
        # for a recurring one, its billing — starts when the student's current
        # package for this school expires, instead of overlapping it.
        start_at = None
        if request.data.get("start") == "after_current" and kind == "package":
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

        redirect_to = request.data.get("redirect_to")
        default_success = f"{settings.FRONTEND_URL}{redirect_to or '/student/buy'}" + (
            "&payment=success" if redirect_to and "?" in redirect_to else "?payment=success"
        )
        default_cancel = f"{settings.FRONTEND_URL}/student/buy?payment=cancelled"

        try:
            session = create_checkout_session(
                kind=kind, item=item, school=school, student=student,
                success_url=request.data.get("success_url") or default_success,
                cancel_url=request.data.get("cancel_url") or default_cancel,
                discount_code=discount,
                start_at=start_at,
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


class VerifySessionView(APIView):
    """GET /api/stripe/verify-session/?session_id= — frontend calls this after
    the Checkout redirect to confirm status before showing the success page."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        session_id = request.query_params.get("session_id")
        if not session_id:
            return Response({"error": "session_id required"}, status=400)
        session = stripe.checkout.Session.retrieve(session_id)
        return Response(
            {"status": session.status, "payment_status": session.payment_status, "metadata": session.metadata}
        )


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
        url = start_connect_onboarding(
            school,
            refresh_url=request.data.get("refresh_url") or f"{settings.FRONTEND_URL}/school/payments?onboard=refresh",
            return_url=request.data.get("return_url") or f"{settings.FRONTEND_URL}/school/payments?onboard=success",
        )
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
