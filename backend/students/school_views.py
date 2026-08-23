"""School-side student management: list/detail with per-school wallet summary,
manual credit grants (cash payments), and document validation."""

from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.viewsets import is_hq
from schools.models import School, SchoolDocumentType, SchoolStudent
from schools.serializers import SchoolDocumentTypeSerializer

from .models import ManualCreditGrant, Student, StudentDocument, StudentPackage
from .school_serializers import CreditGrantSerializer, SchoolDocumentSerializer


def _caller_school(request) -> School:
    user = request.user
    # HQ may inspect any school via ?school=; without it, fall back to the
    # caller's own active school (multi-role users browsing the School panel).
    school_id = (
        request.query_params.get("school") if is_hq(user) else None
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
    flips the free-first-lesson flag. HQ must pass ?school=."""

    permission_classes = [IsAuthenticated]

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
                "packages": [
                    {
                        "name": p.package.name_en if p.package_id else "",
                        "credits": p.credits_remaining,
                        "expires_at": p.expires_at,
                    }
                    for p in packages
                ],
                "subscriptions": [
                    {"name": s.subscription_catalog.name_en if s.subscription_catalog_id else ""}
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

        if "school_student_id" in request.data:
            link = SchoolStudent.objects.filter(pk=request.data.get("school_student_id"), school=school).first()
            if link is None:
                return Response({"error": "not_found"}, status=status.HTTP_404_NOT_FOUND)
            if "free_lesson_used" in request.data:
                link.free_lesson_used = bool(request.data["free_lesson_used"])
                link.save(update_fields=["free_lesson_used"])
            return Response({"id": str(link.id), "free_lesson_used": link.free_lesson_used})

        student = Student.objects.filter(user_id=request.data.get("student_user_id")).first()
        if student is None or not SchoolStudent.objects.filter(school=school, student=student).exists():
            return Response({"error": "not_found"}, status=status.HTTP_404_NOT_FOUND)

        new_email = (request.data.get("email") or "").strip().lower()
        if new_email and "@" not in new_email:
            return Response({"error": "invalid_email"}, status=status.HTTP_400_BAD_REQUEST)

        if "date_of_birth" in request.data:
            student.date_of_birth = request.data["date_of_birth"] or None
        for field in ("name", "phone", "address", "city", "country", "language_preference"):
            if field in request.data:
                setattr(student, field, request.data[field] or "")
        if new_email and new_email != student.email.lower():
            student.email = new_email
            if student.user_id:
                student.user.email = new_email
                student.user.save(update_fields=["email"])
        student.save()
        from students.serializers import StudentSerializer

        return Response(StudentSerializer(student).data)


class SchoolStudentResetPasswordView(APIView):
    """POST /api/school/students/reset-password/ — {student_user_id}. School
    admin triggers a password-reset email on the student's behalf (spec
    7.15's "quick replies" support workflow implies this kind of assist)."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        from django.conf import settings
        from django.contrib.auth.tokens import default_token_generator
        from django.db import transaction
        from django.utils.encoding import force_bytes
        from django.utils.http import urlsafe_base64_encode

        from accounts.models import User
        from notifications.tasks import send_transactional_email_task

        school = _caller_school(request)
        user_id = request.data.get("student_user_id")
        student = Student.objects.filter(user_id=user_id).first()
        if student is None or not SchoolStudent.objects.filter(school=school, student=student).exists():
            return Response({"error": "not_found"}, status=status.HTTP_404_NOT_FOUND)

        user = User.objects.filter(pk=user_id).first()
        if user is None:
            return Response({"error": "not_found"}, status=status.HTTP_404_NOT_FOUND)

        uid = urlsafe_base64_encode(force_bytes(user.pk))
        token = default_token_generator.make_token(user)
        reset_url = f"{settings.FRONTEND_URL}/reset-password?uid={uid}&token={token}"
        transaction.on_commit(
            lambda: send_transactional_email_task.delay(
                to_email=user.email, to_name=user.full_name or student.name, key="password_reset",
                context={"user_name": user.full_name or student.name, "reset_url": reset_url},
                locale=student.language_preference,
            )
        )
        return Response({"sent": True})


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
        student_id = request.query_params.get("student_id")
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
            "student": StudentSerializer(student).data,
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


class CreditGrantView(APIView):
    """POST /api/school/credits/grant/ — assign credits manually (cash payment).
    Bumps (or creates) a StudentPackage for the school and logs the grant."""

    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request):
        school = _caller_school(request)
        student_id = request.data.get("student_id")
        try:
            amount = Decimal(str(request.data.get("amount", 0)))  # half credits allowed
        except InvalidOperation:
            return Response({"error": "invalid amount"}, status=status.HTTP_400_BAD_REQUEST)
        if amount <= 0:
            return Response({"error": "amount must be positive"}, status=status.HTTP_400_BAD_REQUEST)

        student = Student.objects.filter(pk=student_id).first()
        if student is None or not SchoolStudent.objects.filter(school=school, student=student).exists():
            return Response({"error": "student_not_found"}, status=status.HTTP_404_NOT_FOUND)

        payment_method = request.data.get("payment_method", "cash")
        pkg = StudentPackage.objects.create(
            student=student, school=school, package_id=request.data.get("package_catalog_id") or None,
            credits_total=amount, credits_remaining=amount,
            expires_at=request.data.get("expires_at") or None,
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


class CreditGrantListView(generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = CreditGrantSerializer

    def get_queryset(self):
        school = _caller_school(self.request)
        return ManualCreditGrant.objects.filter(school=school).order_by("-created_at")


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
        student_id = self.request.query_params.get("student_id")
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
    """PATCH /api/school/documents/{id}/ — school approves/rejects an uploaded document."""

    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        user = request.user
        doc = StudentDocument.objects.filter(pk=pk).first()
        if doc is None:
            return Response({"error": "not_found"}, status=status.HTTP_404_NOT_FOUND)
        if not is_hq(user) and doc.school_id != user.active_school_id:
            raise PermissionDenied("Not your school.")

        new_status = request.data.get("status")
        if new_status:
            doc.status = new_status
        doc.validated_by = user
        doc.validated_at = timezone.now()
        doc.save(update_fields=["status", "validated_by", "validated_at"])
        return Response(SchoolDocumentSerializer(doc).data)
