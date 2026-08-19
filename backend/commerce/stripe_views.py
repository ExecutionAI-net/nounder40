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
    school_id, discount_code?, success_url?, cancel_url?}."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        from catalog.models import Package, SubscriptionCatalog
        from students.models import Student

        student = Student.objects.filter(user=request.user).first()
        if student is None:
            return Response({"error": "no_student_profile"}, status=400)

        kind = request.data.get("kind")
        school = School.objects.filter(pk=request.data.get("school_id")).first()
        if school is None:
            return Response({"error": "school_not_found"}, status=404)

        model = {"package": Package, "subscription": SubscriptionCatalog}.get(kind)
        if model is None:
            return Response({"error": "invalid_kind"}, status=400)
        item = model.objects.filter(pk=request.data.get("item_id"), school=school).first()
        if item is None:
            return Response({"error": "item_not_found"}, status=404)

        discount = None
        code = request.data.get("discount_code")
        if code:
            discount = DiscountCode.objects.filter(school=school, code=code, active=True).first()
            if discount is None:
                return Response({"error": "invalid_discount_code"}, status=400)

        try:
            session = create_checkout_session(
                kind=kind, item=item, school=school, student=student,
                success_url=request.data.get("success_url", "http://localhost/checkout/success"),
                cancel_url=request.data.get("cancel_url", "http://localhost/checkout/cancel"),
                discount_code=discount,
            )
        except CheckoutError as exc:
            return Response({"error": str(exc)}, status=400)
        except stripe.error.StripeError as exc:
            return Response({"error": "stripe_error", "detail": str(exc)}, status=502)

        return Response({"checkout_url": session.url, "session_id": session.id})


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


class OnboardView(APIView):
    """POST /api/stripe/onboard/ — school starts/resumes Connect Express onboarding."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        school = School.objects.filter(pk=request.user.active_school_id).first()
        if school is None:
            return Response({"error": "no_active_school"}, status=400)
        url = start_connect_onboarding(
            school,
            refresh_url=request.data.get("refresh_url", "http://localhost/school/settings"),
            return_url=request.data.get("return_url", "http://localhost/school/settings"),
        )
        return Response({"url": url})


class OnboardStatusView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        school = School.objects.filter(pk=request.user.active_school_id).first()
        if school is None:
            return Response({"error": "no_active_school"}, status=400)
        complete = refresh_onboarding_status(school)
        return Response({"complete": complete, "stripe_account_id": school.stripe_account_id})


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
