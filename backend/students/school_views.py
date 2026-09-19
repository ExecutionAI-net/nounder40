"""School-side student management: list/detail with per-school wallet summary,
manual credit grants (cash payments), and document validation."""

from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.services import course_cost_index, student_package_lessons, translated_names
from core.params import ensure_object_body, parse_date, parse_decimal, parse_uuid, parse_uuid_list
from core.viewsets import CourseCostContextMixin, is_hq
from schools.models import School, SchoolDocumentType, SchoolMembership, SchoolStudent
from schools.serializers import SchoolDocumentTypeSerializer

from .models import ManualCreditGrant, Student, StudentDocument, StudentPackage
from .school_serializers import CreditGrantSerializer, SchoolDocumentSerializer


def _caller_school(request) -> School:
    user = request.user
    # HQ may inspect any school via ?school=; without it, fall back to the
    # caller's own active school (multi-role users browsing the School panel).
    school_id = (
        parse_uuid(request.query_params.get("school"), "school") if is_hq(user) else None
    ) or user.active_school_id
    if not school_id:
        raise ValidationError("school is required")
    school = School.objects.filter(pk=school_id).first()
    if school is None:
        raise ValidationError("school not found")
    return school


class SchoolStudentListView(APIView):
    """GET /api/school/students/ — enrolled students at the caller's school,
    each with their active packages/subscriptions (name + balance) and free-
    lesson status (spec 7.7). PATCH {school_student_id, free_lesson_used}
    flips the free-first-lesson flag. POST adds one student by hand (the
    "Add student" button; see `post`). HQ must pass ?school=."""

    permission_classes = [IsAuthenticated]

    ADD_FIELDS = (
        "email", "first_name", "last_name", "name", "phone", "address", "city", "postal_code", "province",
        "country", "date_of_birth", "language_preference",
    )

    def post(self, request):
        """POST /api/school/students/ — one student typed in by the school:
        {email, first_name, last_name, phone, address, city, postal_code,
        province, country, date_of_birth, language_preference, send_email}.
        One row through the import rules (students/services.add_student):
        201 {action: create|enroll, student_id, password_email} when the
        account was created or enrolled, 409 {error: already_enrolled} when
        she is here already, 400 {error, field} for a bad row. `send_email`
        (default true) also queues the e-mail to set the password."""
        from core.locales import LOCALES, clamp_locale
        from core.params import parse_bool

        from .services import add_student

        school = _caller_school(request)
        body = ensure_object_body(request.data)
        data = {name: body.get(name) for name in self.ADD_FIELDS}
        send_email = parse_bool(body.get("send_email"), "send_email", default=True)
        # Same language ladder as the import wizard: the row's own, else the
        # admin's, else the school's.
        fallback = request.user.language_preference if request.user.language_preference in LOCALES else school.language
        row = add_student(school, data, default_language=clamp_locale(fallback), send_email=send_email)
        if row["action"] == "error":
            return Response({"error": row["error"], "field": row["error_field"]}, status=status.HTTP_400_BAD_REQUEST)
        if row["action"] == "already_enrolled":
            return Response(
                {"error": "already_enrolled", "student_id": row["student_id"]}, status=status.HTTP_409_CONFLICT
            )
        return Response(
            {
                "action": row["action"], "student_id": row["student_id"], "name": row["name"], "email": row["email"],
                "password_email": row["password_email"], "warnings": row["warnings"],
            },
            status=status.HTTP_201_CREATED,
        )

    def get(self, request):
        school = _caller_school(request)
        links = SchoolStudent.objects.filter(school=school).select_related("student").order_by("-enrolled_at")

        rows = []
        for link in links:
            student = link.student
            packages = StudentPackage.objects.filter(
                student=student, school=school, status="active"
            ).select_related("package")
            subs = student.subscriptions.filter(school=school, status="active").select_related("subscription_catalog")
            rows.append({
                "id": str(link.id),
                "enrolled_at": link.enrolled_at,
                "free_lesson_used": link.free_lesson_used,
                "imported_at": link.imported_at,
                # Names as the four name_* columns (catalog.services.translated_names),
                # resolved on the client in the viewer's language: name_en here
                # kept the Students page in English whatever the UI language.
                "packages": [
                    {
                        "name": translated_names(p.package if p.package_id else None),
                        "credits": p.credits_remaining,
                        "expires_at": p.expires_at,
                    }
                    for p in packages
                ],
                "subscriptions": [
                    {"name": translated_names(s.subscription_catalog if s.subscription_catalog_id else None)}
                    for s in subs
                ],
                "students": {
                    "id": str(student.id),
                    "user_id": str(student.user_id) if student.user_id else None,
                    "name": student.name,
                    "email": student.email,
                    "phone": student.phone,
                    "city": student.city,
                    "created_at": student.created_at,
                },
            })
        return Response(rows)

    def patch(self, request):
        """Two independent shapes share this endpoint (matching the old
        Supabase-era API): {school_student_id, free_lesson_used} flips the
        free-lesson flag; {student_user_id, name, phone, email, ...} lets the
        school correct a student's profile (StudentSheet, editable=True)."""
        school = _caller_school(request)
        body = ensure_object_body(request.data)

        if "school_student_id" in body:
            link = SchoolStudent.objects.filter(
                pk=parse_uuid(body.get("school_student_id"), "school_student_id"), school=school
            ).first()
            if link is None:
                return Response({"error": "not_found"}, status=status.HTTP_404_NOT_FOUND)
            if "free_lesson_used" in request.data:
                link.free_lesson_used = bool(request.data["free_lesson_used"])
                link.save(update_fields=["free_lesson_used"])
            return Response({"id": str(link.id), "free_lesson_used": link.free_lesson_used})

        student = Student.objects.filter(
            user_id=parse_uuid(body.get("student_user_id"), "student_user_id")
        ).first()
        if student is None or not SchoolStudent.objects.filter(school=school, student=student).exists():
            return Response({"error": "not_found"}, status=status.HTTP_404_NOT_FOUND)

        new_email = (request.data.get("email") or "").strip().lower()
        if new_email and "@" not in new_email:
            return Response({"error": "invalid_email"}, status=status.HTTP_400_BAD_REQUEST)

        if "date_of_birth" in request.data:
            student.date_of_birth = parse_date(request.data["date_of_birth"], "date_of_birth")
        for field in ("first_name", "last_name", "phone", "address", "city", "postal_code", "province", "country", "language_preference"):
            if field in request.data:
                setattr(student, field, request.data[field] or "")
        if "name" in request.data and "first_name" not in request.data:
            # nome intero → campi separati, altrimenti save() lo ricompone dai vecchi
            head, _, rest = " ".join((request.data.get("name") or "").split()).partition(" ")
            student.first_name, student.last_name = head, rest
        if new_email and new_email != student.email.lower():
            student.email = new_email
            if student.user_id:
                student.user.email = new_email
                student.user.save(update_fields=["email"])
        student.save()
        from students.serializers import StudentSerializer

        return Response(StudentSerializer(student).data)


class SchoolStudentDeleteView(APIView):
    """DELETE /api/school/students/delete/?student_user_id= — the school
    removes a student account outright (test sign-ups, duplicates). Refused
    when the account is also enrolled elsewhere or carries another role: that
    is someone else's student too, and only HQ may touch it.

    SCH-R2-04: `students` sits in the staff permission matrix (staff
    legitimately need day-to-day read/manage access to students), but
    permanently deleting the account is a much more destructive action than
    that matrix entry was meant to cover, and the section guard alone let any
    `staff` member trigger it. Gated here, on this one destructive action
    only — the `students` section entry itself is untouched."""

    permission_classes = [IsAuthenticated]

    def delete(self, request):
        school = _caller_school(request)
        if not is_hq(request.user):
            # Direct SchoolMembership lookup, no fallback to the flat
            # `school_sub_role` ETL column — same reasoning as
            # core.section_guard's own _membership(): a stale/absent column
            # value must not be able to keep this door open.
            membership = SchoolMembership.objects.filter(profile=request.user, school=school).only("sub_role").first()
            if (membership.sub_role if membership else "") not in ("owner", "admin"):
                return Response({"error": "forbidden"}, status=status.HTTP_403_FORBIDDEN)
        student = Student.objects.filter(
            user_id=parse_uuid(request.query_params.get("student_user_id"), "student_user_id")
        ).select_related("user").first()
        if student is None or not SchoolStudent.objects.filter(school=school, student=student).exists():
            return Response({"error": "not_found"}, status=status.HTTP_404_NOT_FOUND)
        if SchoolStudent.objects.filter(student=student).exclude(school=school).exists():
            return Response({"error": "linked_elsewhere"}, status=status.HTTP_409_CONFLICT)
        roles = [r for r in (student.user.roles or [student.user.role]) if r]
        if any(r != "student" for r in roles):
            return Response({"error": "multi_role"}, status=status.HTTP_409_CONFLICT)
        from students.views import _send_account_deleted_email

        # R2-M20c: e' la SCUOLA a eliminare, non l'allieva: copia diversa.
        _send_account_deleted_email(student, deleted_by_school=school)
        student.user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class SchoolStudentResetPasswordView(APIView):
    """POST /api/school/students/reset-password/ — {student_user_id}. School
    admin triggers the "set your password" e-mail on the student's behalf
    (spec 7.15's "quick replies" support workflow implies this kind of
    assist). An account that never chose a password (imported, added by the
    school) gets the school invitation with the setup link instead of a reset
    it never asked for -- students/services.queue_password_email picks. `sent`
    is honest: False when that e-mail is switched off in HQ > Emails."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        from .services import queue_password_email

        school = _caller_school(request)
        user_id = parse_uuid(ensure_object_body(request.data).get("student_user_id"), "student_user_id")
        student = Student.objects.filter(user_id=user_id).select_related("user").first()
        if student is None or not SchoolStudent.objects.filter(school=school, student=student).exists():
            return Response({"error": "not_found"}, status=status.HTTP_404_NOT_FOUND)
        kind = queue_password_email(student, school)
        return Response({"sent": kind is not None, "kind": kind})


class SchoolStudentDetailView(APIView):
    """GET /api/school/students/detail/?student_id= — full profile + wallets +
    documents + booking history for one student at the caller's school.
    packages/subscriptions/bookings carry nested multi-language name objects
    (packages/subscriptions_catalog/lessons.courses/lessons.lesson_types) —
    StudentUsageModal needs per-language names, which the flat
    StudentPackageSerializer.package_name (single resolved string) used
    elsewhere doesn't provide."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from bookings.models import Booking
        from students.serializers import StudentSerializer

        school = _caller_school(request)
        student_id = parse_uuid(request.query_params.get("student_id"), "student_id")
        student = Student.objects.filter(pk=student_id).first()
        if student is None or not SchoolStudent.objects.filter(school=school, student=student).exists():
            return Response({"error": "not_found"}, status=status.HTTP_404_NOT_FOUND)

        packages = StudentPackage.objects.filter(student=student, school=school).select_related("package")
        subs = student.subscriptions.filter(school=school).select_related("subscription_catalog")
        bookings = (
            Booking.objects.filter(student=student, school=school)
            .select_related("lesson", "lesson__course", "lesson__lesson_type")
            .order_by("-booked_at")[:100]
        )

        def lang_name(obj):
            if obj is None:
                return None
            return {"name_en": obj.name_en, "name_it": obj.name_it, "name_es": obj.name_es}

        return Response({
            # user_id in piu': la scheda salva ed elimina per user id, e il
            # serializer non lo espone (senza, i bottoni non facevano nulla)
            "student": {**StudentSerializer(student).data, "user_id": str(student.user_id) if student.user_id else None},
            "school_id": str(school.id),
            "documentTypes": SchoolDocumentTypeSerializer(
                SchoolDocumentType.objects.filter(school=school, active=True).order_by("sort_order"), many=True
            ).data,
            "packages": [
                {
                    "id": str(p.id), "credits_total": p.credits_total, "credits_remaining": p.credits_remaining,
                    "purchased_at": p.purchased_at, "expires_at": p.expires_at, "status": p.status,
                    "payment_method": p.payment_method,
                    "packages": lang_name(p.package),
                }
                for p in packages
            ],
            "subscriptions": [
                {
                    "id": str(s.id), "access_total": s.access_total, "access_remaining": s.access_remaining,
                    "started_at": s.started_at, "current_period_end": s.current_period_end, "status": s.status,
                    "subscriptions_catalog": lang_name(s.subscription_catalog),
                }
                for s in subs
            ],
            "documents": SchoolDocumentSerializer(
                StudentDocument.objects.filter(student=student, school=school), many=True
            ).data,
            "bookings": [
                {
                    "id": str(b.id), "status": b.status, "credits_deducted": b.credits_deducted,
                    "access_source": b.access_source, "booked_at": b.booked_at,
                    "lessons": {
                        "date": b.lesson.date, "start_time": b.lesson.start_time,
                        "courses": {"name": b.lesson.course.name} if b.lesson.course_id else None,
                        "lesson_types": lang_name(b.lesson.lesson_type),
                    } if b.lesson_id else None,
                }
                for b in bookings
            ],
        })


def _package_card(sp: StudentPackage, course_costs: dict) -> dict:
    """One package for the usage modal. `course_costs` is
    course_cost_index([school.id]): credits also come back as lessons when
    the package can be told in lessons (catalog.services
    .student_package_lessons, the same rule the student sees), else the
    three lesson fields are None."""
    cost, lessons_total, lessons_remaining = student_package_lessons(sp, course_costs)
    return {
        "id": str(sp.id),
        "name": translated_names(sp.package if sp.package_id else None),
        "credits_total": sp.credits_total,
        "credits_remaining": sp.credits_remaining,
        "purchased_at": sp.purchased_at,
        "expires_at": sp.expires_at,
        "status": sp.status,
        "lesson_credit_cost": str(cost) if cost is not None else None,
        "lessons_total": lessons_total,
        "lessons_remaining": lessons_remaining,
    }


class SchoolStudentUsageView(APIView):
    """GET /api/school/student-usage/?student_id= — the student's ACTIVE
    packages at the caller's school, newest first: what the Students page's
    usage modal shows. Past packages are deliberately left out — a student
    buying one a month would make the modal endless; they live in
    Reports → Packages, filtered by student. HQ may pass ?school=.

    Its own URL segment (`student-usage`, section "students") so that the
    section guard can also let a reports-only role read it — the modal opens
    from Reports too — without opening the roster under students/."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        school = _caller_school(request)
        student_id = parse_uuid(request.query_params.get("student_id"), "student_id")
        student = Student.objects.filter(pk=student_id).first()
        if student is None or not SchoolStudent.objects.filter(school=school, student=student).exists():
            return Response({"error": "not_found"}, status=status.HTTP_404_NOT_FOUND)
        packages = (
            StudentPackage.objects.filter(student=student, school=school, status=StudentPackage.Status.ACTIVE)
            .select_related("package")
            .order_by("-purchased_at")
        )
        course_costs = course_cost_index([school.id])
        return Response({
            "student": {"id": str(student.id), "name": student.name},
            "packages": [_package_card(p, course_costs) for p in packages],
        })


class SchoolStudentPackageUsageView(APIView):
    """GET /api/school/student-usage/packages/<pk>/ — one package bought at
    the caller's school and every booking paid with it, latest lesson first.
    Each row also says where the lesson is (location, room, online).
    A booking draws on exactly one package and a refund goes back to that
    same one (bookings/services.py), so this list is the package's credit
    ledger: cancelled rows stay and say whether the credit came back.
    Bookings that lost their package link (SET_NULL, or ETL rows without
    one) are not here; Reports → Bookings still lists them."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        from bookings.models import Booking

        school = _caller_school(request)
        sp = StudentPackage.objects.filter(pk=pk, school=school).select_related("student", "package").first()
        if sp is None:
            return Response({"error": "not_found"}, status=status.HTTP_404_NOT_FOUND)
        bookings = (
            Booking.objects.filter(student_package=sp)
            .select_related("lesson", "lesson__course", "lesson__lesson_type", "lesson__room__location")
            .order_by("-lesson__date", "-lesson__start_time", "-booked_at")
        )
        rows = []
        for b in bookings:
            lesson = b.lesson
            rows.append({
                "id": str(b.id),
                "status": b.status,
                "credits_deducted": b.credits_deducted,
                "credit_refunded": b.credit_refunded,
                "booked_at": b.booked_at,
                "lesson_date": lesson.date,
                "start_time": lesson.start_time,
                "course_name": (lesson.course.name or "").strip() if lesson.course_id else "",
                "lesson_type": translated_names(lesson.lesson_type if lesson.lesson_type_id else None),
                # Where the lesson is, told the way the student's own page and
                # Reports → Bookings tell it: the lesson's room (set from the course
                # schedule at generation time), no course fallback; online says so.
                "is_online": bool(lesson.is_online),
                "location_name": lesson.room.location.name if lesson.room_id else "",
                "room_name": lesson.room.name if lesson.room_id else "",
            })
        return Response({
            "student": {"id": str(sp.student_id), "name": sp.student.name},
            "package": _package_card(sp, course_cost_index([school.id])),
            "bookings": rows,
        })


class CreditGrantView(APIView):
    """POST /api/school/credits/grant/ — assign credits manually (cash payment).
    Bumps (or creates) a StudentPackage for the school and logs the grant."""

    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request):
        school = _caller_school(request)
        body = ensure_object_body(request.data)
        student_id = parse_uuid(body.get("student_id"), "student_id")
        # X-R3-06: Decimal("NaN") parses fine here and then compares False
        # against every bound below, so "NaN" sailed through all four checks
        # and was written to the wallet. parse_decimal rejects non-finite
        # values outright; half credits are still allowed.
        amount = parse_decimal(body.get("amount", 0), "amount", default=Decimal("0"))
        if amount <= 0:
            return Response({"error": "amount must be positive"}, status=status.HTTP_400_BAD_REQUEST)
        # StudentPackage.credits_total/credits_remaining and
        # ManualCreditGrant.amount are all DecimalField(max_digits=6,
        # decimal_places=1) — 99999.9 is the largest value they can hold.
        # Anything above that must fail cleanly here, before it reaches the
        # DB and surfaces as an unhandled decimal.InvalidOperation / 500.
        if amount > Decimal("99999.9"):
            return Response({"error": "amount_too_large"}, status=status.HTTP_400_BAD_REQUEST)
        # QA R2-L11c: crediti a passi di mezzo credito (CLAUDE.md §4.2). Il
        # DecimalField ha una cifra decimale, quindi il DB accetterebbe 0.3
        # senza protestare: la regola di dominio vive qui. La modale della
        # scuola la applica gia' lato client — questo chiude la stessa porta
        # per una chiamata diretta all'API.
        if amount % Decimal("0.5") != 0:
            return Response({"error": "amount_not_half_credit_step"}, status=status.HTTP_400_BAD_REQUEST)

        student = Student.objects.filter(pk=student_id).first()
        if student is None or not SchoolStudent.objects.filter(school=school, student=student).exists():
            return Response({"error": "student_not_found"}, status=status.HTTP_404_NOT_FOUND)

        payment_method = request.data.get("payment_method", "cash")

        # Scegliendo un pacchetto il form disabilita il campo data e scrive
        # "la scadenza viene dal pacchetto" — ma la scadenza non la calcolava
        # nessuno, e quei crediti restavano SENZA scadenza per sempre. Ora si
        # deriva dalla validita' del pacchetto, come fa il webhook Stripe per
        # gli acquisti online: stessa regola per le due strade.
        catalog_id = request.data.get("package_catalog_id") or None
        expires_at = request.data.get("expires_at") or None
        if catalog_id and not expires_at:
            from catalog.models import Package

            catalog = Package.objects.filter(pk=catalog_id).first()
            if catalog is not None:
                expires_at = timezone.now() + catalog.validity_delta()

        pkg = StudentPackage.objects.create(
            student=student, school=school, package_id=catalog_id,
            credits_total=amount, credits_remaining=amount,
            expires_at=expires_at,
            payment_method=payment_method, status="active",
        )

        grant = ManualCreditGrant.objects.create(
            school=school, student=student, package=pkg,
            package_name=request.data.get("package_name") or "",
            granted_by=request.user, amount=amount,
            reason=request.data.get("reason") or "", note=request.data.get("note") or "",
            price=request.data.get("price") or None, payment_method=payment_method,
        )
        return Response(CreditGrantSerializer(grant).data, status=status.HTTP_201_CREATED)


class CreditGrantListView(CourseCostContextMixin, generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = CreditGrantSerializer

    def get_queryset(self):
        school = _caller_school(self.request)
        return (
            ManualCreditGrant.objects.filter(school=school)
            .select_related("student", "granted_by", "package", "package__package")
            .order_by("-created_at")
        )




class SchoolDocumentListView(generics.ListCreateAPIView):
    """GET /api/school/documents/ — one row per enrolled student with all
    their documents (type_id/school_id remapped from Django's raw type_ref/
    school FK names) plus the school's active document types — powers the
    Documents page's per-student-per-type status grid (spec 7.11). POST —
    school admin uploads a document on a student's behalf
    (StudentDocumentsPanel's canManage mode): {student, type_ref, variant,
    files}; school is injected server-side, and the student must already be
    enrolled at this school."""

    permission_classes = [IsAuthenticated]
    serializer_class = SchoolDocumentSerializer

    def get_queryset(self):
        school = _caller_school(self.request)
        qs = StudentDocument.objects.filter(school=school).select_related("student").order_by("-uploaded_at")
        student_id = parse_uuid(self.request.query_params.get("student_id"), "student_id")
        if student_id:
            qs = qs.filter(student_id=student_id)
        return qs

    def list(self, request, *args, **kwargs):
        school = _caller_school(request)
        docs_by_student: dict = {}
        for doc in StudentDocument.objects.filter(school=school):
            docs_by_student.setdefault(str(doc.student_id), []).append(doc)

        students = []
        for link in SchoolStudent.objects.filter(school=school).select_related("student").order_by("student__name"):
            s = link.student
            students.append({
                "id": str(s.id), "name": s.name, "email": s.email, "phone": s.phone,
                "documents": [
                    {
                        "id": str(d.id), "type_id": str(d.type_ref_id) if d.type_ref_id else None,
                        "variant": d.variant, "files": d.files, "file_url": d.file_url,
                        "expires_at": d.expires_at, "status": d.status, "validated_at": d.validated_at,
                        "note": d.note,
                    }
                    for d in docs_by_student.get(str(s.id), [])
                ],
            })

        types = SchoolDocumentTypeSerializer(
            SchoolDocumentType.objects.filter(school=school, active=True).order_by("sort_order"), many=True
        ).data
        return Response({"students": students, "types": types})

    def create(self, request, *args, **kwargs):
        school = _caller_school(request)
        if not SchoolStudent.objects.filter(school=school, student_id=request.data.get("student")).exists():
            return Response({"error": "student_not_enrolled"}, status=status.HTTP_400_BAD_REQUEST)
        data = request.data.copy()
        data["school"] = str(school.id)
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class SchoolDocumentValidateView(APIView):
    """PATCH /api/school/documents/{id}/ — school approves/rejects an uploaded
    document, sets its expiry, or leaves a note.

    QA R2-H6: this used to read ONLY `status` from the body, but
    StudentDocumentsPanel.tsx's Approve/Reject/expiry-date/Flag controls all
    send `{action: "validate"|"reject"|"expiry"|"flag", ...}` -- none of
    which is a `status` key -- so every one of them silently did nothing
    except bump validated_by/validated_at (Reject produced the exact same
    result as Approve: status untouched). Now the actual action is
    interpreted; a caller that still sends a bare `status` (any other
    integration) keeps working via the fallback branch."""

    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        user = request.user
        doc = StudentDocument.objects.filter(pk=pk).first()
        if doc is None:
            return Response({"error": "not_found"}, status=status.HTTP_404_NOT_FOUND)
        if not is_hq(user) and doc.school_id != user.active_school_id:
            raise PermissionDenied("Not your school.")

        action = request.data.get("action")
        if action == "expiry":
            doc.expires_at = request.data.get("expires_at") or None
            doc.save(update_fields=["expires_at"])
            return Response(SchoolDocumentSerializer(doc).data)
        if action == "flag":
            doc.note = request.data.get("note") or ""
            doc.save(update_fields=["note"])
            return Response(SchoolDocumentSerializer(doc).data)

        if action == "validate":
            if not (doc.files or getattr(doc, "file_url", "")):
                # SCH-R4-08c: an empty record could be marked valid; the
                # booking gate ignores it but the row then sits as "valid",
                # locked against deletion, with nothing behind it.
                return Response({"error": "document_has_no_file"}, status=status.HTTP_400_BAD_REQUEST)
            new_status = StudentDocument.Status.VALID
        elif action == "reject":
            new_status = StudentDocument.Status.REJECTED
        else:
            new_status = request.data.get("status")
        if new_status:
            doc.status = new_status
        doc.validated_by = user
        doc.validated_at = timezone.now()
        doc.save(update_fields=["status", "validated_by", "validated_at"])
        return Response(SchoolDocumentSerializer(doc).data)


class SchoolStudentImportView(APIView):
    """POST /api/school/students/import/ — bulk import from a spreadsheet the
    school mapped column by column in the Students page (students/services.py
    has the rules). Body: {rows: [{row, email, name|first_name/last_name,
    phone, address, city, postal_code, province, country, date_of_birth,
    language_preference}], dry_run, language_preference, phone_prefix}.

    `dry_run` (default true) only plans: the per-row outcome it returns is the
    preview the school confirms, and the confirmed call repeats the same
    payload with dry_run=false. `language_preference` is the language of the
    new accounts (e-mails, activation page) for rows without one of their own;
    `phone_prefix` ("+39") completes phone numbers that come without an
    international prefix (default: the school's country). No e-mail leaves:
    the school sends the password e-mail afterwards, from the list. HQ must
    pass ?school=."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        from core.locales import LOCALES, clamp_locale
        from core.params import parse_bool

        from .services import MAX_ROWS, import_students

        school = _caller_school(request)
        body = ensure_object_body(request.data)
        rows = body.get("rows")
        if not isinstance(rows, list) or not rows or not all(isinstance(r, dict) for r in rows):
            return Response({"error": "rows_required"}, status=status.HTTP_400_BAD_REQUEST)
        if len(rows) > MAX_ROWS:
            return Response({"error": "too_many_rows", "max": MAX_ROWS}, status=status.HTTP_400_BAD_REQUEST)
        dry_run = parse_bool(body.get("dry_run"), "dry_run", default=True)
        phone_prefix = body.get("phone_prefix")
        if phone_prefix is not None and (not isinstance(phone_prefix, str) or len(phone_prefix) > 10):
            return Response({"error": "invalid_phone_prefix"}, status=status.HTTP_400_BAD_REQUEST)
        # The language the school picks in the wizard, else the one the admin
        # is working in, else the school's own -- the same ladder as inviting
        # a teacher.
        fallback = request.user.language_preference if request.user.language_preference in LOCALES else school.language
        language = clamp_locale(body.get("language_preference"), clamp_locale(fallback))
        return Response(import_students(
            school, rows, dry_run=dry_run, default_language=language, phone_prefix=phone_prefix,
        ))


class SchoolStudentPasswordEmailsView(APIView):
    """POST /api/school/students/password-emails/ — {student_ids: [...]}. The
    bulk action of the Students page: the school selects students (typically
    the ones it just imported) and each gets the e-mail to set her password --
    the school invitation with the setup link if she never had one, the
    ordinary reset otherwise (students/services.queue_password_email). Ids
    not enrolled at this school are ignored and counted as `not_found`;
    `switched_off` counts the e-mails HQ > Emails did not let leave."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        from .services import MAX_ROWS, send_password_emails

        school = _caller_school(request)
        body = ensure_object_body(request.data)
        ids = body.get("student_ids")
        if not isinstance(ids, list) or not ids:
            return Response({"error": "student_ids_required"}, status=status.HTTP_400_BAD_REQUEST)
        if len(ids) > MAX_ROWS:
            return Response({"error": "too_many_students", "max": MAX_ROWS}, status=status.HTTP_400_BAD_REQUEST)
        return Response(send_password_emails(school, parse_uuid_list(ids, "student_ids")))
