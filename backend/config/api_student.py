"""Student API surface — mounted at /api/student/. Scoped to the caller's own
student profile."""

from django.urls import path

from bookings.views import StudentBookingsView
from students.views import (
    StudentCreditsView,
    StudentDocumentsView,
    StudentLessonsView,
    StudentPackagesView,
    StudentProfileView,
    StudentSubscriptionsView,
)

urlpatterns = [
    path("profile/", StudentProfileView.as_view(), name="student-profile"),
    path("packages/", StudentPackagesView.as_view(), name="student-packages"),
    path("subscriptions/", StudentSubscriptionsView.as_view(), name="student-subscriptions"),
    path("credits/", StudentCreditsView.as_view(), name="student-credits"),
    path("documents/", StudentDocumentsView.as_view(), name="student-documents"),
    path("lessons/", StudentLessonsView.as_view(), name="student-lessons"),
    path("bookings/", StudentBookingsView.as_view(), name="student-bookings"),
]
