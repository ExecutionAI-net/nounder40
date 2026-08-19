from core.media_views import ModelImageUploadView
from core.viewsets import is_hq

from .models import Course, Package, SubscriptionCatalog


class CourseImageUploadView(ModelImageUploadView):
    model = Course
    subdir = "courses"

    def check_object_permission(self, user, obj):
        return is_hq(user) or obj.school_id == getattr(user, "active_school_id", None)


class PackageImageUploadView(ModelImageUploadView):
    model = Package
    subdir = "packages"

    def check_object_permission(self, user, obj):
        return is_hq(user) or obj.school_id == getattr(user, "active_school_id", None)


class SubscriptionImageUploadView(ModelImageUploadView):
    model = SubscriptionCatalog
    subdir = "subscriptions"

    def check_object_permission(self, user, obj):
        return is_hq(user) or obj.school_id == getattr(user, "active_school_id", None)
