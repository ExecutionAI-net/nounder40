"""Teacher API surface — mounted at /api/teacher/. Scoped to the caller's own
teacher profile."""

from django.urls import path

from bookings.attendance_views import TeacherAttendanceView
from library.views import TeacherLibraryView
from teachers.image_views import TeacherImageUploadView
from teachers.views import (
    TeacherCompensationOverviewView,
    TeacherCompensationView,
    TeacherLessonsView,
    TeacherProfileView,
    TeacherSchoolAssignmentsView,
    TeacherStatsView,
)

urlpatterns = [
    path("profile/", TeacherProfileView.as_view(), name="teacher-profile"),
    path("<uuid:pk>/image/", TeacherImageUploadView.as_view(), name="teacher-image"),
    path("lessons/", TeacherLessonsView.as_view(), name="teacher-lessons"),
    path("calendar/", TeacherLessonsView.as_view(), name="teacher-calendar"),
    path("stats/", TeacherStatsView.as_view(), name="teacher-stats"),
    path("compensation/", TeacherCompensationView.as_view(), name="teacher-compensation"),
    path("compensation-overview/", TeacherCompensationOverviewView.as_view(), name="teacher-compensation-overview"),
    path("library/", TeacherLibraryView.as_view(), name="teacher-library"),
    path("schools/", TeacherSchoolAssignmentsView.as_view(), name="teacher-schools"),
    path("attendance/<uuid:lesson_id>/", TeacherAttendanceView.as_view(), name="teacher-attendance"),
]
