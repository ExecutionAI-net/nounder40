"""Student API surface — mounted at /api/student/. Scoped to the caller's own
student profile."""

from django.urls import path

from bookings.views import StudentBookingsView
from commerce.student_views import StudentShopDetailView, StudentShopListView
from students.views import (
    StudentCreditHistoryView,
    StudentCreditsView,
    StudentDocumentsView,
    StudentLessonsView,
    StudentPackagesView,
    StudentProfileView,
    StudentSchoolPackagesView,
    StudentSchoolView,
    StudentSubscriptionsView,
)

urlpatterns = [
    path("profile/", StudentProfileView.as_view(), name="student-profile"),
    path("school/", StudentSchoolView.as_view(), name="student-school"),
    path("packages/", StudentPackagesView.as_view(), name="student-packages"),
    path("school-packages/", StudentSchoolPackagesView.as_view(), name="student-school-packages"),
    path("subscriptions/", StudentSubscriptionsView.as_view(), name="student-subscriptions"),
    path("credits/", StudentCreditsView.as_view(), name="student-credits"),
    path("credit-history/", StudentCreditHistoryView.as_view(), name="student-credit-history"),
    path("documents/", StudentDocumentsView.as_view(), name="student-documents"),
    path("lessons/", StudentLessonsView.as_view(), name="student-lessons"),
    path("bookings/", StudentBookingsView.as_view(), name="student-bookings"),
    path("shop/", StudentShopListView.as_view(), name="student-shop"),
    path("shop/<uuid:pk>/", StudentShopDetailView.as_view(), name="student-shop-detail"),
]
