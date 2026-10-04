"""Transaction listing + summary reports (CLAUDE.md 6.7 HQ payments, 7.10 school
payments, 7.17 lesson/student analytics)."""

from datetime import date, datetime, timedelta
from datetime import time as dtime
from zoneinfo import ZoneInfo

from django.db.models import Count, Prefetch, Q, Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsHQ
from catalog.services import course_cost_index, student_package_lessons, translated_names
from core.viewsets import is_hq

from .models import ShopSale, Transaction
from core.params import parse_date, parse_int, parse_uuid, parse_uuid_list

from .serializers import TransactionSerializer


def _filtered_transactions(qs, params):
    # I18N-R4-14 (Carlo's rule: filters are multi-select): every filter here
    # takes a comma-separated list, the single value being the one-item case.
    if params.get("status"):
        qs = qs.filter(status__in=[v for v in params["status"].split(",") if v])
    if params.get("type"):
        qs = qs.filter(type__in=[v for v in params["type"].split(",") if v])
    if params.get("method"):
        qs = qs.filter(payment_method=params["method"])
    date_from = parse_date(params.get("date_from"), "date_from")
    date_to = parse_date(params.get("date_to"), "date_to")
    if date_from:
        qs = qs.filter(created_at__date__gte=date_from)
    if date_to:
        qs = qs.filter(created_at__date__lte=date_to)
    return qs


def _serialize_transactions(transactions) -> list:
    """Rows plus the live names of their packages, fetched in one query."""
    from catalog.models import Package

    rows = list(transactions)
    ids = {t.product_id for t in rows if t.product_id and t.type in ("package", "subscription")}
    packages = {p.id: p for p in Package.objects.filter(id__in=ids)} if ids else {}
    return TransactionSerializer(rows, many=True, context={"packages": packages}).data


class HQTransactionsView(APIView):
    """GET /api/hq/transactions/ — consolidated view across all schools."""

    permission_classes = [IsAuthenticated, IsHQ]

    def get(self, request):
        qs = Transaction.objects.select_related("school", "student").all()
        school_ids = parse_uuid_list(request.query_params.get("school"), "school")
        if school_ids:
            qs = qs.filter(school_id__in=school_ids)
        qs = _filtered_transactions(qs, request.query_params).order_by("-created_at")
        return Response(_serialize_transactions(qs[:1000]))


class SchoolTransactionsView(APIView):
    """GET /api/school/transactions/ — this school's transactions."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        # HQ may inspect any school via ?school=; without it, fall back to the
        # caller's own active school (multi-role users browsing the School panel).
        school_id = (
            parse_uuid(request.query_params.get("school"), "school") if is_hq(user) else None
        ) or user.active_school_id
        if not school_id:
            return Response({"error": "school is required"}, status=400)
        # The period is the school's own days: `created_at__date` truncates in
        # the CURRENT timezone (UTC for this project), so a payment at 00:30
        # on the 1st in Rome fell into the previous month. Filter and read
        # under the school's zone (the lookup renders its tzname at SQL time).
        from django.utils import timezone

        from schools.models import School

        tz = School.objects.filter(pk=school_id).first()
        with timezone.override(tz.tzinfo() if tz else timezone.get_current_timezone()):
            qs = Transaction.objects.filter(school_id=school_id).select_related("student")
            qs = _filtered_transactions(qs, request.query_params).order_by("-created_at")
            return Response(_serialize_transactions(qs[:1000]))


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
        from students.models import active_subscriptions

        user = request.user
        # HQ may inspect any school via ?school=; without it, fall back to the
        # caller's own active school (multi-role users browsing the School panel).
        school_id = (
            parse_uuid(request.query_params.get("school"), "school") if is_hq(user) else None
        ) or user.active_school_id
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
                "active_subscriptions_count": active_subscriptions(school_id=school_id).count(),
                "lessons_completed": lessons.filter(status="completed").count(),
                "lessons_scheduled": lessons.filter(status="scheduled").count(),
                "bookings_total": bookings.count(),
                "bookings_cancelled": bookings.filter(status="cancelled").count(),
                "no_shows": attendance.filter(status="no_show").count(),
                # QA R2-M8/SCH-R2-12: only credits actually CONSUMED count.
                # A booking whose credit came back (`cancelled` +
                # `credit_refunded`) was never used; a burned one — late
                # cancellation outside the school policy, or a no-show — was.
                # Same rule as the detailed report and the weekly cap
                # (bookings.services._weekly_cap_reached).
                "credits_used": (bookings.exclude(
                    status="cancelled", credit_refunded=True
                ).aggregate(s=Sum("credits_deducted"))["s"] or 0) + _hand_deductions_net(school_id=school_id),
            }
        )


def _hand_deductions_net(**scope):
    """Credits the school took off packages by hand, net of what it undid
    (students/credit_movements.py): consumed like a burned booking, so
    "credits used" and the wallets still reconcile."""
    from students.models import ManualCreditGrant

    totals = {
        r["kind"]: r["s"] or 0
        for r in ManualCreditGrant.objects.filter(**scope)
        .exclude(kind=ManualCreditGrant.Kind.GRANT)
        .values("kind")
        .annotate(s=Sum("amount"))
    }
    return (totals.get(ManualCreditGrant.Kind.DEDUCTION) or 0) - (totals.get(ManualCreditGrant.Kind.REVERSAL) or 0)


class SchoolReportsDetailedView(APIView):
    """GET /api/school/reports/detailed/ — the Reports page's lessons/
    students/teachers tabs (spec 7.17). A separate endpoint from
    /school/reports/ (dashboard KPI summary, a different shape already
    relied on) since both would otherwise collide on the same old-API path.

    ?from= / ?to= (YYYY-MM-DD) bound the Teachers section -- its lessons,
    students, attendance rate and compensation estimate are the period's
    (Carlo, 2026-09-28); default: this month to date. The other sections
    ignore them."""

    permission_classes = [IsAuthenticated]

    SECTIONS = ("lessons", "students", "teachers")
    MAX_LESSON_ROWS = 500  # newest first; the Lessons tab shows this many

    def get(self, request):
        user = request.user
        # HQ may inspect any school via ?school=; without it, fall back to the
        # caller's own active school (multi-role users browsing the School panel).
        school_id = (
            parse_uuid(request.query_params.get("school"), "school") if is_hq(user) else None
        ) or user.active_school_id
        if not school_id:
            return Response({"error": "school is required"}, status=400)

        # ?tab=lessons|students|teachers computes only that section (the page
        # asks for the tab it is showing); without it, all three as before.
        tab = request.query_params.get("tab")
        if tab and tab not in self.SECTIONS:
            return Response({"error": "Invalid tab"}, status=400)
        wanted = (tab,) if tab else self.SECTIONS

        today = date.today()
        date_from = parse_date(request.query_params.get("from"), "from") or today.replace(day=1)
        date_to = parse_date(request.query_params.get("to"), "to") or today
        if date_from > date_to:
            return Response({"error": "from must not be after to"}, status=400)

        body = {}
        for name in wanted:
            body[name] = (
                self._teachers(school_id, date_from, date_to) if name == "teachers"
                else getattr(self, f"_{name}")(school_id)
            )
        return Response(body)

    def _lessons(self, school_id):
        from bookings.models import Attendance, Booking
        from catalog.models import Lesson
        from teachers.models import TeacherSchool

        # ── Lessons ──
        # Consuntivo: solo lezioni fino a oggi. Senza questo filtro il taglio
        # a 500 righe (ordinate per data discendente) prendeva le lezioni più
        # LONTANE nel futuro ed escludeva quelle appena svolte.
        related = ("course", "lesson_type", "teacher", "room", "room__location", "compensation_plan")
        lessons_qs = (
            Lesson.objects.filter(school_id=school_id, date__lte=date.today())
            .select_related(*related)
            .order_by("-date", "-start_time")[:self.MAX_LESSON_ROWS]
        )
        plan_by_teacher = {
            str(link.teacher_id): link.compensation_plan
            for link in TeacherSchool.objects.filter(school_id=school_id).select_related("compensation_plan")
        }
        from teachers.models import CompensationPlanRate
        from teachers.services import compute_lesson_fee

        lessons_list = list(lessons_qs)
        # The cut may fall inside a set of concurrent lessons (same date and
        # time): take the rest of that set too, so the merge below sees it whole
        if len(lessons_list) == self.MAX_LESSON_ROWS:
            tail = lessons_list[-1]
            lessons_list += list(
                Lesson.objects.filter(school_id=school_id, date=tail.date, start_time=tail.start_time)
                .exclude(id__in=[lesson.id for lesson in lessons_list])
                .select_related(*related)
            )
        # The per-type rates of every plan the rows may use, in one query
        # (before: one query per row, up to 500)
        plan_ids = {plan.id for plan in plan_by_teacher.values() if plan} | {
            lesson.compensation_plan_id for lesson in lessons_list if lesson.compensation_plan_id
        }
        rate_index = {
            (rate.plan_id, rate.lesson_type_id): rate
            for rate in CompensationPlanRate.objects.filter(plan_id__in=plan_ids)
        }

        # ── Incasso per lezione (regola A, decisa con Carlo) ──
        # Valore credito = prezzo realmente pagato ÷ crediti totali del
        # pacchetto d'origine. Conta il credito CONSUMATO (presente, no-show,
        # cancellata fuori policy); il rimborsato no; gratis/regali = 0.
        lesson_ids = [lesson.id for lesson in lessons_list]
        consumed_bookings = list(
            Booking.objects.filter(lesson_id__in=lesson_ids, credits_deducted__gt=0)
            .exclude(status="cancelled", credit_refunded=True)
            .select_related("student_package__package")
        )
        # Importi pagati in un'unica query (Transaction è già importato in testa)
        stripe_ids = {
            b.student_package.stripe_payment_id
            for b in consumed_bookings
            if b.student_package_id and b.student_package.stripe_payment_id
        }
        paid_by_stripe_id = {
            tx.stripe_payment_id: float(tx.amount)
            for tx in Transaction.objects.filter(stripe_payment_id__in=stripe_ids)
        }

        unit_value_cache: dict = {}

        def package_unit_value(sp):
            """€ per credito del pacchetto acquistato; None = non determinabile
            (illimitato: crediti totali 0 con prezzo > 0 → warning)."""
            if sp.id in unit_value_cache:
                return unit_value_cache[sp.id]
            paid = paid_by_stripe_id.get(sp.stripe_payment_id) if sp.stripe_payment_id else None
            if paid is None and sp.package_id:
                paid = float(sp.package.price or 0)
            if paid is None:
                paid = 0.0
            credits_total = float(sp.credits_total or 0)
            value = (paid / credits_total) if credits_total > 0 else (None if paid > 0 else 0.0)
            unit_value_cache[sp.id] = value
            return value

        # Conteggi presenze/assenze/cancellazioni in 2 query aggregate
        # (prima erano 3 query per ognuna delle 500 righe)
        att_counts: dict = {}
        for row in (
            Attendance.objects.filter(lesson_id__in=lesson_ids)
            .values("lesson_id", "status").annotate(n=Count("id"))
        ):
            att_counts.setdefault(row["lesson_id"], {})[row["status"]] = row["n"]
        cancelled_counts = {
            row["lesson_id"]: row["n"]
            for row in Booking.objects.filter(lesson_id__in=lesson_ids, status="cancelled")
            .values("lesson_id").annotate(n=Count("id"))
        }

        revenue_by_lesson: dict = {}
        warning_by_lesson: dict = {}
        for b in consumed_bookings:
            key = b.lesson_id
            sp = b.student_package
            if sp is None:
                continue  # lezione gratuita / senza pacchetto: incasso 0
            unit = package_unit_value(sp)
            if unit is None:
                warning_by_lesson[key] = True  # pacchetto illimitato
                continue
            revenue_by_lesson[key] = revenue_by_lesson.get(key, 0.0) + float(b.credits_deducted) * unit

        lesson_rows = []
        plan_by_lesson: dict = {}  # for the concurrent groups below
        today_d = date.today()
        for lesson in lessons_list:
            name = (lesson.course.name.strip() if lesson.course_id and lesson.course.name else "") or (
                lesson.lesson_type.name_en if lesson.lesson_type_id else "—"
            )
            # Piano dell'orario (scheda classe) → fallback piano insegnante-scuola
            plan = lesson.compensation_plan or plan_by_teacher.get(str(lesson.teacher_id))
            plan_by_lesson[lesson.id] = plan
            attended = att_counts.get(lesson.id, {}).get("present", 0)
            is_cancelled = lesson.status == "cancelled"
            # Lezione annullata: niente compenso, niente sala, niente ricavo
            compensation_fee = (
                compute_lesson_fee(
                    plan, lesson_type_id=lesson.lesson_type_id, students_count=attended,
                    rate=rate_index.get((plan.id, lesson.lesson_type_id)),
                )
                if plan and not is_cancelled else None
            )
            revenue = round(revenue_by_lesson.get(lesson.id, 0.0), 2)
            room_cost = float(lesson.room.cost or 0) if lesson.room_id else 0.0
            profit = (
                None if is_cancelled
                else round(revenue - room_cost - float(compensation_fee or 0), 2)
            )
            # "scheduled" vale solo per le future: una lezione passata non
            # annullata è di fatto svolta (per Carlo)
            display_status = (
                "cancelled" if lesson.status == "cancelled"
                else "completed" if lesson.date < today_d
                else lesson.status
            )
            lesson_rows.append({
                "id": str(lesson.id), "name": name, "date": lesson.date,
                "start_time": lesson.start_time, "end_time": lesson.end_time,
                "is_online": lesson.is_online,
                # The Lesson type filter of the tab (the name resolved in the
                # viewer's language on the client, like the Bookings tab)
                "lesson_type_id": str(lesson.lesson_type_id) if lesson.lesson_type_id else None,
                "lesson_type": translated_names(lesson.lesson_type) if lesson.lesson_type_id else None,
                "teacher": lesson.teacher.name if lesson.teacher_id else "—",
                "teacher_id": str(lesson.teacher_id) if lesson.teacher_id else None,
                "room": lesson.room.name if lesson.room_id else "—",
                "room_id": str(lesson.room_id) if lesson.room_id else None,
                "room_cost": lesson.room.cost if lesson.room_id else None,
                "location": lesson.room.location.name if lesson.room_id and lesson.room.location_id else "—",
                "location_id": str(lesson.room.location_id) if lesson.room_id and lesson.room.location_id else None,
                "compensation_plan": plan.name if plan else "—",
                "compensation_plan_id": str(plan.id) if plan else None,
                "compensation_fee": compensation_fee,
                "revenue": revenue,
                "profit": profit,
                "revenue_warning": bool(warning_by_lesson.get(lesson.id)),
                "capacity": lesson.max_capacity,
                "booked": lesson.current_bookings,
                "attended": attended,
                "no_shows": att_counts.get(lesson.id, {}).get("no_show", 0),
                "cancelled": cancelled_counts.get(lesson.id, 0),
                "status": display_status,
                "concurrent_key": None,  # set below when the lesson has a twin
            })
        concurrent = self._concurrent_groups(lessons_list, lesson_rows, plan_by_lesson, rate_index, today_d)
        return {"rows": lesson_rows, "concurrent": concurrent}

    @staticmethod
    def _concurrent_groups(lessons, rows, plan_by_lesson, rate_index, today_d) -> dict:
        """The Lessons tab's "merge concurrent lessons" switch (Carlo,
        2026-09-28). A class held in the room and streamed on Zoom at the same
        time is two Lesson rows -- same day, same start time, same teacher --
        but one hour of work. Every such set becomes one row, shaped like a
        lesson row plus `lesson_ids`, keyed by the `concurrent_key` written on
        its members: the room is paid once (each distinct room of the lessons
        actually held), the fee is the in-room lesson's plan computed ONCE on
        the students of every member (4 in the room + 2 on Zoom = the plan at
        6), and the counts and the revenue add up. The page merges only while
        the switch is on. Display only: teachers/services.monthly_compensation,
        the real payout, is untouched."""
        from teachers.services import compute_lesson_fee

        by_id = {row["id"]: row for row in rows}
        groups: dict = {}
        for lesson in lessons:
            if not lesson.teacher_id:
                continue
            key = f"{lesson.date.isoformat()}|{lesson.start_time.isoformat()}|{lesson.teacher_id}"
            groups.setdefault(key, []).append(lesson)

        out: dict = {}
        for key, members in groups.items():
            if len(members) < 2:
                continue
            # The lesson that ran leads: its plan, its room, its name first.
            # A held lesson beats a cancelled one (a class called off in the
            # room and kept on Zoom is the Zoom lesson's), then the in-room
            # one beats the online one, then the one with a room; the id
            # keeps the answer stable.
            members.sort(key=lambda lesson: (
                lesson.status == "cancelled", lesson.is_online, lesson.room_id is None, str(lesson.id),
            ))
            lead = members[0]
            member_rows = [by_id[str(lesson.id)] for lesson in members]
            for row in member_rows:
                row["concurrent_key"] = key
            held = [lesson for lesson in members if lesson.status != "cancelled"]
            attended = sum(row["attended"] for row in member_rows)
            plan = plan_by_lesson.get(lead.id)
            fee = (
                compute_lesson_fee(
                    plan, lesson_type_id=lead.lesson_type_id, students_count=attended,
                    rate=rate_index.get((plan.id, lead.lesson_type_id)),
                )
                if plan and held else None
            )
            # A cancelled twin's room stays out of the cost, as its own row
            # keeps it out of the profit; all cancelled: the rooms, for the record
            rooms = {lesson.room_id: lesson.room for lesson in (held or members) if lesson.room_id}
            room_cost = round(sum(float(room.cost or 0) for room in rooms.values()), 2)
            revenue = round(sum(float(row["revenue"]) for row in member_rows), 2)
            names: list = []
            for row in member_rows:
                if row["name"] not in names:
                    names.append(row["name"])
            out[key] = {
                **by_id[str(lead.id)],
                "id": key,
                "lesson_ids": [row["id"] for row in member_rows],
                "name": " + ".join(names),
                "room_cost": room_cost if rooms else None,
                "compensation_fee": fee,
                "revenue": revenue,
                "profit": None if not held else round(revenue - room_cost - float(fee or 0), 2),
                "revenue_warning": any(row["revenue_warning"] for row in member_rows),
                "capacity": sum(row["capacity"] for row in member_rows),
                "booked": sum(row["booked"] for row in member_rows),
                "attended": attended,
                "no_shows": sum(row["no_shows"] for row in member_rows),
                "cancelled": sum(row["cancelled"] for row in member_rows),
                "status": "cancelled" if not held else "completed" if lead.date < today_d else lead.status,
                "concurrent_key": key,
            }
        return out

    def _students(self, school_id):
        """One row per student of the school, in lessons rather than credits
        (Carlo, 2026-09-28): every package of hers at this school told in
        lessons the way the Packages tab does (catalog.services
        .student_package_lessons). Total and used add up over every package
        but deleted ones -- a used-up trial is exactly the "came once" case
        the tab is for -- while remaining is the wallet, active packages
        only. A package that cannot be told in lessons (unlimited, mixed
        costs, manual credits) is left out and the row says so
        (`lessons_partial`). Email and phone are there to call her back."""
        from bookings.models import Booking
        from schools.models import SchoolStudent
        from students.models import StudentPackage

        # One query per figure for the WHOLE school (this loop used to run
        # ~7 queries per student, so the page slowed down with the size of
        # the school).
        from django.db.models import Max
        from students.models import StudentDocument

        links = list(SchoolStudent.objects.filter(school_id=school_id).select_related("student"))
        student_ids = [link.student_id for link in links]
        course_costs = course_cost_index([school_id])
        lessons_by: dict = {}
        for sp in (
            StudentPackage.objects.filter(school_id=school_id, student_id__in=student_ids)
            .exclude(status="deleted").select_related("package")
        ):
            agg = lessons_by.setdefault(
                sp.student_id, {"total": 0, "used": 0, "remaining": 0, "partial": False, "active": False}
            )
            if sp.status == "active":
                agg["active"] = True
            _cost, total, remaining = student_package_lessons(sp, course_costs)
            if total is None:
                agg["partial"] = True
                continue
            agg["total"] += total
            agg["used"] += max(total - remaining, 0)
            if sp.status == "active":
                agg["remaining"] += remaining
        attended_by = {
            r["student_id"]: (r["last"], r["n"])
            for r in Booking.objects.filter(school_id=school_id, status="attended", student_id__in=student_ids)
            .values("student_id").annotate(last=Max("lesson__date"), n=Count("id"))
        }
        docs_expired = StudentDocument.objects.filter(
            school_id=school_id, status="expired", student_id__in=student_ids
        ).count()

        student_rows = []
        remaining_total = 0
        remaining_count = 0
        for link in links:
            student = link.student
            agg = lessons_by.get(student.id, {"total": 0, "used": 0, "remaining": 0, "partial": False, "active": False})
            last_att, total_attended = attended_by.get(student.id, (None, 0))
            student_rows.append({
                "id": str(student.id), "name": student.name,
                "email": student.email or "", "phone": student.phone or "",
                "lessons_total": agg["total"],
                "lessons_used": agg["used"],
                "lessons_remaining": agg["remaining"],
                "lessons_partial": agg["partial"],
                "last_attendance": last_att.isoformat() if last_att else "—",
                "total_attended": total_attended,
                "has_active_package": agg["active"],
            })
            if agg["active"]:
                remaining_total += agg["remaining"]
                remaining_count += 1
        return {
            "total": len(student_rows),
            # mean lessons left of the students with an active package
            "avg_lessons_remaining": f"{round(remaining_total / remaining_count, 1)}" if remaining_count else "0",
            "docs_expired": docs_expired,
            "rows": student_rows,
        }

    def _teachers(self, school_id, date_from, date_to):
        """One row per active teacher, every number within `date_from`..
        `date_to`: lessons held (not cancelled), distinct students who booked
        them, attendance rate over the attendance marked on them, and the
        compensation estimate (teachers.services.period_compensation, the
        same rule as the Compensation page). Nothing after today counts: a
        `date_to` in the future is clamped, the tab is a consuntivo."""
        from bookings.models import Attendance, Booking
        from catalog.models import Lesson
        from teachers.models import TeacherSchool
        from teachers.services import period_compensation

        teacher_rows = []
        to_eff = min(date_to, date.today())
        teacher_links = list(TeacherSchool.objects.filter(school_id=school_id, active=True).select_related("teacher", "school"))
        teacher_ids = [link.teacher_id for link in teacher_links]
        lessons_by = {
            r["teacher_id"]: r["n"]
            for r in Lesson.objects.filter(
                teacher_id__in=teacher_ids, school_id=school_id, date__gte=date_from, date__lte=to_eff
            ).exclude(status="cancelled").values("teacher_id").annotate(n=Count("id"))
        }
        students_by = {
            r["lesson__teacher_id"]: r["n"]
            for r in Booking.objects.filter(
                lesson__teacher_id__in=teacher_ids, school_id=school_id,
                lesson__date__gte=date_from, lesson__date__lte=to_eff,
            ).values("lesson__teacher_id").annotate(n=Count("student_id", distinct=True))
        }
        att_by = {
            r["teacher_id"]: (r["present"], r["total"])
            for r in Attendance.objects.filter(
                teacher_id__in=teacher_ids, lesson__school_id=school_id,
                lesson__date__gte=date_from, lesson__date__lte=to_eff,
            ).values("teacher_id").annotate(total=Count("id"), present=Count("id", filter=Q(status="present")))
        }
        for link in teacher_links:
            teacher = link.teacher
            present_count, att_total = att_by.get(teacher.id, (0, 0))
            attendance_rate = f"{round(present_count / att_total * 100, 1)}" if att_total else "—"
            comp = period_compensation(teacher, link.school, date_from, to_eff)
            teacher_rows.append({
                "id": str(teacher.id), "name": teacher.name,
                "lessons": lessons_by.get(teacher.id, 0),
                "total_students": students_by.get(teacher.id, 0),
                "attendance_rate": attendance_rate, "compensation_estimate": comp["total"],
            })
        return {"rows": teacher_rows, "from": date_from, "to": date_to}


def _cost_str(cost):
    return str(cost) if cost is not None else None


def _actor(user, student) -> dict | None:
    """Who did it, for Reports: the student herself, or a staff member by
    name. None when the row predates the column."""
    if user is None:
        return None
    if student.user_id and user.id == student.user_id:
        return {"name": student.name, "is_student": True}
    return {"name": user.full_name or user.email, "is_student": False}


class SchoolReportsPackagesView(APIView):
    """GET /api/school/reports/packages/ — every package + subscription
    purchase at this school, one flat row per row (spec 7.17)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from students.models import ManualCreditGrant, StudentPackage, StudentSubscription

        user = request.user
        # HQ may inspect any school via ?school=; without it, fall back to the
        # caller's own active school (multi-role users browsing the School panel).
        school_id = (
            parse_uuid(request.query_params.get("school"), "school") if is_hq(user) else None
        ) or user.active_school_id
        if not school_id:
            return Response({"error": "school is required"}, status=400)

        # Credits as lessons too, when the package can be told in lessons
        # (catalog.services.student_package_lessons — the student's Packages
        # page converts the same way); otherwise the three stay None.
        course_costs = course_cost_index([school_id])
        rows = []
        for p in (
            StudentPackage.objects.filter(school_id=school_id)
            .select_related("student", "package")
            .prefetch_related(
                Prefetch("grants", queryset=ManualCreditGrant.objects.filter(kind=ManualCreditGrant.Kind.GRANT).select_related("granted_by"))
            )
        ):
            cost, lessons_total, lessons_remaining = student_package_lessons(p, course_costs)
            # Who put it in the wallet: the staff member of the manual grant when
            # there is one (authoritative), else the student when it was paid on
            # Stripe; None otherwise. "stripe" is also the column default, so a
            # grant row wins over it, never the other way round.
            grant = next(iter(p.grants.all()), None)
            if grant is not None:
                assigned_by = _actor(grant.granted_by, p.student)
            elif p.payment_method == "stripe":
                assigned_by = {"name": p.student.name, "is_student": True}
            else:
                assigned_by = None
            rows.append({
                "id": str(p.id), "kind": "package", "student_id": str(p.student_id), "student_name": p.student.name,
                "product": translated_names(p.package), "total": p.credits_total, "remaining": p.credits_remaining,
                "started_at": p.purchased_at, "ends_at": p.expires_at, "status": p.status,
                "payment_method": p.payment_method,
                "lesson_credit_cost": _cost_str(cost),
                "assigned_by": assigned_by,
                "lessons_total": lessons_total,
                "lessons_remaining": lessons_remaining,
            })
        for s in StudentSubscription.objects.filter(school_id=school_id).select_related("student", "subscription_catalog"):
            rows.append({
                "id": str(s.id), "kind": "subscription", "student_id": str(s.student_id), "student_name": s.student.name,
                "product": translated_names(s.subscription_catalog), "total": s.access_total, "remaining": s.access_remaining,
                "started_at": s.started_at, "ends_at": s.current_period_end, "status": s.status,
                "payment_method": None,
                "lesson_credit_cost": None, "lessons_total": None, "lessons_remaining": None,
                "assigned_by": None,
            })
        rows.sort(key=lambda r: r["started_at"], reverse=True)
        return Response({"rows": rows})


# A lesson whose course has no name of its own (none, or blanks only: the
# rows strip it) is told by its lesson type — the Reports page's
# `bkLessonName`; the Lesson filter and `_lesson_key` follow that rule.
_NAMELESS_COURSE = Q(lesson__course__isnull=True) | Q(lesson__course__name__regex=r"^\s*$")


def _lesson_key(lesson) -> str | None:
    """The Lesson column's filter value for a row, "course:<id>" / "type:<id>":
    the Python twin of `_NAMELESS_COURSE`, so filter and column agree."""
    if lesson.course_id and (lesson.course.name or "").strip():
        return f"course:{lesson.course_id}"
    return f"type:{lesson.lesson_type_id}" if lesson.lesson_type_id else None


class SchoolReportsBookingsView(APIView):
    """GET /api/school/reports/bookings/ — the Reports page's Bookings tab:
    the bookings made at this school, newest first, one row each with the
    student and the lesson it is for. HQ may pass ?school=.

    Filtered, sorted and paged on the server (the page used to download every
    booking and filter in the browser, which slowed down with the school):
      period=24h|7d|30d|all   relative window on booked_at (default: all)
      booked_from / booked_to YYYY-MM-DD, school timezone; override `period`
      lesson_from / lesson_to YYYY-MM-DD, the lesson's own day; adds up with
                              the booking window ("booked in September for
                              October's lessons")
      student / teacher / location   comma-separated UUIDs
      lesson                         comma-separated "course:<uuid>" /
                                     "type:<uuid>" — what the Lesson column
                                     shows: the course's own name, else the
                                     lesson type of a nameless/absent course
      status / source                comma-separated (source: package,
                                     drop_in, subscription, free_lesson, event)
      sort=booked_at|lesson_date|student   dir=asc|desc
      page (1-based) / page_size (default 25, max 100)
      export=1   every matching row, no paging (capped at MAX_ROWS)
      options=1  the students/teachers/locations/lessons that have bookings,
                 for the filter dropdowns (nothing else is computed)
    The answer carries `count` (all matches) and `kpis` over ALL matches, not
    just the page."""

    permission_classes = [IsAuthenticated]

    MAX_ROWS = 5000
    DEFAULT_PAGE_SIZE = 25
    MAX_PAGE_SIZE = 100
    PERIODS = {"24h": timedelta(hours=24), "7d": timedelta(days=7), "30d": timedelta(days=30)}
    SORTS = {
        "booked_at": ("booked_at",),
        "lesson_date": ("lesson__date", "lesson__start_time"),
        "student": ("student__name",),
    }

    def _filtered(self, request, school_id):
        """Bookings of the school narrowed by the query params."""
        from bookings.models import Booking
        from schools.models import School

        params = request.query_params
        qs = Booking.objects.filter(school_id=school_id)

        booked_from = parse_date(params.get("booked_from"), "booked_from")
        booked_to = parse_date(params.get("booked_to"), "booked_to")
        if booked_from or booked_to:
            tz = ZoneInfo(School.objects.filter(pk=school_id).values_list("timezone", flat=True).first() or "UTC")
            if booked_from:
                qs = qs.filter(booked_at__gte=datetime.combine(booked_from, dtime.min, tzinfo=tz))
            if booked_to:
                qs = qs.filter(booked_at__lt=datetime.combine(booked_to + timedelta(days=1), dtime.min, tzinfo=tz))
        else:
            period = params.get("period") or "all"
            if period != "all" and period not in self.PERIODS:
                raise ValidationError({"period": [f"'{period}' is not a valid period."]})
            if period in self.PERIODS:
                qs = qs.filter(booked_at__gte=timezone.now() - self.PERIODS[period])

        # The lesson's day, on top of the booking window (a plain date: the
        # lesson's date is stored as the school's local day already)
        lesson_from = parse_date(params.get("lesson_from"), "lesson_from")
        lesson_to = parse_date(params.get("lesson_to"), "lesson_to")
        if lesson_from:
            qs = qs.filter(lesson__date__gte=lesson_from)
        if lesson_to:
            qs = qs.filter(lesson__date__lte=lesson_to)

        if students := parse_uuid_list(params.get("student"), "student"):
            qs = qs.filter(student_id__in=students)
        if teachers := parse_uuid_list(params.get("teacher"), "teacher"):
            qs = qs.filter(lesson__teacher_id__in=teachers)
        if locations := parse_uuid_list(params.get("location"), "location"):
            qs = qs.filter(lesson__room__location_id__in=locations)
        if tokens := [v.strip() for v in (params.get("lesson") or "").split(",") if v.strip()]:
            courses, types = [], []
            for token in tokens:
                kind, _, raw = token.partition(":")
                uid = parse_uuid(raw, "lesson") if kind in ("course", "type") and raw else None
                if uid is None:
                    raise ValidationError({"lesson": [f"'{token}' is not a valid lesson filter."]})
                (courses if kind == "course" else types).append(uid)
            cond = Q()
            if courses:
                cond |= Q(lesson__course_id__in=courses)
            if types:
                cond |= Q(lesson__lesson_type_id__in=types) & _NAMELESS_COURSE
            qs = qs.filter(cond)
        if statuses := [v for v in (params.get("status") or "").split(",") if v.strip()]:
            qs = qs.filter(status__in=statuses)
        if sources := [v for v in (params.get("source") or "").split(",") if v.strip()]:
            # The page's own rules: a drop-in package is a "drop_in" source
            # whatever the booking's access_source says, and a paid special
            # event seat — booked as "package" with the event's own ticket
            # (bookings/services.is_event_ticket) — is an "event" one
            drop_in = Q(student_package__package__is_drop_in=True)
            ticket = Q(student_package__package__event__isnull=False)
            cond = Q()
            for key in sources:
                if key == "drop_in":
                    cond |= drop_in
                elif key == "event":
                    cond |= Q(access_source="event") | ticket
                else:
                    cond |= Q(access_source=key) & ~drop_in & ~ticket
            qs = qs.filter(cond)
        return qs

    def _options(self, school_id):
        from bookings.models import Booking

        base = Booking.objects.filter(school_id=school_id)

        def pairs(id_field, name_field):
            rows = base.exclude(**{f"{id_field}__isnull": True}).values_list(id_field, name_field).distinct()
            return sorted(
                ({"value": str(i), "label": n or ""} for i, n in rows), key=lambda o: o["label"].lower()
            )

        # The Lesson column's values: courses by their own name, and the lesson
        # type of the lessons whose course has none (`names` lets the page
        # pick the viewer's language, as the column does)
        course_rows = (
            base.exclude(_NAMELESS_COURSE)
            .values_list("lesson__course_id", "lesson__course__name").distinct()
        )
        type_rows = (
            base.filter(_NAMELESS_COURSE).exclude(lesson__lesson_type__isnull=True)
            .values_list(
                "lesson__lesson_type_id", "lesson__lesson_type__name_en", "lesson__lesson_type__name_it",
                "lesson__lesson_type__name_fr", "lesson__lesson_type__name_es",
            ).distinct()
        )
        lessons = [{"value": f"course:{i}", "label": (n or "").strip()} for i, n in course_rows] + [
            {
                "value": f"type:{i}", "label": en or it or fr or es or "",
                "names": {"name_en": en, "name_it": it, "name_fr": fr, "name_es": es},
            }
            for i, en, it, fr, es in type_rows
        ]
        return {
            "students": pairs("student_id", "student__name"),
            "teachers": pairs("lesson__teacher_id", "lesson__teacher__name"),
            "locations": pairs("lesson__room__location_id", "lesson__room__location__name"),
            "lessons": sorted(lessons, key=lambda o: o["label"].lower()),
        }

    def get(self, request):
        user = request.user
        school_id = (
            parse_uuid(request.query_params.get("school"), "school") if is_hq(user) else None
        ) or user.active_school_id
        if not school_id:
            return Response({"error": "school is required"}, status=400)

        params = request.query_params
        if params.get("options"):
            return Response(self._options(school_id))

        base = self._filtered(request, school_id)
        agg = base.aggregate(
            count=Count("id"),
            confirmed=Count("id", filter=Q(status="confirmed")),
            attended=Count("id", filter=Q(status="attended")),
            no_show=Count("id", filter=Q(status="no_show")),
            cancelled=Count("id", filter=Q(status="cancelled")),
            credits=Sum("credits_deducted", filter=~Q(status="cancelled", credit_refunded=True)),
        )
        count = agg.pop("count")
        agg["credits"] = agg["credits"] or 0

        sort = params.get("sort") or "booked_at"
        if sort not in self.SORTS:
            raise ValidationError({"sort": [f"'{sort}' is not a valid sort."]})
        descending = (params.get("dir") or "desc") != "asc"
        ordering = [("-" if descending else "") + f for f in self.SORTS[sort]] + ["-booked_at", "id"]

        if params.get("export"):
            page, page_size, window = 1, self.MAX_ROWS, slice(0, self.MAX_ROWS)
        else:
            page_size = parse_int(params.get("page_size"), "page_size", default=self.DEFAULT_PAGE_SIZE, min_value=1)
            page_size = min(page_size, self.MAX_PAGE_SIZE)
            page = parse_int(params.get("page"), "page", default=1, min_value=1)
            window = slice((page - 1) * page_size, page * page_size)

        qs = (
            base.select_related(
                "student", "lesson", "lesson__course", "lesson__lesson_type", "lesson__teacher",
                "lesson__room", "lesson__room__location", "student_package__package",
                "created_by",
            )
            .order_by(*ordering)[window]
        )
        course_costs = course_cost_index([school_id])
        cost_by_package: dict = {}
        rows = []
        for b in qs:
            lesson = b.lesson
            # The package that paid (None for free lessons, for rows whose package
            # is gone — SET_NULL — or ETL rows without one), its catalog row and
            # its per-lesson cost when it has a single one
            sp = b.student_package if b.student_package_id else None
            pkg = sp.package if sp is not None and sp.package_id else None
            if sp is not None and sp.id not in cost_by_package:
                cost_by_package[sp.id] = student_package_lessons(sp, course_costs)[0]
            cost = cost_by_package[sp.id] if sp is not None else None
            room = lesson.room if lesson.room_id else None
            location = room.location if room is not None and room.location_id else None
            rows.append({
                "id": str(b.id),
                "booked_at": b.booked_at,
                "student_id": str(b.student_id),
                "student_name": b.student.name,
                "student_email": b.student.email,
                "lesson_id": str(lesson.id),
                "lesson_date": lesson.date,
                "start_time": lesson.start_time,
                "end_time": lesson.end_time,
                # The course's own name when it has one; the page falls back
                # to the lesson type in the viewer's language.
                "course_name": (lesson.course.name or "").strip() if lesson.course_id else "",
                "lesson_type": translated_names(lesson.lesson_type if lesson.lesson_type_id else None),
                "lesson_key": _lesson_key(lesson),
                "lesson_status": lesson.status,
                "teacher_id": str(lesson.teacher_id) if lesson.teacher_id else None,
                "teacher_name": lesson.teacher.name if lesson.teacher_id else "",
                "room_id": str(room.id) if room is not None else None,
                "room_name": room.name if room is not None else "",
                "location_id": str(location.id) if location is not None else None,
                "location_name": location.name if location is not None else "",
                "status": b.status,
                "access_source": b.access_source,
                # The package that paid for it, so the Source cell can name it
                # and open its usage. None for free lessons and for rows whose
                # package is gone (SET_NULL) or came from the ETL without one.
                "student_package_id": str(sp.id) if sp is not None else None,
                "package_name": translated_names(pkg),
                # A drop-in (single-lesson) package is told as "single lesson", not by its name
                "package_is_drop_in": bool(pkg is not None and pkg.is_drop_in),
                # A paid special event seat: its ticket, not a package
                "package_is_event_ticket": bool(pkg is not None and pkg.event_id is not None),
                # One lesson when the booking cost exactly what a lesson of its
                # package costs today (the usage modal's rule, StudentUsageModal
                # showCredits); a cost changed since, or no single cost, and the
                # table shows the credits instead of a misleading count
                "lessons": 1 if cost is not None and b.credits_deducted == cost else None,
                "created_by": _actor(b.created_by, b.student),
                "credits_deducted": b.credits_deducted,
                "cancelled_at": b.cancelled_at,
                "cancellation_type": b.cancellation_type,
                "credit_refunded": b.credit_refunded,
            })
        return Response({"rows": rows, "count": count, "page": page, "page_size": page_size, "kpis": agg})


class SchoolReportsStudentClassesView(APIView):
    """GET /api/school/reports/student-classes/ — per-student attendance
    history + package snapshot (spec 7.17's Student Classes tab)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from bookings.models import Attendance
        from schools.models import SchoolStudent
        from students.models import StudentPackage

        user = request.user
        # HQ may inspect any school via ?school=; without it, fall back to the
        # caller's own active school (multi-role users browsing the School panel).
        school_id = (
            parse_uuid(request.query_params.get("school"), "school") if is_hq(user) else None
        ) or user.active_school_id
        if not school_id:
            return Response({"error": "school is required"}, status=400)


        # Two queries for the whole school (packages, then the newest 200
        # attendance rows per student via a window function) instead of two
        # per student.
        from django.db.models import F, Window
        from django.db.models.functions import RowNumber

        links = list(SchoolStudent.objects.filter(school_id=school_id).select_related("student"))
        student_ids = [link.student_id for link in links]
        packages_by: dict = {}
        for p in StudentPackage.objects.filter(school_id=school_id, student_id__in=student_ids):
            packages_by.setdefault(p.student_id, []).append({
                "id": str(p.id), "credits_remaining": p.credits_remaining, "credits_total": p.credits_total,
                "expires_at": p.expires_at, "status": p.status,
            })
        att_qs = (
            Attendance.objects.filter(student_id__in=student_ids, lesson__school_id=school_id)
            .annotate(rn=Window(RowNumber(), partition_by=[F("student_id")], order_by=[F("lesson__date").desc(), F("lesson__start_time").desc()]))
            .select_related(
                "lesson", "lesson__course", "lesson__lesson_type", "lesson__teacher",
                "lesson__room", "lesson__room__location", "booking", "booking__student_package__package",
            )
        )
        attendance_by: dict = {}
        for a in att_qs.filter(rn__lte=200).order_by("-lesson__date", "-lesson__start_time"):
            lesson = a.lesson
            course_name = (lesson.course.name.strip() if lesson.course_id and lesson.course.name else "") or (
                lesson.lesson_type.name_en if lesson.lesson_type_id else "—"
            )
            attendance_by.setdefault(a.student_id, []).append({
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
                "package_is_drop_in": bool(
                    a.booking_id and a.booking.student_package_id and a.booking.student_package.package_id
                    and a.booking.student_package.package.is_drop_in
                ),
            })
        rows = [
            {
                "student_id": str(link.student.id), "student_name": link.student.name,
                "packages": packages_by.get(link.student_id, []),
                "attendance": attendance_by.get(link.student_id, []),
            }
            for link in links
        ]

        return Response({"rows": rows})


class HQReportsDetailedView(APIView):
    """GET /api/hq/reports/detailed/?tab=schools|teachers|students&from=&to=
    — the HQ Reports page's 3 tabs (CLAUDE.md 6.12). A separate endpoint from
    /hq/reports/ (dashboard KPI summary, a different shape already relied on)
    since both would otherwise collide on the same old-API path."""

    permission_classes = [IsAuthenticated, IsHQ]

    def get(self, request):
        now = date.today()
        default_from = now.replace(day=1)
        params = request.query_params
        # QA HQ-R2-04: a non-ISO ?from=/?to= went straight into the ORM and
        # came back as a 500. Parse first, then hand the tabs plain dates.
        date_from = parse_date(params.get("from"), "from") or default_from
        date_to = parse_date(params.get("to"), "to") or now
        tab = params.get("tab") or "schools"

        if tab == "schools":
            return Response(self._schools(date_from, date_to))
        if tab == "teachers":
            return Response(self._teachers(date_from, date_to))
        if tab == "students":
            return Response(self._students(date_from, date_to))
        return Response({"error": "Invalid tab"}, status=400)

    def _schools(self, date_from, date_to):
        from catalog.models import Lesson
        from schools.models import School, SchoolStudent
        from teachers.models import TeacherSchool

        schools = list(
            School.objects.all()
            .order_by("name")
            .values("id", "name", "city", "country", "active", "platform_fee_percentage", "shop_commission_percentage")
        )
        ids = [s["id"] for s in schools]

        stu = dict(
            SchoolStudent.objects.filter(school_id__in=ids)
            .values("school_id").annotate(c=Count("id")).values_list("school_id", "c")
        )
        tea = dict(
            TeacherSchool.objects.filter(school_id__in=ids, active=True)
            .values("school_id").annotate(c=Count("id")).values_list("school_id", "c")
        )
        les = dict(
            Lesson.objects.filter(school_id__in=ids, date__gte=date_from, date__lte=date_to)
            .exclude(status="cancelled")
            .values("school_id").annotate(c=Count("id")).values_list("school_id", "c")
        )
        rev = dict(
            Transaction.objects.filter(
                school_id__in=ids, status="completed", created_at__date__gte=date_from, created_at__date__lte=date_to
            ).values("school_id").annotate(s=Sum("amount")).values_list("school_id", "s")
        )

        shop_comm: dict = {}
        shop_total = 0.0
        for sale in ShopSale.objects.filter(
            created_at__date__gte=date_from, created_at__date__lte=date_to
        ):
            shop_total += float(sale.total or 0)
            # The commission belongs to the school on the sale line — the
            # student's home school when the product is HQ's — not to the
            # product's owner: HQ products have no school, so reading the
            # product left this column at zero for every school.
            if sale.school_id:
                shop_comm[sale.school_id] = shop_comm.get(sale.school_id, 0) + float(sale.commission or 0)

        rows = [
            {
                "id": str(s["id"]),
                "name": s["name"],
                "city": s["city"] or "",
                "country": s["country"] or "",
                "active": s["active"],
                "platform_fee": float(s["platform_fee_percentage"] or 0),
                "shop_commission_pct": float(s["shop_commission_percentage"] or 0),
                "students": stu.get(s["id"], 0),
                "teachers": tea.get(s["id"], 0),
                "lessons": les.get(s["id"], 0),
                "revenue": round(float(rev.get(s["id"], 0) or 0), 2),
                "shop_commission": round(shop_comm.get(s["id"], 0), 2),
            }
            for s in schools
        ]

        # QA round 2, HQ-R2-09: this total_students/total_teachers looked buggy
        # next to /hq/reports/ and the students/teachers tabs, but it's a
        # different metric by design, not a bug — investigated, no behavior
        # change made. Here we sum SchoolStudent/TeacherSchool *link* rows
        # per school, so a student or teacher active at 2 schools is counted
        # twice; Student.objects.count() (used by /hq/reports/ and the
        # students tab) and Teacher.objects.all() (teachers tab) count unique
        # people instead. Any residual drift beyond that (e.g. the QA report's
        # "varies with date" note) is students/teachers/schools being created
        # between two requests on live data, since none of these three counts
        # apply a date filter.
        return {
            "kpis": {
                "active_schools": sum(1 for s in schools if s["active"]),
                "total_students": sum(stu.values()),
                "total_teachers": sum(tea.values()),
                "revenue": round(sum(r["revenue"] for r in rows), 2),
                "shop_revenue": round(shop_total, 2),
            },
            "rows": rows,
        }

    def _teachers(self, date_from, date_to):
        from bookings.models import Attendance
        from catalog.models import Lesson
        from teachers.models import Teacher, TeacherSchool

        teachers = list(Teacher.objects.all().order_by("name"))

        schools_by_teacher: dict = {}
        for link in TeacherSchool.objects.filter(active=True).select_related("school"):
            schools_by_teacher.setdefault(link.teacher_id, []).append(link.school.name)

        lesson_agg: dict = {}
        for lesson in Lesson.objects.filter(date__gte=date_from, date__lte=date_to).exclude(status="cancelled"):
            if not lesson.teacher_id:
                continue
            agg = lesson_agg.setdefault(lesson.teacher_id, {"count": 0, "minutes": 0})
            agg["count"] += 1
            mins = (lesson.end_time.hour * 60 + lesson.end_time.minute) - (
                lesson.start_time.hour * 60 + lesson.start_time.minute
            )
            if mins > 0:
                agg["minutes"] += mins

        att_agg: dict = {}
        for att in Attendance.objects.filter(lesson__date__gte=date_from, lesson__date__lte=date_to):
            if not att.teacher_id:
                continue
            agg = att_agg.setdefault(att.teacher_id, {"present": 0, "no_show": 0})
            if att.status == "present":
                agg["present"] += 1
            elif att.status == "no_show":
                agg["no_show"] += 1

        rows = []
        for teacher in teachers:
            la = lesson_agg.get(teacher.id, {"count": 0, "minutes": 0})
            aa = att_agg.get(teacher.id, {"present": 0, "no_show": 0})
            marked = aa["present"] + aa["no_show"]
            rows.append({
                "id": str(teacher.id),
                "name": teacher.name,
                "email": teacher.email or "",
                "active": teacher.active,
                "schools": ", ".join(schools_by_teacher.get(teacher.id, [])),
                "lessons": la["count"],
                "hours": round(la["minutes"] / 60, 1),
                "present": aa["present"],
                "no_show": aa["no_show"],
                "attendance_rate": round(aa["present"] / marked * 100) if marked else None,
            })

        return {
            "kpis": {
                "total_teachers": len(rows),
                "active_teachers": sum(1 for r in rows if r["active"]),
                "lessons": sum(r["lessons"] for r in rows),
                "hours": round(sum(r["hours"] for r in rows), 1),
                "no_shows": sum(r["no_show"] for r in rows),
            },
            "rows": rows,
        }

    def _students(self, date_from, date_to):
        from bookings.models import Booking
        from students.models import Student, StudentPackage

        students = list(Student.objects.select_related("school").order_by("name")[:2000])

        book_agg: dict = {}
        for booking in Booking.objects.filter(booked_at__date__gte=date_from, booked_at__date__lte=date_to):
            agg = book_agg.setdefault(booking.student_id, {"total": 0, "attended": 0, "no_show": 0, "cancelled": 0})
            agg["total"] += 1
            if booking.status == "attended":
                agg["attended"] += 1
            elif booking.status == "no_show":
                agg["no_show"] += 1
            elif booking.status == "cancelled":
                agg["cancelled"] += 1

        credits: dict = {}
        for pkg in StudentPackage.objects.filter(status="active"):
            credits[pkg.student_id] = credits.get(pkg.student_id, 0) + (pkg.credits_remaining or 0)

        spend: dict = {}
        for tx in Transaction.objects.filter(
            status="completed", created_at__date__gte=date_from, created_at__date__lte=date_to
        ):
            if tx.student_id:
                spend[tx.student_id] = spend.get(tx.student_id, 0) + float(tx.amount or 0)
        for sale in ShopSale.objects.filter(created_at__date__gte=date_from, created_at__date__lte=date_to):
            if sale.student_id:
                spend[sale.student_id] = spend.get(sale.student_id, 0) + float(sale.total or 0)

        rows = []
        new_students = 0
        for student in students:
            b = book_agg.get(student.id, {"total": 0, "attended": 0, "no_show": 0, "cancelled": 0})
            created_date = student.created_at.date()
            if date_from <= created_date <= date_to:
                new_students += 1
            rows.append({
                "id": str(student.id),
                "name": student.name,
                "email": student.email or "",
                "city": student.city or "",
                "school": student.school.name if student.school_id else "",
                "school_id": str(student.school_id) if student.school_id else None,
                "created_at": student.created_at.isoformat(),
                "bookings": b["total"],
                "attended": b["attended"],
                "no_show": b["no_show"],
                "cancelled": b["cancelled"],
                "credits": credits.get(student.id, 0),
                "spend": round(spend.get(student.id, 0), 2),
            })

        return {
            "kpis": {
                "total_students": len(rows),
                "new_students": new_students,
                "bookings": sum(r["bookings"] for r in rows),
                "attended": sum(r["attended"] for r in rows),
                "spend": round(sum(r["spend"] for r in rows), 2),
            },
            "rows": rows,
        }


class HQReportsView(APIView):
    """GET /api/hq/reports/ — network-wide KPIs (CLAUDE.md 6.12)."""

    permission_classes = [IsAuthenticated, IsHQ]

    def get(self, request):
        from bookings.models import Booking
        from catalog.models import Lesson
        from schools.models import School
        from students.models import Student, active_subscriptions

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
                "active_subscriptions": active_subscriptions().count(),
                "bookings_total": Booking.objects.count(),
            }
        )
