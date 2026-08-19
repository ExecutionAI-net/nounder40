"""Transaction listing + summary reports (CLAUDE.md 6.7 HQ payments, 7.10 school
payments, 7.17 lesson/student analytics)."""

from datetime import date

from django.db.models import Count, Sum
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsHQ
from core.viewsets import is_hq

from .models import Transaction
from .serializers import TransactionSerializer


def _filtered_transactions(qs, params):
    if params.get("status"):
        qs = qs.filter(status=params["status"])
    if params.get("type"):
        qs = qs.filter(type=params["type"])
    if params.get("method"):
        qs = qs.filter(payment_method=params["method"])
    if params.get("date_from"):
        qs = qs.filter(created_at__date__gte=params["date_from"])
    if params.get("date_to"):
        qs = qs.filter(created_at__date__lte=params["date_to"])
    return qs


class HQTransactionsView(APIView):
    """GET /api/hq/transactions/ — consolidated view across all schools."""

    permission_classes = [IsAuthenticated, IsHQ]

    def get(self, request):
        qs = Transaction.objects.select_related("school", "student").all()
        if request.query_params.get("school"):
            qs = qs.filter(school_id=request.query_params["school"])
        qs = _filtered_transactions(qs, request.query_params).order_by("-created_at")
        return Response(TransactionSerializer(qs[:1000], many=True).data)


class SchoolTransactionsView(APIView):
    """GET /api/school/transactions/ — this school's transactions."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        school_id = request.query_params.get("school") if is_hq(user) else user.active_school_id
        if not school_id:
            return Response({"error": "school is required"}, status=400)
        qs = Transaction.objects.filter(school_id=school_id).select_related("student")
        qs = _filtered_transactions(qs, request.query_params).order_by("-created_at")
        return Response(TransactionSerializer(qs[:1000], many=True).data)


def _summary(qs):
    completed = qs.filter(status="completed")
    agg = completed.aggregate(revenue=Sum("amount"), platform_fee=Sum("platform_fee"), count=Count("id"))
    return {
        "monthly_revenue": float(agg["revenue"] or 0),
        "platform_fee_total": float(agg["platform_fee"] or 0),
        "total_transactions": agg["count"] or 0,
        "pending": qs.filter(status="pending").count(),
        "refunded": qs.filter(status="refunded").count(),
    }


class SchoolReportsView(APIView):
    """GET /api/school/reports/ — dashboard summary KPIs (CLAUDE.md 7.17)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from datetime import timedelta

        from bookings.models import Attendance, Booking
        from catalog.models import Lesson
        from schools.models import SchoolStudent
        from students.models import StudentSubscription

        user = request.user
        school_id = request.query_params.get("school") if is_hq(user) else user.active_school_id
        if not school_id:
            return Response({"error": "school is required"}, status=400)

        today = date.today()
        month_start = today.replace(day=1)
        tx = Transaction.objects.filter(school_id=school_id, created_at__date__gte=month_start)

        # Monday-Sunday of the current week (dashboard KPI card).
        week_start = today - timedelta(days=today.weekday())
        week_end = week_start + timedelta(days=6)

        lessons = Lesson.objects.filter(school_id=school_id)
        bookings = Booking.objects.filter(school_id=school_id)
        attendance = Attendance.objects.filter(lesson__school_id=school_id)

        # School-facing revenue is net of the platform fee (school_amount),
        # distinct from _summary()'s gross `amount` (used by the HQ-style summary).
        monthly_revenue_net = tx.filter(status="completed").aggregate(s=Sum("school_amount"))["s"] or 0

        return Response(
            {
                **_summary(tx),
                "monthly_revenue_net": float(monthly_revenue_net),
                "active_students": SchoolStudent.objects.filter(school_id=school_id).count(),
                "weekly_lessons": lessons.filter(
                    date__gte=week_start, date__lte=week_end
                ).exclude(status="cancelled").count(),
                "active_subscriptions_count": StudentSubscription.objects.filter(
                    school_id=school_id, status="active"
                ).count(),
                "lessons_completed": lessons.filter(status="completed").count(),
                "lessons_scheduled": lessons.filter(status="scheduled").count(),
                "bookings_total": bookings.count(),
                "bookings_cancelled": bookings.filter(status="cancelled").count(),
                "no_shows": attendance.filter(status="no_show").count(),
                "credits_used": bookings.aggregate(s=Sum("credits_deducted"))["s"] or 0,
            }
        )


class HQReportsView(APIView):
    """GET /api/hq/reports/ — network-wide KPIs (CLAUDE.md 6.12)."""

    permission_classes = [IsAuthenticated, IsHQ]

    def get(self, request):
        from bookings.models import Booking
        from catalog.models import Lesson
        from schools.models import School
        from students.models import Student, StudentSubscription

        today = date.today()
        month_start = today.replace(day=1)
        tx = Transaction.objects.filter(created_at__date__gte=month_start)

        return Response(
            {
                **_summary(tx),
                "active_schools": School.objects.filter(active=True).count(),
                "total_schools": School.objects.count(),
                "total_students": Student.objects.count(),
                "lessons_this_week": Lesson.objects.filter(
                    date__gte=today, date__lt=today.fromordinal(today.toordinal() + 7)
                ).count(),
                "active_subscriptions": StudentSubscription.objects.filter(status="active").count(),
                "bookings_total": Booking.objects.count(),
            }
        )
