"""Teacher API surface — mounted at /api/teacher/. Scoped to the caller's own
teacher profile."""

from django.urls import path

from bookings.attendance_views import TeacherAttendanceView
from teachers.views import (
    TeacherCompensationView,
    TeacherLessonsView,
    TeacherProfileView,
    TeacherSchoolAssignmentsView,
    TeacherStatsView,
)

urlpatterns = [
    path("profile/", TeacherProfileView.as_view(), name="teacher-profile"),
    path("lessons/", TeacherLessonsView.as_view(), name="teacher-lessons"),
    path("calendar/", TeacherLessonsView.as_view(), name="teacher-calendar"),
    path("stats/", TeacherStatsView.as_view(), name="teacher-stats"),
    path("compensation/", TeacherCompensationView.as_view(), name="teacher-compensation"),
    path("schools/", TeacherSchoolAssignmentsView.as_view(), name="teacher-schools"),
    path("attendance/<uuid:lesson_id>/", TeacherAttendanceView.as_view(), name="teacher-attendance"),
]
