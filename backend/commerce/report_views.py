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


class SchoolReportsDetailedView(APIView):
    """GET /api/school/reports/detailed/ — the Reports page's lessons/
    students/teachers tabs (spec 7.17). A separate endpoint from
    /school/reports/ (dashboard KPI summary, a different shape already
    relied on) since both would otherwise collide on the same old-API path."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from bookings.models import Attendance, Booking
        from catalog.models import Lesson
        from schools.models import SchoolStudent
        from students.models import StudentPackage
        from teachers.models import Teacher, TeacherSchool
        from teachers.services import monthly_compensation

        user = request.user
        school_id = request.query_params.get("school") if is_hq(user) else user.active_school_id
        if not school_id:
            return Response({"error": "school is required"}, status=400)

        # ── Lessons ──
        lessons_qs = (
            Lesson.objects.filter(school_id=school_id)
            .select_related("course", "lesson_type", "teacher", "room", "room__location")
            .order_by("-date", "-start_time")[:500]
        )
        plan_by_teacher = {
            str(link.teacher_id): link.compensation_plan
            for link in TeacherSchool.objects.filter(school_id=school_id).select_related("compensation_plan")
        }
        lesson_rows = []
        for lesson in lessons_qs:
            name = (lesson.course.name.strip() if lesson.course_id and lesson.course.name else "") or (
                lesson.lesson_type.name_en if lesson.lesson_type_id else "—"
            )
            plan = plan_by_teacher.get(str(lesson.teacher_id))
            lesson_rows.append({
                "id": str(lesson.id), "name": name, "date": lesson.date,
                "teacher": lesson.teacher.name if lesson.teacher_id else "—",
                "teacher_id": str(lesson.teacher_id) if lesson.teacher_id else None,
                "room": lesson.room.name if lesson.room_id else "—",
                "room_id": str(lesson.room_id) if lesson.room_id else None,
                "room_cost": lesson.room.cost if lesson.room_id else None,
                "location": lesson.room.location.name if lesson.room_id and lesson.room.location_id else "—",
                "location_id": str(lesson.room.location_id) if lesson.room_id and lesson.room.location_id else None,
                "compensation_plan": plan.name if plan else "—",
                "compensation_plan_id": str(plan.id) if plan else None,
                "capacity": lesson.max_capacity,
                "booked": lesson.current_bookings,
                "attended": Attendance.objects.filter(lesson=lesson, status="present").count(),
                "no_shows": Attendance.objects.filter(lesson=lesson, status="no_show").count(),
                "cancelled": Booking.objects.filter(lesson=lesson, status="cancelled").count(),
                "status": lesson.status,
            })

        # ── Students ──
        student_rows = []
        credits_total = 0
        credits_count = 0
        docs_expired = 0
        for link in SchoolStudent.objects.filter(school_id=school_id).select_related("student"):
            student = link.student
            remaining = StudentPackage.objects.filter(
                student=student, school_id=school_id, status="active"
            ).aggregate(s=Sum("credits_remaining"))["s"] or 0
            burned = Booking.objects.filter(
                student=student, school_id=school_id, credits_deducted__gt=0,
            ).exclude(status="confirmed").exclude(status="cancelled", credit_refunded=True).aggregate(
                s=Sum("credits_deducted")
            )["s"] or 0
            last_att = (
                Booking.objects.filter(student=student, school_id=school_id, status="attended")
                .order_by("-lesson__date").select_related("lesson").first()
            )
            has_active = StudentPackage.objects.filter(student=student, school_id=school_id, status="active").exists()
            student_rows.append({
                "id": str(student.id), "name": student.name,
                "credits_remaining": remaining, "credits_burned": burned,
                "last_attendance": last_att.lesson.date.isoformat() if last_att else "—",
                "total_attended": Booking.objects.filter(student=student, school_id=school_id, status="attended").count(),
                "has_active_package": has_active,
            })
            if remaining or has_active:
                credits_total += remaining
                credits_count += 1
            from students.models import StudentDocument
            docs_expired += StudentDocument.objects.filter(student=student, school_id=school_id, status="expired").count()

        # ── Teachers ──
        teacher_rows = []
        today = date.today()
        month_start = today.replace(day=1)
        for link in TeacherSchool.objects.filter(school_id=school_id, active=True).select_related("teacher"):
            teacher = link.teacher
            lessons_month = Lesson.objects.filter(
                teacher=teacher, school_id=school_id, date__gte=month_start, date__lte=today
            ).exclude(status="cancelled").count()
            total_students = (
                Booking.objects.filter(lesson__teacher=teacher, school_id=school_id)
                .values("student_id").distinct().count()
            )
            att_qs = Attendance.objects.filter(teacher=teacher, lesson__school_id=school_id)
            present_count = att_qs.filter(status="present").count()
            att_total = att_qs.count()
            attendance_rate = f"{round(present_count / att_total * 100, 1)}" if att_total else "—"
            comp = monthly_compensation(teacher, link.school, today.strftime("%Y-%m"))
            teacher_rows.append({
                "id": str(teacher.id), "name": teacher.name,
                "lessons_this_month": lessons_month, "total_students": total_students,
                "attendance_rate": attendance_rate, "compensation_estimate": comp["total"],
            })

        return Response({
            "lessons": {"rows": lesson_rows},
            "students": {
                "total": len(student_rows),
                "avg_credits": f"{round(credits_total / credits_count, 1)}" if credits_count else "0",
                "docs_expired": docs_expired,
                "rows": student_rows,
            },
            "teachers": {"rows": teacher_rows},
        })


class SchoolReportsPackagesView(APIView):
    """GET /api/school/reports/packages/ — every package + subscription
    purchase at this school, one flat row per row (spec 7.17)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from students.models import StudentPackage, StudentSubscription

        user = request.user
        school_id = request.query_params.get("school") if is_hq(user) else user.active_school_id
        if not school_id:
            return Response({"error": "school is required"}, status=400)

        def lang_name(obj):
            return None if obj is None else {"name_en": obj.name_en, "name_it": obj.name_it, "name_es": obj.name_es}

        rows = []
        for p in StudentPackage.objects.filter(school_id=school_id).select_related("student", "package"):
            rows.append({
                "id": str(p.id), "kind": "package", "student_id": str(p.student_id), "student_name": p.student.name,
                "product": lang_name(p.package), "total": p.credits_total, "remaining": p.credits_remaining,
                "started_at": p.purchased_at, "ends_at": p.expires_at, "status": p.status,
                "payment_method": p.payment_method,
            })
        for s in StudentSubscription.objects.filter(school_id=school_id).select_related("student", "subscription_catalog"):
            rows.append({
                "id": str(s.id), "kind": "subscription", "student_id": str(s.student_id), "student_name": s.student.name,
                "product": lang_name(s.subscription_catalog), "total": s.access_total, "remaining": s.access_remaining,
                "started_at": s.started_at, "ends_at": s.current_period_end, "status": s.status,
                "payment_method": None,
            })
        rows.sort(key=lambda r: r["started_at"], reverse=True)
        return Response({"rows": rows})


class SchoolReportsStudentClassesView(APIView):
    """GET /api/school/reports/student-classes/ — per-student attendance
    history + package snapshot (spec 7.17's Student Classes tab)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from bookings.models import Attendance
        from schools.models import SchoolStudent
        from students.models import StudentPackage

        user = request.user
        school_id = request.query_params.get("school") if is_hq(user) else user.active_school_id
        if not school_id:
            return Response({"error": "school is required"}, status=400)

        def lang_name(obj):
            return None if obj is None else {"name_en": obj.name_en, "name_it": obj.name_it, "name_es": obj.name_es}

        rows = []
        for link in SchoolStudent.objects.filter(school_id=school_id).select_related("student"):
            student = link.student
            packages = [
                {
                    "id": str(p.id), "credits_remaining": p.credits_remaining, "credits_total": p.credits_total,
                    "expires_at": p.expires_at, "status": p.status,
                }
                for p in StudentPackage.objects.filter(student=student, school_id=school_id)
            ]
            attendance = []
            att_qs = (
                Attendance.objects.filter(student=student, lesson__school_id=school_id)
                .select_related(
                    "lesson", "lesson__course", "lesson__lesson_type", "lesson__teacher",
                    "lesson__room", "lesson__room__location", "booking",
                )
                .order_by("-lesson__date")[:200]
            )
            for a in att_qs:
                lesson = a.lesson
                course_name = (lesson.course.name.strip() if lesson.course_id and lesson.course.name else "") or (
                    lesson.lesson_type.name_en if lesson.lesson_type_id else "—"
                )
                attendance.append({
                    "lesson_id": str(lesson.id), "date": lesson.date, "start_time": lesson.start_time,
                    "course_name": course_name,
                    "teacher_id": str(lesson.teacher_id) if lesson.teacher_id else None,
                    "teacher_name": lesson.teacher.name if lesson.teacher_id else "—",
                    "room_id": str(lesson.room_id) if lesson.room_id else None,
                    "room_name": lesson.room.name if lesson.room_id else "—",
                    "location_id": str(lesson.room.location_id) if lesson.room_id and lesson.room.location_id else None,
                    "location_name": lesson.room.location.name if lesson.room_id and lesson.room.location_id else "—",
                    "status": a.status,
                    "credits_deducted": a.booking.credits_deducted if a.booking_id else 0,
                    "access_source": a.booking.access_source if a.booking_id else "—",
                })
            rows.append({"student_id": str(student.id), "student_name": student.name, "packages": packages, "attendance": attendance})

        return Response({"rows": rows})


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
