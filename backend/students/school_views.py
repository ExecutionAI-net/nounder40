"""School-side student management: list/detail with per-school wallet summary,
manual credit grants (cash payments), and document validation."""

from django.db import transaction
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.viewsets import is_hq
from schools.models import School, SchoolStudent

from .models import ManualCreditGrant, Student, StudentDocument, StudentPackage
from .school_serializers import CreditGrantSerializer, SchoolDocumentSerializer, SchoolStudentListSerializer


def _caller_school(request) -> School:
    user = request.user
    school_id = request.query_params.get("school") if is_hq(user) else user.active_school_id
    if not school_id:
        raise ValidationError("school is required")
    school = School.objects.filter(pk=school_id).first()
    if school is None:
        raise ValidationError("school not found")
    return school


class SchoolStudentListView(APIView):
    """GET /api/school/students/ — enrolled students at the caller's school with
    a wallet + document summary. HQ must pass ?school=."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        school = _caller_school(request)
        today = timezone.now()
        links = SchoolStudent.objects.filter(school=school).select_related("student").order_by("-enrolled_at")

        rows = []
        for link in links:
            student = link.student
            packages = StudentPackage.objects.filter(student=student, school=school)
            rows.append(
                {
                    "id": student.id,
                    "name": student.name,
                    "email": student.email,
                    "phone": student.phone,
                    "credits_remaining": sum(
                        p.credits_remaining for p in packages if p.status == "active"
                    ),
                    "active_packages": packages.filter(status="active").count(),
                    "active_subscriptions": student.subscriptions.filter(school=school, status="active").count(),
                    "documents_expired": StudentDocument.objects.filter(
                        student=student, school=school, status="expired"
                    ).count(),
                    "documents_expiring": StudentDocument.objects.filter(
                        student=student, school=school, status="expiring"
                    ).count(),
                    "enrolled_at": link.enrolled_at,
                }
            )
        return Response(SchoolStudentListSerializer(rows, many=True).data)


class SchoolStudentDetailView(APIView):
    """GET /api/school/students/detail/?student_id= — full profile + wallets +
    documents + booking history for one student at the caller's school."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from bookings.models import Booking
        from students.serializers import StudentPackageSerializer, StudentSerializer, StudentSubscriptionSerializer

        school = _caller_school(request)
        student_id = request.query_params.get("student_id")
        student = Student.objects.filter(pk=student_id).first()
        if student is None or not SchoolStudent.objects.filter(school=school, student=student).exists():
            return Response({"error": "not_found"}, status=status.HTTP_404_NOT_FOUND)

        bookings = (
            Booking.objects.filter(student=student, school=school)
            .select_related("lesson")
            .order_by("-booked_at")[:100]
        )
        return Response(
            {
                "student": StudentSerializer(student).data,
                "packages": StudentPackageSerializer(
                    StudentPackage.objects.filter(student=student, school=school), many=True
                ).data,
                "subscriptions": StudentSubscriptionSerializer(
                    student.subscriptions.filter(school=school), many=True
                ).data,
                "documents": SchoolDocumentSerializer(
                    StudentDocument.objects.filter(student=student, school=school), many=True
                ).data,
                "bookings": [
                    {
                        "id": b.id, "lesson_id": b.lesson_id, "date": b.lesson.date,
                        "status": b.status, "access_source": b.access_source,
                    }
                    for b in bookings
                ],
            }
        )


class CreditGrantView(APIView):
    """POST /api/school/credits/grant/ — assign credits manually (cash payment).
    Bumps (or creates) a StudentPackage for the school and logs the grant."""

    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request):
        school = _caller_school(request)
        student_id = request.data.get("student_id")
        amount = int(request.data.get("amount", 0))
        if amount <= 0:
            return Response({"error": "amount must be positive"}, status=status.HTTP_400_BAD_REQUEST)

        student = Student.objects.filter(pk=student_id).first()
        if student is None:
            return Response({"error": "student_not_found"}, status=status.HTTP_404_NOT_FOUND)

        SchoolStudent.objects.get_or_create(school=school, student=student)

        package_id = request.data.get("package_id")
        pkg = StudentPackage.objects.filter(pk=package_id, student=student, school=school).first() if package_id else None
        if pkg is None:
            pkg = StudentPackage.objects.create(
                student=student, school=school, package_id=request.data.get("catalog_package_id"),
                credits_total=amount, credits_remaining=amount,
                payment_method="cash", status="active",
            )
        else:
            pkg.credits_total += amount
            pkg.credits_remaining += amount
            if pkg.status == "exhausted":
                pkg.status = "active"
            pkg.save(update_fields=["credits_total", "credits_remaining", "status"])

        grant = ManualCreditGrant.objects.create(
            school=school, student=student, package=pkg,
            package_name=request.data.get("package_name", ""),
            granted_by=request.user, amount=amount,
            reason=request.data.get("reason", ""), note=request.data.get("note", ""),
            price=request.data.get("price"), payment_method=request.data.get("payment_method", "cash"),
        )
        return Response(CreditGrantSerializer(grant).data, status=status.HTTP_201_CREATED)


class CreditGrantListView(generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = CreditGrantSerializer

    def get_queryset(self):
        school = _caller_school(self.request)
        return ManualCreditGrant.objects.filter(school=school).order_by("-created_at")


class SchoolDocumentListView(generics.ListAPIView):
    """GET /api/school/documents/ — all student documents for the caller's school."""

    permission_classes = [IsAuthenticated]
    serializer_class = SchoolDocumentSerializer

    def get_queryset(self):
        school = _caller_school(self.request)
        qs = StudentDocument.objects.filter(school=school).select_related("student").order_by("-uploaded_at")
        student_id = self.request.query_params.get("student_id")
        if student_id:
            qs = qs.filter(student_id=student_id)
        return qs


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
