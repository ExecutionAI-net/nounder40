from datetime import date

from django.db.models import Count
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.viewsets import SchoolScopedModelViewSet, is_hq

from .models import CompensationPlan, Teacher, TeacherCompensationPayment, TeacherSchool
from .serializers import (
    CompensationPlanSerializer,
    TeacherCompensationPaymentSerializer,
    TeacherSerializer,
)
from .services import compute_lesson_fee, monthly_compensation


class TeacherRequiredMixin:
    permission_classes = [IsAuthenticated]

    def get_teacher(self):
        teacher = Teacher.objects.filter(user=self.request.user).first()
        if teacher is None:
            raise PermissionDenied("No teacher profile for this account.")
        return teacher


class TeacherProfileView(TeacherRequiredMixin, APIView):
    def get(self, request):
        return Response(TeacherSerializer(self.get_teacher()).data)

    def patch(self, request):
        serializer = TeacherSerializer(self.get_teacher(), data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class TeacherLessonsView(TeacherRequiredMixin, APIView):
    """Assigned lessons (the teacher's calendar). Filters: ?from= ?to= ?date=."""

    def get(self, request):
        from catalog.models import Lesson
        from catalog.serializers import LessonBrowseSerializer

        qs = (
            Lesson.objects.filter(teacher=self.get_teacher())
            .select_related("school", "teacher", "lesson_type", "room", "room__location")
            .order_by("date", "start_time")
        )
        p = request.query_params
        if p.get("date"):
            qs = qs.filter(date=p["date"])
        if p.get("from"):
            qs = qs.filter(date__gte=p["from"])
        if p.get("to"):
            qs = qs.filter(date__lte=p["to"])
        return Response(LessonBrowseSerializer(qs[:1000], many=True).data)


class TeacherStatsView(TeacherRequiredMixin, APIView):
    def get(self, request):
        from bookings.models import Attendance
        from catalog.models import Lesson

        teacher = self.get_teacher()
        past = Lesson.objects.filter(teacher=teacher, date__lt=date.today())
        upcoming = Lesson.objects.filter(teacher=teacher, date__gte=date.today())
        attendance = Attendance.objects.filter(teacher=teacher)
        present = attendance.filter(status="present").count()
        total_marked = attendance.count()
        return Response(
            {
                "lessons_taught": past.count(),
                "lessons_upcoming": upcoming.count(),
                "attendance_marked": total_marked,
                "present": present,
                "no_show": total_marked - present,
                "attendance_rate": round(present / total_marked, 3) if total_marked else None,
            }
        )


class CompensationPlanViewSet(SchoolScopedModelViewSet):
    queryset = CompensationPlan.objects.prefetch_related("rates").all()
    serializer_class = CompensationPlanSerializer

    @action(detail=True, methods=["post"])
    def simulate(self, request, pk=None):
        """Preview earnings for a given lesson scenario: {students, lesson_type_id?}."""
        plan = self.get_object()
        students = int(request.data.get("students", 0))
        lesson_type_id = request.data.get("lesson_type_id")
        fee = compute_lesson_fee(plan, lesson_type_id=lesson_type_id, students_count=students)
        return Response({"plan": plan.name, "students": students, "fee": fee})


class TeacherCompensationPaymentViewSet(SchoolScopedModelViewSet):
    queryset = TeacherCompensationPayment.objects.select_related("teacher").all()
    serializer_class = TeacherCompensationPaymentSerializer
    filterset_fields = ["teacher", "month", "status"]


class SchoolTeacherCompensationView(APIView):
    """GET /api/school/teachers/{id}/compensation/?month=YYYY-MM — monthly report."""

    permission_classes = [IsAuthenticated]

    def get(self, request, teacher_id):
        from .models import Teacher as TeacherModel

        user = request.user
        # HQ may inspect any school via ?school=; without it, fall back to the
        # caller's own active school (multi-role users browsing the School panel).
        school_id = (
            request.query_params.get("school") if is_hq(user) else None
        ) or user.active_school_id
        if not school_id:
            return Response({"error": "school is required"}, status=400)
        teacher = TeacherModel.objects.filter(pk=teacher_id).first()
        if teacher is None or not TeacherSchool.objects.filter(teacher=teacher, school_id=school_id).exists():
            return Response({"error": "not_found"}, status=404)
        month = request.query_params.get("month") or date.today().strftime("%Y-%m")
        return Response(monthly_compensation(teacher, teacher.school_links.get(school_id=school_id).school, month))


class TeacherCompensationView(TeacherRequiredMixin, APIView):
    """GET /api/teacher/compensation/?school=&month= — the teacher's own earnings."""

    def get(self, request):
        teacher = self.get_teacher()
        school_id = request.query_params.get("school")
        link = TeacherSchool.objects.filter(teacher=teacher, school_id=school_id).first() if school_id else (
            TeacherSchool.objects.filter(teacher=teacher).first()
        )
        if link is None:
            return Response({"error": "teacher has no school assignment"}, status=400)
        month = request.query_params.get("month") or date.today().strftime("%Y-%m")
        return Response(monthly_compensation(teacher, link.school, month))


class TeacherCompensationOverviewView(TeacherRequiredMixin, APIView):
    """GET /api/teacher/compensation-overview/?month=YYYY-MM — earnings across
    every school this teacher is assigned to, with a per-lesson breakdown
    (bonus flags included), each school's payment status, and a 6-month
    trend. Powers the 'My Compensation' dashboard page."""

    def get(self, request):
        from calendar import monthrange

        from bookings.models import Attendance
        from catalog.models import Lesson

        from .models import TeacherCompensationPayment
        from .services import compute_lesson_fee

        teacher = self.get_teacher()
        month = request.query_params.get("month") or date.today().strftime("%Y-%m")
        links = list(
            TeacherSchool.objects.filter(teacher=teacher, active=True).select_related("school", "compensation_plan")
        )

        year, mon = (int(x) for x in month.split("-"))
        start = date(year, mon, 1)
        end = date(year, mon, monthrange(year, mon)[1])

        entries = []
        for link in links:
            school, link_plan = link.school, link.compensation_plan
            lessons = (
                Lesson.objects.filter(teacher=teacher, school=school, date__gte=start, date__lte=end)
                .exclude(status="cancelled")
                .select_related("course", "lesson_type", "compensation_plan")
                .order_by("date", "start_time")
            )
            lessons = list(lessons)
            present_by_lesson = {
                row["lesson_id"]: row["n"]
                for row in Attendance.objects.filter(
                    lesson_id__in=[lsn.id for lsn in lessons], status="present"
                ).values("lesson_id").annotate(n=Count("id"))
            }
            lesson_rows, total, bonus_lessons = [], 0.0, 0
            for lesson in lessons:
                # Piano del singolo orario (scheda classe) → fallback al piano
                # del collegamento insegnante-scuola
                plan = lesson.compensation_plan or link_plan
                students_count = present_by_lesson.get(lesson.id, 0)
                fee = (
                    compute_lesson_fee(plan, lesson_type_id=lesson.lesson_type_id, students_count=students_count)
                    if plan else 0.0
                )
                total += fee
                has_bonus = bool(plan and plan.bonus_threshold is not None and students_count > plan.bonus_threshold)
                threshold_gap = (
                    max(0, plan.bonus_threshold + 1 - students_count)
                    if plan and plan.bonus_threshold is not None and not has_bonus
                    else 0
                )
                if has_bonus:
                    bonus_lessons += 1
                course_name = (lesson.course.name or None) if lesson.course_id else None
                if not course_name and lesson.lesson_type_id:
                    course_name = lesson.lesson_type.name_en or lesson.lesson_type.name_it
                lesson_rows.append({
                    "id": str(lesson.id), "date": lesson.date.isoformat(),
                    "start_time": lesson.start_time.strftime("%H:%M") if lesson.start_time else None,
                    "course": course_name, "plan_name": plan.name if plan else None,
                    "students": students_count, "fee": fee,
                    "has_bonus": has_bonus, "threshold_gap": threshold_gap,
                })

            payment = TeacherCompensationPayment.objects.filter(teacher=teacher, school=school, month=month).first()
            entries.append({
                "school": {"name": school.name, "city": school.city},
                "lessons": lesson_rows, "total": round(total, 2), "bonus_lessons": bonus_lessons,
                "payment": (
                    {
                        "amount": float(payment.amount), "status": payment.status,
                        "paid_at": payment.paid_at, "note": payment.note or None,
                    }
                    if payment else None
                ),
            })

        months = []
        y, mo = year, mon
        for _ in range(6):
            months.append(f"{y}-{mo:02d}")
            mo -= 1
            if mo == 0:
                mo, y = 12, y - 1
        months.reverse()
        trend = [
            {"month": m, "total": round(sum(monthly_compensation(teacher, link.school, m)["total"] for link in links), 2)}
            for m in months
        ]

        return Response({"month": month, "entries": entries, "trend": trend})


class TeacherSchoolAssignmentsView(TeacherRequiredMixin, APIView):
    """GET /api/teacher/schools/ — this teacher's school assignments with
    their compensation plan details (dashboard 'compensation plans' section)."""

    def get(self, request):
        from catalog.models import Lesson

        teacher = self.get_teacher()
        links = TeacherSchool.objects.filter(teacher=teacher, active=True).select_related("school", "compensation_plan")
        data = []
        for link in links:
            plan = link.compensation_plan
            plan_label = plan.name if plan else None
            if plan is None:
                # Nessun piano sul collegamento: mostra quello assegnato agli
                # orari delle sue lezioni in questa scuola (scheda classe)
                plan_ids = (
                    Lesson.objects.filter(teacher=teacher, school=link.school)
                    .exclude(status="cancelled")
                    .exclude(compensation_plan=None)
                    .values_list("compensation_plan", flat=True)
                    .distinct()
                )
                lesson_plans = list(CompensationPlan.objects.filter(id__in=plan_ids))
                if lesson_plans:
                    plan = lesson_plans[0]
                    # Più piani per orario: etichetta combinata, numeri del primo
                    plan_label = ", ".join(sorted(p.name for p in lesson_plans))
            data.append({
                "school_id": str(link.school_id),
                "school_name": link.school.name,
                "school_city": link.school.city,
                "compensation_plan": (
                    {
                        "name": plan_label or plan.name, "base_fee": str(plan.base_fee),
                        "bonus_threshold": plan.bonus_threshold, "bonus_per_student": str(plan.bonus_per_student or 0),
                    }
                    if plan else None
                ),
            })
        return Response(data)


def _send_teacher_invite_email(user):
    """Same shape as accounts.hq_views._send_invite_email — an invited
    teacher sets their password via the generic /api/auth/complete-invite/
    flow, which works for any role with an unusable password."""
    from django.conf import settings
    from django.contrib.auth.tokens import default_token_generator
    from django.db import transaction
    from django.utils.encoding import force_bytes
    from django.utils.http import urlsafe_base64_encode

    from notifications.tasks import send_transactional_email_task

    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    setup_url = f"{settings.FRONTEND_URL}/setup-account?uid={uid}&token={token}"
    transaction.on_commit(
        lambda: send_transactional_email_task.delay(
            to_email=user.email, to_name=user.full_name, key="team_invite",
            context={"user_name": user.full_name or user.email, "setup_url": setup_url, "platform_name": "No Under 40"},
        )
    )


class SchoolTeacherListView(APIView):
    """GET/POST/DELETE /api/school/teachers/ — teacher roster for the
    caller's active school (spec 7.5). POST creates a teacher (or links an
    already-existing Teacher, matched by email, to this school as well —
    spec: "Teacher can be assigned to multiple schools") and sends a
    ZeptoMail invite. DELETE only unlinks the teacher from this school; the
    Teacher/User record itself is kept since they may teach elsewhere."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        school_id = request.user.active_school_id
        links = TeacherSchool.objects.filter(school_id=school_id).select_related("teacher").order_by("teacher__name")
        data = [
            {"teacher_id": str(link.teacher_id), "active": link.active, "teachers": TeacherSerializer(link.teacher).data}
            for link in links
        ]
        return Response({"teachers": data, "pending": []})

    def post(self, request):
        from accounts.models import Role, User

        school_id = request.user.active_school_id
        if not school_id:
            return Response({"error": "no_active_school"}, status=status.HTTP_400_BAD_REQUEST)

        first_name = (request.data.get("first_name") or "").strip()
        last_name = (request.data.get("last_name") or "").strip()
        name = " ".join(filter(None, [first_name, last_name])) or (request.data.get("name") or "").strip()
        if not first_name and name:  # old clients send a single name
            first_name, _, last_name = name.partition(" ")
        email = (request.data.get("email") or "").strip().lower()
        phone = request.data.get("phone") or ""
        if not name or not email:
            return Response({"error": "name_and_email_required"}, status=status.HTTP_400_BAD_REQUEST)

        teacher = Teacher.objects.filter(email__iexact=email).first()
        needs_invite = False
        if teacher is None:
            user = User.objects.filter(email__iexact=email).first()
            if user is None:
                user = User(
                    email=email, full_name=name, first_name=first_name, last_name=last_name,
                    role=Role.TEACHER, roles=[Role.TEACHER],
                )
                user.set_unusable_password()
                user.save()
            teacher = Teacher.objects.create(
                user=user, name=name, first_name=first_name, last_name=last_name, email=email, phone=phone,
            )
            needs_invite = True
        elif teacher.user_id and not teacher.user.has_usable_password():
            needs_invite = True

        link, _ = TeacherSchool.objects.get_or_create(teacher=teacher, school_id=school_id, defaults={"active": True})
        if not link.active:
            link.active = True
            link.save(update_fields=["active"])

        email_sent = False
        if needs_invite and teacher.user_id:
            _send_teacher_invite_email(teacher.user)
            email_sent = True

        return Response(
            {
                "teacher_id": str(teacher.id), "active": link.active, "email_sent": email_sent,
                "teachers": TeacherSerializer(teacher).data,
            },
            status=status.HTTP_201_CREATED,
        )

    def delete(self, request):
        school_id = request.user.active_school_id
        teacher_id = request.data.get("teacher_id")
        deleted, _ = TeacherSchool.objects.filter(teacher_id=teacher_id, school_id=school_id).delete()
        return Response({"deleted": deleted})


class SchoolTeacherDetailView(APIView):
    """PATCH /api/school/teachers/{teacher_id}/ — edit name/phone/email."""

    permission_classes = [IsAuthenticated]

    def patch(self, request, teacher_id):
        school_id = request.user.active_school_id
        if not TeacherSchool.objects.filter(teacher_id=teacher_id, school_id=school_id).exists():
            return Response({"error": "not_found"}, status=status.HTTP_404_NOT_FOUND)
        teacher = Teacher.objects.filter(pk=teacher_id).first()
        if teacher is None:
            return Response({"error": "not_found"}, status=status.HTTP_404_NOT_FOUND)

        if "phone" in request.data:
            teacher.phone = request.data["phone"]
        for field in ("first_name", "last_name"):
            if field in request.data:
                setattr(teacher, field, (request.data.get(field) or "").strip())
        if "name" in request.data and "first_name" not in request.data:
            # Nome intero → nei campi separati, altrimenti save() lo
            # ricomporrebbe dai vecchi first/last annullando la modifica
            head, _, rest = (request.data.get("name") or "").strip().partition(" ")
            teacher.first_name, teacher.last_name = head, rest
        new_email = (request.data.get("email") or "").strip().lower()
        if new_email and new_email != teacher.email.lower():
            teacher.email = new_email
            if teacher.user_id:
                teacher.user.email = new_email
                teacher.user.save(update_fields=["email"])
        teacher.save()
        return Response(TeacherSerializer(teacher).data)


class SchoolTeacherResendInviteView(APIView):
    """POST /api/school/teachers/resend/ — {teacher_id}."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        school_id = request.user.active_school_id
        teacher_id = request.data.get("teacher_id")
        link = (
            TeacherSchool.objects.filter(teacher_id=teacher_id, school_id=school_id)
            .select_related("teacher__user")
            .first()
        )
        if link is None or link.teacher.user_id is None:
            return Response({"error": "not_found"}, status=status.HTTP_404_NOT_FOUND)
        _send_teacher_invite_email(link.teacher.user)
        return Response({"sent": True})


class SchoolCompensationPaymentsSummaryView(APIView):
    """GET /api/school/compensation-payments/summary/?month=YYYY-MM — every
    active teacher at this school with their computed compensation for the
    month (lesson_count/bonus_lessons/total, via the same monthly_compensation
    service the teacher's own view uses) merged with any existing payment
    record. POST upserts that payment record (mark paid/pending). A separate
    path from /school/compensation-payments/ (the plain CompensationPayment
    CRUD ViewSet, a different, row-per-payment shape) to avoid colliding on
    the same old-API path."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        school_id = request.user.active_school_id
        if not school_id:
            return Response({"error": "no_active_school"}, status=400)
        month = request.query_params.get("month") or date.today().strftime("%Y-%m")

        rows = []
        for link in TeacherSchool.objects.filter(school_id=school_id, active=True).select_related(
            "teacher", "teacher__user", "compensation_plan"
        ):
            teacher = link.teacher
            comp = monthly_compensation(teacher, link.school, month)
            # has_bonus è calcolato per lezione col piano effettivo (orario o link)
            bonus_lessons = sum(1 for b in comp["breakdown"] if b.get("has_bonus"))

            payment = TeacherCompensationPayment.objects.filter(
                school_id=school_id, teacher=teacher, month=month
            ).first()

            rows.append({
                "teacher_id": str(teacher.id),
                "teacher": {"id": str(teacher.id), "name": teacher.name, "email": teacher.email},
                "lesson_count": len(comp["breakdown"]),
                "bonus_lessons": bonus_lessons,
                "total": comp["total"],
                "payment": {
                    "amount": float(payment.amount), "status": payment.status,
                    "paid_at": payment.paid_at, "note": payment.note or None,
                    "payment_method": payment.payment_method or None,
                } if payment else None,
            })
        return Response(rows)

    def post(self, request):
        school_id = request.user.active_school_id
        if not school_id:
            return Response({"error": "no_active_school"}, status=400)

        teacher_id = request.data.get("teacher_id")
        month = request.data.get("month")
        if not (teacher_id and month):
            return Response({"error": "teacher_id and month are required"}, status=400)

        payment, _ = TeacherCompensationPayment.objects.update_or_create(
            school_id=school_id, teacher_id=teacher_id, month=month,
            defaults={
                "amount": request.data.get("amount") or 0,
                "status": request.data.get("status") or "pending",
                "note": request.data.get("note") or "",
                "payment_method": request.data.get("payment_method") or "",
                "paid_at": request.data.get("paid_date") or None,
            },
        )
        return Response(TeacherCompensationPaymentSerializer(payment).data, status=status.HTTP_201_CREATED)
