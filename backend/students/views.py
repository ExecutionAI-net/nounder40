from django.db.models import Q, Sum
from decimal import Decimal

from rest_framework import generics, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.viewsets import is_hq

from .models import Student, StudentDocument, StudentPackage, StudentSubscription
from .serializers import (
    StudentDocumentSerializer,
    StudentPackageSerializer,
    StudentSerializer,
    StudentSubscriptionSerializer,
)


def get_student_or_404(request):
    student = Student.objects.filter(user=request.user).first()
    return student


class StudentRequiredMixin:
    permission_classes = [IsAuthenticated]

    def get_student(self):
        student = get_student_or_404(self.request)
        if student is None:
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied("No student profile for this account.")
        return student


class StudentProfileView(StudentRequiredMixin, APIView):
    def get(self, request):
        return Response(StudentSerializer(self.get_student()).data)

    def patch(self, request):
        serializer = StudentSerializer(self.get_student(), data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class StudentSchoolView(StudentRequiredMixin, APIView):
    """GET/POST /api/student/school/ — the student's currently selected home
    school (Student.school). Enrolls the student (SchoolStudent link) on set,
    matching the old "choose your school" first-time flow."""

    def get(self, request):
        student = self.get_student()
        if student.school_id is None:
            return Response({"school": None})
        from schools.serializers import PublicSchoolSerializer

        return Response({"school": PublicSchoolSerializer(student.school).data})

    def post(self, request):
        from schools.models import School, SchoolStudent
        from schools.serializers import PublicSchoolSerializer

        school = School.objects.filter(pk=request.data.get("school_id"), active=True).first()
        if school is None:
            return Response({"error": "school_not_found"}, status=status.HTTP_404_NOT_FOUND)
        student = self.get_student()
        student.school = school
        student.save(update_fields=["school"])
        SchoolStudent.objects.get_or_create(school=school, student=student)
        return Response({"school": PublicSchoolSerializer(school).data})


class StudentPackagesView(StudentRequiredMixin, generics.ListAPIView):
    serializer_class = StudentPackageSerializer

    def get_queryset(self):
        qs = StudentPackage.objects.filter(student=self.get_student()).order_by("-purchased_at")
        school = self.request.query_params.get("school")
        if school:
            qs = qs.filter(school_id=school)
        return qs


class StudentSubscriptionsView(StudentRequiredMixin, generics.ListAPIView):
    serializer_class = StudentSubscriptionSerializer

    def get_queryset(self):
        qs = StudentSubscription.objects.filter(student=self.get_student()).order_by("-started_at")
        school = self.request.query_params.get("school")
        if school:
            qs = qs.filter(school_id=school)
        return qs


class StudentCreditsView(StudentRequiredMixin, APIView):
    """Per-school credit balance (sum of remaining credits on active packages)."""

    def get(self, request):
        student = self.get_student()
        rows = (
            StudentPackage.objects.filter(student=student, status="active")
            .values("school_id", "school__name")
            .annotate(credits=Sum("credits_remaining"))
            .order_by("school__name")
        )
        data = [
            {"school_id": str(r["school_id"]), "school_name": r["school__name"], "credits": r["credits"] or 0}
            for r in rows
        ]
        return Response(data)


class StudentCreditHistoryView(StudentRequiredMixin, APIView):
    """GET /api/student/credit-history/ — per-lesson credit transaction log
    (deducted/refund/no_show) plus package purchases, newest first. Powers
    the My Packages page's per-package usage history and Credits History tab.
    Cancelled-outside-policy burns are folded into type='no_show' (both mean
    "credit lost"), matching the old frontend's icon logic, which only ever
    distinguished refund/no_show/anything-else."""

    def get(self, request):
        from bookings.models import Booking

        student = self.get_student()
        bookings = (
            Booking.objects.filter(student=student, credits_deducted__gt=0)
            .select_related(
                "lesson", "lesson__course", "lesson__lesson_type", "school",
                "lesson__room", "lesson__room__location", "student_package__package",
            )
            .order_by("-booked_at")
        )
        entries = []
        for b in bookings:
            lesson = b.lesson
            course_name = (lesson.course.name.strip() if lesson.course_id and lesson.course.name else "") if lesson else ""
            lt = lesson.lesson_type if lesson else None
            lesson_name = course_name or (lt and (lt.name_en or lt.name_it or lt.code)) or "Lesson"

            if b.status == Booking.Status.NO_SHOW:
                tx_type, credits = "no_show", -b.credits_deducted
            elif b.status == Booking.Status.CANCELLED:
                tx_type = "refund" if b.credit_refunded else "no_show"
                # Rimborso = effetto NETTO zero (scalato e restituito): così i
                # conti tornano a colpo d'occhio (per Carlo: -3 e 0 → saldo 7)
                credits = 0 if b.credit_refunded else -b.credits_deducted
            else:
                tx_type, credits = "deducted", -b.credits_deducted

            room = lesson.room if lesson and lesson.room_id else None
            entries.append({
                "id": str(b.id),
                "date": (b.cancelled_at or b.booked_at).isoformat(),
                "lesson_date": lesson.date.isoformat() if lesson else None,
                # Dettagli lezione per la card in stile "Le mie lezioni"
                "lesson_start_time": lesson.start_time.isoformat() if lesson and lesson.start_time else None,
                "lesson_end_time": lesson.end_time.isoformat() if lesson and lesson.end_time else None,
                "room_name": room.name if room else None,
                "location_name": room.location.name if room and room.location_id else None,
                "is_online": bool(lesson.is_online) if lesson else False,
                # Effective instruction language: lesson override, else course
                "lesson_language": (lesson.language or (lesson.course.language if lesson.course_id else "")) if lesson else None,
                "lesson_name": lesson_name,
                "school_name": b.school.name,
                "package_name": b.student_package.package.name_en if b.student_package_id and b.student_package.package_id else None,
                "student_package_id": str(b.student_package_id) if b.student_package_id else None,
                "credits": credits,
                "type": tx_type,
                "status": b.status,
            })

        purchases = (
            StudentPackage.objects.filter(student=student)
            .select_related("package", "school")
            .order_by("-purchased_at")
        )
        for p in purchases:
            entries.append({
                "id": f"purchase-{p.id}",
                "date": p.purchased_at.isoformat(),
                "lesson_date": None,
                "lesson_name": p.package.name_en if p.package_id else "Package",
                "school_name": p.school.name,
                "package_name": p.package.name_en if p.package_id else None,
                "student_package_id": str(p.id),
                "credits": p.credits_total,
                "type": "purchase",
                "status": p.status,
            })

        entries.sort(key=lambda e: e["date"], reverse=True)
        return Response(entries)


class StudentDocumentsView(StudentRequiredMixin, generics.ListCreateAPIView):
    serializer_class = StudentDocumentSerializer

    def get_queryset(self):
        return StudentDocument.objects.filter(student=self.get_student()).order_by("-uploaded_at")

    def create(self, request, *args, **kwargs):
        # Inject student BEFORE validation (not in perform_create, which runs
        # after is_valid()) — otherwise the serializer's required `student`
        # field rejects the request before we ever get a chance to set it.
        data = request.data.copy()
        data["student"] = self.get_student().id
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class StudentSchoolPackagesView(APIView):
    """GET /api/student/school-packages/?school_id= — public package catalog
    for the /student/buy page. No school_id: all schools' active packages
    (anonymous cross-network browsing). With school_id: just that school's.

    I prezzi lezione singola restano fuori dalla vetrina: si comprano dal
    calendario, sulla lezione che l'allieva sta guardando, dove il prezzo ha
    un senso e la prenotazione parte da sola. In mezzo ai pacchetti da dieci
    o venti lezioni sarebbero comunque il prodotto col peggior prezzo per
    credito, per costruzione. Restano comprabili per id: il checkout del
    drop-in passa di li' (DROP_IN_BOOKING.md §3.1)."""

    permission_classes = [AllowAny]

    def get(self, request):
        from catalog.models import Package
        from catalog.serializers import PublicPackageSerializer

        qs = (
            Package.objects.filter(active=True, is_drop_in=False)
            .select_related("school")
            .order_by("price")
        )
        school_id = request.query_params.get("school_id")
        if school_id:
            qs = qs.filter(school_id=school_id)
        return Response(PublicPackageSerializer(qs, many=True).data)


class StudentLessonPurchaseOptionsView(APIView):
    """GET /api/student/lessons/<pk>/purchase-options/ — cosa proporre a
    un'allieva senza crediti davanti a questa lezione (DROP_IN_BOOKING.md §3.1).

    Due opzioni, non una: comprare SOLO questa lezione (se la scuola ha un
    prezzo lezione singola che la copre) oppure un pacchetto, con la riga di
    upsell che dice quanto le costerebbe la stessa lezione comprandolo. Se la
    scuola non ha configurato un drop-in resta il solo pacchetto, cioe' il
    comportamento di oggi.

    Pubblico come il resto del catalogo (spec 9.2: sfogliare non richiede
    login): il prezzo si vede PRIMA di doversi registrare, l'account si chiede
    al momento di pagare."""

    permission_classes = [AllowAny]

    def get(self, request, pk):
        from catalog.models import Lesson

        from bookings.services import (
            _credit_cost,
            resolve_drop_in_package,
            resolve_upsell_package,
        )

        lesson = Lesson.objects.filter(pk=pk).select_related("course").first()
        if lesson is None:
            return Response({"error": "lesson_not_found"}, status=404)

        cost = _credit_cost(lesson)

        def shape(pkg, *, with_unit_price):
            if pkg is None:
                return None
            row = {
                "id": str(pkg.id), "price": str(pkg.price), "credits": str(pkg.credits),
                "name_it": pkg.name_it, "name_en": pkg.name_en,
                "name_fr": pkg.name_fr, "name_es": pkg.name_es,
            }
            if with_unit_price:
                # Quanto verrebbe a costare QUESTA lezione dentro il pacchetto.
                row["price_per_lesson"] = str(
                    (Decimal(pkg.price) / Decimal(pkg.credits) * cost).quantize(Decimal("0.01"))
                )
            return row

        # Nessun filtro sullo stato Stripe della scuola: il drop-in si mostra
        # comunque e il rifiuto (`school_not_connected`) arriva al click, come
        # gia' succede per l'acquisto di un pacchetto (§3.1).
        return Response({
            "credit_cost": str(cost),
            "drop_in": shape(resolve_drop_in_package(lesson), with_unit_price=False),
            "upsell": shape(resolve_upsell_package(lesson), with_unit_price=True),
        })


class StudentLessonsView(APIView):
    """Browse bookable lessons across schools (scheduled, future) — PUBLIC,
    anonymous visitors can browse too (spec 9.2: booking only requires login).
    Filters (all comma-separated for multi-select, matching the booking page's
    MultiFilterSelect controls): ?school_id= ?lesson_type_id= ?teacher_id=
    ?country= ?city= ?language= ?is_online= ?date= ."""

    permission_classes = [AllowAny]

    def get(self, request):
        from datetime import date

        from catalog.models import Lesson
        from catalog.serializers import LessonBookingSerializer

        qs = (
            Lesson.objects.filter(status="scheduled", date__gte=date.today())
            .select_related("school", "teacher", "lesson_type", "room", "room__location", "course")
            .order_by("date", "start_time")
        )
        p = request.query_params

        def multi(param):
            raw = p.get(param)
            return [v for v in raw.split(",") if v] if raw else []

        school_ids = multi("school_id") or multi("school")
        if school_ids:
            qs = qs.filter(school_id__in=school_ids)
        lesson_type_ids = multi("lesson_type_id") or multi("lesson_type")
        if lesson_type_ids:
            qs = qs.filter(lesson_type_id__in=lesson_type_ids)
        teacher_ids = multi("teacher_id")
        if teacher_ids:
            qs = qs.filter(teacher_id__in=teacher_ids)
        countries = multi("country")
        if countries:
            qs = qs.filter(school__country__in=countries)
        cities = multi("city")
        if cities:
            qs = qs.filter(school__city__in=cities)
        languages = multi("language")
        if languages:
            # Per-lesson override wins; blank falls back to the course language
            qs = qs.filter(
                Q(language__in=languages) | (Q(language="") & Q(course__language__in=languages))
            )
        if p.get("is_online") in ("true", "false"):
            qs = qs.filter(is_online=(p["is_online"] == "true"))
        if p.get("date"):
            qs = qs.filter(date=p["date"])

        return Response(LessonBookingSerializer(qs[:500], many=True).data)


class HQStudentsListView(APIView):
    """GET /api/hq/students/?q= — network-wide student list for HQ selectors
    (e.g. the shop's manual-sale student search)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not is_hq(request.user):
            raise PermissionDenied("HQ only.")
        qs = Student.objects.select_related("school").order_by("name")
        q = request.query_params.get("q")
        if q:
            qs = qs.filter(Q(name__icontains=q) | Q(email__icontains=q))
        return Response([
            {
                "id": str(s.id), "name": s.name, "email": s.email,
                "schools": {"name": s.school.name} if s.school_id else None,
            }
            for s in qs[:1000]
        ])
