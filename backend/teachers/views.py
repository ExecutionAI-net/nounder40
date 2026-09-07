from datetime import date

from django.db.models import Count, Q
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.params import ensure_object_body, parse_date, parse_int, parse_month, parse_uuid
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
        """A teacher editing their own profile. ``email`` here is a plain
        writable field on the serializer, but it's also the display copy of
        the actual login credential (``User.email``) — left on its own it
        silently desyncs the two (Teacher.email updates, User.email doesn't),
        exactly the bug SchoolTeacherDetailView.patch() already guards
        against on the school side. Same collision check, same lockstep
        update, here too."""
        from accounts.models import User

        teacher = self.get_teacher()

        new_email = None
        if "email" in request.data:
            candidate = (request.data.get("email") or "").strip().lower()
            if candidate and candidate != teacher.email.lower():
                if User.objects.filter(email__iexact=candidate).exclude(pk=teacher.user_id).exists():
                    return Response({"error": "email_taken"}, status=status.HTTP_400_BAD_REQUEST)
                new_email = candidate

        serializer = TeacherSerializer(teacher, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()

        if new_email:
            update_fields = []
            if teacher.email != new_email:
                teacher.email = new_email
                update_fields.append("email")
            if update_fields:
                teacher.save(update_fields=update_fields)
            if teacher.user_id:
                teacher.user.email = new_email
                teacher.user.save(update_fields=["email"])

        return Response(TeacherSerializer(teacher).data)


class TeacherLessonsView(TeacherRequiredMixin, APIView):
    """The teacher's calendar: her lessons, plus every lesson of the schools
    that made her staff (TeacherSchool.can_view_all_lessons). Filters: ?from=
    ?to= ?date=, and ?scope=mine to fall back to her own lessons only."""

    def get(self, request):
        from catalog.models import Lesson
        from catalog.serializers import LessonBrowseSerializer

        from .access import visible_lessons_q

        teacher = self.get_teacher()
        scope = Q(teacher=teacher) if request.query_params.get("scope") == "mine" else visible_lessons_q(teacher)
        qs = (
            Lesson.objects.filter(scope)
            .select_related("school", "teacher", "lesson_type", "room", "room__location")
            .order_by("date", "start_time")
        )
        p = request.query_params
        lesson_date, date_from, date_to = (
            parse_date(p.get("date"), "date"), parse_date(p.get("from"), "from"), parse_date(p.get("to"), "to")
        )
        if lesson_date:
            qs = qs.filter(date=lesson_date)
        if date_from:
            qs = qs.filter(date__gte=date_from)
        if date_to:
            qs = qs.filter(date__lte=date_to)
        return Response(LessonBrowseSerializer(qs[:1000], many=True).data)


class TeacherStatsView(TeacherRequiredMixin, APIView):
    def get(self, request):
        from django.utils import timezone

        from bookings.models import Attendance
        from bookings.services import _lesson_datetime
        from catalog.models import Lesson

        teacher = self.get_teacher()
        today = timezone.localdate()
        now = timezone.now()
        # "Taught" means the lesson's full start datetime has already passed —
        # the same boundary TeacherAttendanceView uses to gate attendance
        # marking and monthly_compensation()/TeacherCompensationOverviewView
        # use to gate fees, so Performance and Compensation agree on how many
        # lessons have actually happened (QA C4: `date__lt=today` undercounted
        # a lesson that already happened earlier today). Only lessons dated
        # exactly today are ambiguous (need the per-lesson datetime check);
        # anything strictly before/after today is unambiguously past/upcoming
        # without loading it — keeps this cheap for a teacher's whole history.
        past_count = Lesson.objects.filter(teacher=teacher, date__lt=today).count()
        upcoming_count = Lesson.objects.filter(teacher=teacher, date__gt=today).count()
        todays_lessons = list(Lesson.objects.filter(teacher=teacher, date=today))
        todays_taught = sum(1 for lsn in todays_lessons if _lesson_datetime(lsn) <= now)
        past = past_count + todays_taught
        upcoming = upcoming_count + (len(todays_lessons) - todays_taught)
        attendance = Attendance.objects.filter(teacher=teacher)
        # "present" rows drive attendance_rate/no_show (both are counts over
        # marked attendance events, so they must stay row-based to add up
        # against attendance_marked). The "Students Followed" KPI is a
        # different question -- how many distinct students, not how many
        # present marks -- so it needs its own distinct-student count,
        # otherwise a student the teacher sees every week inflates the KPI
        # once per lesson instead of counting once (QA bonus finding).
        present_rows = attendance.filter(status="present").count()
        present_students = attendance.filter(status="present").values("student_id").distinct().count()
        total_marked = attendance.count()
        return Response(
            {
                "lessons_taught": past,
                "lessons_upcoming": upcoming,
                "attendance_marked": total_marked,
                "present": present_students,
                "no_show": total_marked - present_rows,
                "attendance_rate": round(present_rows / total_marked, 3) if total_marked else None,
            }
        )


class CompensationPlanViewSet(SchoolScopedModelViewSet):
    queryset = CompensationPlan.objects.prefetch_related("rates").all()
    serializer_class = CompensationPlanSerializer

    @action(detail=True, methods=["post"])
    def simulate(self, request, pk=None):
        """Preview earnings for a given lesson scenario: {students, lesson_type_id?}."""
        plan = self.get_object()
        students = parse_int(ensure_object_body(request.data).get("students"), "students", default=0)
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
            parse_uuid(request.query_params.get("school"), "school") if is_hq(user) else None
        ) or user.active_school_id
        if not school_id:
            return Response({"error": "school is required"}, status=400)
        teacher = TeacherModel.objects.filter(pk=teacher_id).first()
        if teacher is None or not TeacherSchool.objects.filter(teacher=teacher, school_id=school_id).exists():
            return Response({"error": "not_found"}, status=404)
        month = parse_month(request.query_params.get("month"), "month") or date.today().strftime("%Y-%m")
        return Response(monthly_compensation(teacher, teacher.school_links.get(school_id=school_id).school, month))


class TeacherCompensationView(TeacherRequiredMixin, APIView):
    """GET /api/teacher/compensation/?school=&month= — the teacher's own earnings."""

    def get(self, request):
        teacher = self.get_teacher()
        school_id = parse_uuid(request.query_params.get("school"), "school")
        link = TeacherSchool.objects.filter(teacher=teacher, school_id=school_id).first() if school_id else (
            TeacherSchool.objects.filter(teacher=teacher).first()
        )
        if link is None:
            return Response({"error": "teacher has no school assignment"}, status=400)
        month = parse_month(request.query_params.get("month"), "month") or date.today().strftime("%Y-%m")
        return Response(monthly_compensation(teacher, link.school, month))


class TeacherCompensationOverviewView(TeacherRequiredMixin, APIView):
    """GET /api/teacher/compensation-overview/?month=YYYY-MM — earnings across
    every school this teacher is assigned to, with a per-lesson breakdown
    (bonus flags included), each school's payment status, and a 6-month
    trend. Powers the 'My Compensation' dashboard page."""

    def get(self, request):
        from calendar import monthrange

        from django.utils import timezone

        from bookings.models import Attendance
        from bookings.services import _lesson_datetime
        from catalog.models import Lesson

        from .models import TeacherCompensationPayment
        from .services import compute_lesson_fee

        teacher = self.get_teacher()
        month = parse_month(request.query_params.get("month"), "month") or date.today().strftime("%Y-%m")
        links = list(
            TeacherSchool.objects.filter(teacher=teacher, active=True).select_related("school", "compensation_plan")
        )

        year, mon = (int(x) for x in month.split("-"))
        start = date(year, mon, 1)
        end = date(year, mon, monthrange(year, mon)[1])
        now = timezone.now()

        entries = []
        for link in links:
            school, link_plan = link.school, link.compensation_plan
            lessons = (
                Lesson.objects.filter(teacher=teacher, school=school, date__gte=start, date__lte=end)
                .exclude(status="cancelled")
                .select_related("course", "lesson_type", "compensation_plan")
                .order_by("date", "start_time")
            )
            # A lesson isn't "occurred" until its full start datetime has
            # passed — same definition TeacherAttendanceView already uses to
            # gate attendance marking (QA C2: this view had no future-date
            # exclusion at all, so it paid out for lessons that hadn't
            # happened yet, including later the same day).
            lessons = [lsn for lsn in lessons if _lesson_datetime(lsn) <= now]
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
                # Staff grants (teachers/access.py): the calendar offers the
                # "all lessons" switch only when at least one school grants it
                "can_view_all_lessons": link.can_view_all_lessons,
                "can_manage_bookings": link.can_manage_bookings,
                "compensation_plan": (
                    {
                        "name": plan_label or plan.name, "base_fee": str(plan.base_fee),
                        "bonus_threshold": plan.bonus_threshold, "bonus_per_student": str(plan.bonus_per_student or 0),
                    }
                    if plan else None
                ),
            })
        return Response(data)


def _send_teacher_invite_email(user, school=None):
    """Same shape as accounts.hq_views._send_invite_email — an invited
    teacher sets their password via the generic /api/auth/complete-invite/
    flow, which works for any role with an unusable password."""
    from django.conf import settings
    from django.contrib.auth.tokens import default_token_generator
    from django.db import transaction
    from django.utils.encoding import force_bytes
    from django.utils.http import urlsafe_base64_encode

    from notifications.invites import invite_context, teacher_role_label
    from notifications.tasks import send_transactional_email_task

    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    # Email and setup page in the teacher's language (the locale prefix keeps
    # the i18n middleware from falling back to English on the page).
    locale = user.language_preference if user.language_preference in _LOCALES else "en"
    setup_url = f"{settings.FRONTEND_URL}/{locale}/setup-account?uid={uid}&token={token}"
    # R2-M20a: senza {{invite_org}}/{{invite_role}} l'insegnante riceveva un
    # invito che non nominava ne' la scuola ne' il ruolo. La scuola arriva dal
    # chiamante; in mancanza, dal primo legame attivo dell'insegnante.
    if school is None:
        link = (
            TeacherSchool.objects.filter(teacher__user=user, active=True)
            .select_related("school").order_by("id").first()
        )
        school = link.school if link else None
    org_role = invite_context(
        org_name=getattr(school, "name", "") or "", role_label=teacher_role_label(locale), locale=locale
    )
    transaction.on_commit(
        lambda: send_transactional_email_task.delay(
            to_email=user.email, to_name=user.full_name, key="team_invite",
            context={
                "user_name": user.full_name or user.email, "user_first_name": user.first_name_display,
                "setup_url": setup_url, "platform_name": "No Under 40", **org_role,
            },
            locale=locale,
        )
    )


_LOCALES = ("en", "it", "es", "fr", "de")


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
            {
                "teacher_id": str(link.teacher_id), "active": link.active,
                # Staff grants on this school's link (teachers/access.py)
                "can_view_all_lessons": link.can_view_all_lessons,
                "can_manage_bookings": link.can_manage_bookings,
                "teachers": TeacherSerializer(link.teacher).data,
            }
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

        # A brand-new teacher gets the language the school admin is working
        # in (the form sends it); the saved preference stays the fallback.
        ui_locale = request.data.get("locale")
        locale = ui_locale if ui_locale in _LOCALES else (request.user.language_preference or "en")

        teacher = Teacher.objects.filter(email__iexact=email).first()
        if teacher is None:
            user = User.objects.filter(email__iexact=email).first()
            if user is None:
                user = User(
                    email=email, full_name=name, first_name=first_name, last_name=last_name,
                    role=Role.TEACHER, roles=[Role.TEACHER], language_preference=locale,
                )
                user.set_unusable_password()
                user.save()
            teacher = Teacher.objects.create(
                user=user, name=name, first_name=first_name, last_name=last_name, email=email, phone=phone,
            )

        user = teacher.user
        # An existing account (a student, a school admin…) invited as a
        # teacher: without "teacher" in roles the frontend guard sends her to
        # her own dashboard and the Teacher panel never opens.
        if user is not None and Role.TEACHER not in (user.roles or []):
            user.roles = [*(user.roles or []), Role.TEACHER]
            user.save(update_fields=["roles"])

        link, _ = TeacherSchool.objects.get_or_create(teacher=teacher, school_id=school_id, defaults={"active": True})
        if not link.active:
            link.active = True
            link.save(update_fields=["active"])

        # Someone who already has a password needs no "choose your password"
        # link: she signs in as usual and finds the Teacher panel. The school
        # is told so instead of "invitation sent" / "email not configured".
        existing_account = bool(user is not None and user.has_usable_password())
        email_sent = False
        if user is not None and not existing_account:
            _send_teacher_invite_email(user, school=link.school)
            email_sent = True

        return Response(
            {
                "teacher_id": str(teacher.id), "active": link.active, "email_sent": email_sent,
                "existing_account": existing_account,
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
    """PATCH /api/school/teachers/{teacher_id}/ — edit name/phone/email, and
    the staff grants on this school's link (`can_view_all_lessons`,
    `can_manage_bookings`). The grants never touch the Teacher row: they are
    this school's decision only."""

    permission_classes = [IsAuthenticated]

    def patch(self, request, teacher_id):
        from accounts.models import User

        school_id = request.user.active_school_id
        link = TeacherSchool.objects.filter(teacher_id=teacher_id, school_id=school_id).first()
        if link is None:
            return Response({"error": "not_found"}, status=status.HTTP_404_NOT_FOUND)
        teacher = Teacher.objects.filter(pk=teacher_id).first()
        if teacher is None:
            return Response({"error": "not_found"}, status=status.HTTP_404_NOT_FOUND)

        grant_fields = [f for f in ("can_view_all_lessons", "can_manage_bookings") if f in request.data]
        for field in grant_fields:
            setattr(link, field, bool(request.data.get(field)))
        if grant_fields:
            link.save(update_fields=grant_fields)

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
            if User.objects.filter(email__iexact=new_email).exclude(pk=teacher.user_id).exists():
                return Response({"error": "email_taken"}, status=status.HTTP_400_BAD_REQUEST)
            teacher.email = new_email
            if teacher.user_id:
                teacher.user.email = new_email
                teacher.user.save(update_fields=["email"])
        teacher.save()
        return Response({
            **TeacherSerializer(teacher).data,
            "can_view_all_lessons": link.can_view_all_lessons,
            "can_manage_bookings": link.can_manage_bookings,
        })


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
        _send_teacher_invite_email(link.teacher.user, school=link.school)
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
        month = parse_month(request.query_params.get("month"), "month") or date.today().strftime("%Y-%m")

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

        body = ensure_object_body(request.data)
        teacher_id = parse_uuid(body.get("teacher_id"), "teacher_id")
        month = parse_month(body.get("month"), "month")
        if not (teacher_id and month):
            return Response({"error": "teacher_id and month are required"}, status=400)

        # SCH-R2-09 / X-R2-06: without this check any teacher_id from the
        # request body was accepted as-is, so a school could record (and the
        # response would echo the name of) a compensation payment for a
        # teacher who has no relationship to the caller's school at all.
        if not TeacherSchool.objects.filter(school_id=school_id, teacher_id=teacher_id).exists():
            return Response({"error": "teacher_not_at_school"}, status=404)

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
