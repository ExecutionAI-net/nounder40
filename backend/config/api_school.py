"""School API surface — mounted at /api/school/. All resources are tenant-scoped
to the caller's active school by SchoolScopedModelViewSet."""

from django.urls import path
from rest_framework.routers import DefaultRouter

from bookings.attendance_views import SchoolAttendanceView
from catalog.image_views import CourseImageUploadView, PackageImageUploadView, SubscriptionImageUploadView
from catalog.event_views import SchoolEventDetailView, SchoolEventListView, SchoolEventSubmitView
from commerce.report_views import (
    SchoolReportsDetailedView,
    SchoolReportsPackagesView,
    SchoolReportsBookingsView,
    SchoolReportsStudentClassesView,
    SchoolReportsView,
    SchoolTransactionsView,
)
from catalog.course_views import (
    SchoolClassCreateView,
    SchoolClassDetailView,
    SchoolClassPurgeView,
    SchoolCancelledLessonsPurgeView,
    SchoolClassStudentsView,
    SchoolCourseDetailView,
    SchoolCoursesCreateView,
    SchoolCoursesOverviewView,
    SchoolCoursesReorderView,
    SchoolLessonsFeedView,
    SchoolStudentLessonIdsView,
)
from catalog.views import (
    AttendanceStatusViewSet,
    CourseViewSet,
    LessonTypeViewSet,
    LessonViewSet,
    PackageViewSet,
    SubscriptionCatalogViewSet,
)
from chat.views import QuickReplyTemplateViewSet
from commerce.views import DiscountCodeViewSet
from schools.views import (
    SchoolClosureViewSet,
    SchoolDocumentTypeViewSet,
    SchoolLocationViewSet,
    SchoolMembershipsView,
    SchoolPermissionsView,
    SchoolProfileView,
    SchoolRoomViewSet,
    SchoolTeamResendInviteView,
    SchoolTeamView,
)
from students.credit_movements import CreditDeductionReverseView, CreditDeductView, CreditPackageDeleteView
from students.extensions import PackageExtendView
from students.school_views import (
    CreditGrantListView,
    CreditGrantView,
    SchoolDocumentListView,
    SchoolDocumentValidateView,
    SchoolStudentDeleteView,
    SchoolStudentDetailView,
    SchoolStudentImportView,
    SchoolStudentListView,
    SchoolStudentPackageUsageView,
    SchoolStudentPasswordEmailsView,
    SchoolStudentResetPasswordView,
    SchoolStudentUsageView,
)
from teachers.views import (
    CompensationPlanViewSet,
    SchoolCompensationPaymentsSummaryView,
    SchoolTeacherCompensationView,
    SchoolTeacherDetailView,
    SchoolTeacherListView,
    SchoolTeacherResendInviteView,
    TeacherCompensationPaymentViewSet,
)

router = DefaultRouter()
router.register("courses", CourseViewSet, basename="school-courses")
router.register("lessons", LessonViewSet, basename="school-lessons")
router.register("packages", PackageViewSet, basename="school-packages")
router.register("subscriptions", SubscriptionCatalogViewSet, basename="school-subscriptions")
router.register("attendance-statuses", AttendanceStatusViewSet, basename="school-attendance-statuses")
router.register("locations", SchoolLocationViewSet, basename="school-locations")
router.register("rooms", SchoolRoomViewSet, basename="school-rooms")
router.register("closures", SchoolClosureViewSet, basename="school-closures")
router.register("document-types", SchoolDocumentTypeViewSet, basename="school-document-types")
router.register("discount-codes", DiscountCodeViewSet, basename="school-discount-codes")
router.register("quick-replies", QuickReplyTemplateViewSet, basename="school-quick-replies")
router.register("compensation-plans", CompensationPlanViewSet, basename="school-compensation-plans")
router.register("compensation-payments", TeacherCompensationPaymentViewSet, basename="school-compensation-payments")
router.register("lesson-types", LessonTypeViewSet, basename="school-lesson-types")

urlpatterns = router.urls + [
    path("attendance/<uuid:lesson_id>/", SchoolAttendanceView.as_view(), name="school-attendance"),
    path("teachers/", SchoolTeacherListView.as_view(), name="school-teachers"),
    path("teachers/resend/", SchoolTeacherResendInviteView.as_view(), name="school-teachers-resend"),
    path("teachers/<uuid:teacher_id>/", SchoolTeacherDetailView.as_view(), name="school-teachers-detail"),
    path("students/", SchoolStudentListView.as_view(), name="school-students"),
    path("students/detail/", SchoolStudentDetailView.as_view(), name="school-students-detail"),
    # Own segment (section "students" + reports lookup): see core/section_guard.py
    path("student-usage/", SchoolStudentUsageView.as_view(), name="school-student-usage"),
    path("student-usage/packages/<uuid:pk>/", SchoolStudentPackageUsageView.as_view(), name="school-student-package-usage"),
    path("students/import/", SchoolStudentImportView.as_view(), name="school-students-import"),
    path("students/password-emails/", SchoolStudentPasswordEmailsView.as_view(), name="school-students-password-emails"),
    path("students/delete/", SchoolStudentDeleteView.as_view(), name="school-students-delete"),
    path("students/reset-password/", SchoolStudentResetPasswordView.as_view(), name="school-students-reset-password"),
    path("credits/grant/", CreditGrantView.as_view(), name="school-credits-grant"),
    path("credits/grants/", CreditGrantListView.as_view(), name="school-credits-grants"),
    path("credits/deduct/", CreditDeductView.as_view(), name="school-credits-deduct"),
    path("credits/deductions/<uuid:pk>/reverse/", CreditDeductionReverseView.as_view(), name="school-credits-deduction-reverse"),
    path("credits/packages/<uuid:pk>/", CreditPackageDeleteView.as_view(), name="school-credits-package-delete"),
    path("credits/packages/<uuid:pk>/extend/", PackageExtendView.as_view(), name="school-credits-package-extend"),
    path("documents/", SchoolDocumentListView.as_view(), name="school-documents"),
    path("documents/<uuid:pk>/", SchoolDocumentValidateView.as_view(), name="school-documents-validate"),
    path(
        "teachers/<uuid:teacher_id>/compensation/",
        SchoolTeacherCompensationView.as_view(),
        name="school-teacher-compensation",
    ),
    path("transactions/", SchoolTransactionsView.as_view(), name="school-transactions"),
    path("reports/", SchoolReportsView.as_view(), name="school-reports"),
    path("reports/detailed/", SchoolReportsDetailedView.as_view(), name="school-reports-detailed"),
    path("reports/packages/", SchoolReportsPackagesView.as_view(), name="school-reports-packages"),
    path("reports/bookings/", SchoolReportsBookingsView.as_view(), name="school-reports-bookings"),
    path("reports/student-classes/", SchoolReportsStudentClassesView.as_view(), name="school-reports-student-classes"),
    path("courses/<uuid:pk>/image/", CourseImageUploadView.as_view(), name="school-course-image"),
    # Special events (SPECIAL_EVENTS.md): school-titled workshops approved by HQ
    path("events/", SchoolEventListView.as_view(), name="school-events"),
    path("events/<uuid:pk>/", SchoolEventDetailView.as_view(), name="school-events-detail"),
    path("events/<uuid:pk>/submit/", SchoolEventSubmitView.as_view(), name="school-events-submit"),
    # The event's image: same upload view as a course (an event IS a course),
    # mounted under the "events" section so a role without "courses" can use it
    path("events/<uuid:pk>/image/", CourseImageUploadView.as_view(), name="school-events-image"),
    path("courses/<uuid:pk>/full/", SchoolCourseDetailView.as_view(), name="school-course-detail-full"),
    path("courses-overview/", SchoolCoursesOverviewView.as_view(), name="school-courses-overview"),
    path("courses-create/", SchoolCoursesCreateView.as_view(), name="school-courses-create"),
    path("courses-reorder/", SchoolCoursesReorderView.as_view(), name="school-courses-reorder"),
    path("classes/", SchoolClassCreateView.as_view(), name="school-classes-create"),
    path("classes/<uuid:pk>/", SchoolClassDetailView.as_view(), name="school-classes-detail"),
    path("classes/<uuid:pk>/students/", SchoolClassStudentsView.as_view(), name="school-classes-students"),
    # Second step after cancellation: remove cancelled lessons from every view
    path("classes/<uuid:pk>/purge/", SchoolClassPurgeView.as_view(), name="school-classes-purge"),
    path("classes/purge-cancelled/", SchoolCancelledLessonsPurgeView.as_view(), name="school-classes-purge-cancelled"),
    path("lessons-feed/", SchoolLessonsFeedView.as_view(), name="school-lessons-feed"),
    path("student-lesson-ids/", SchoolStudentLessonIdsView.as_view(), name="school-student-lesson-ids"),
    path("packages/<uuid:pk>/image/", PackageImageUploadView.as_view(), name="school-package-image"),
    path("subscriptions/<uuid:pk>/image/", SubscriptionImageUploadView.as_view(), name="school-subscription-image"),
    path(
        "compensation-summary/", SchoolCompensationPaymentsSummaryView.as_view(),
        name="school-compensation-summary",
    ),
    path("memberships/", SchoolMembershipsView.as_view(), name="school-memberships"),
    path("profile/", SchoolProfileView.as_view(), name="school-profile"),
    path("team/", SchoolTeamView.as_view(), name="school-team"),
    path("permissions/", SchoolPermissionsView.as_view(), name="school-permissions"),
    path("team/resend/", SchoolTeamResendInviteView.as_view(), name="school-team-resend"),
]
