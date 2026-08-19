from django.db.models import Sum
from rest_framework import generics, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

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


class StudentLessonsView(StudentRequiredMixin, APIView):
    """Browse bookable lessons across schools (scheduled, future). Filters:
    ?school= ?lesson_type= ?date= ?city= ."""

    def get(self, request):
        from datetime import date

        from catalog.models import Lesson
        from catalog.serializers import LessonBrowseSerializer

        qs = (
            Lesson.objects.filter(status="scheduled", date__gte=date.today())
            .select_related("school", "teacher", "lesson_type", "room")
            .order_by("date", "start_time")
        )
        p = request.query_params
        if p.get("school"):
            qs = qs.filter(school_id=p["school"])
        if p.get("lesson_type"):
            qs = qs.filter(lesson_type_id=p["lesson_type"])
        if p.get("date"):
            qs = qs.filter(date=p["date"])
        if p.get("city"):
            qs = qs.filter(school__city__iexact=p["city"])
        return Response(LessonBrowseSerializer(qs[:500], many=True).data)
