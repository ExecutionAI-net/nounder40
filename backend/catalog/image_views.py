from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.media_views import ModelImageUploadView
from core.viewsets import is_hq

from .models import Course, LessonType, Package, SubscriptionCatalog


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


class LessonTypeImageUploadView(APIView):
    """POST (multipart 'file') / DELETE /api/hq/lesson-types/<id>/image/?lang=
    — each language gets its own image_url_<lang> field, unlike the generic
    single-field ModelImageUploadView."""

    permission_classes = [IsAuthenticated]
    LANGS = ("it", "en", "fr", "es")

    def _lesson_type(self, request, pk):
        if not is_hq(request.user):
            raise PermissionDenied("HQ only.")
        return LessonType.objects.filter(pk=pk).first()

    def post(self, request, pk):
        from core.storage import save_public

        lt = self._lesson_type(request, pk)
        if lt is None:
            return Response({"error": "not_found"}, status=404)
        lang = request.query_params.get("lang", "en")
        if lang not in self.LANGS:
            return Response({"error": "invalid_lang"}, status=400)
        f = request.FILES.get("file")
        if not f:
            return Response({"error": "file required"}, status=400)
        url = save_public(f, subdir="lesson-types")
        field = f"image_url_{lang}"
        setattr(lt, field, url)
        lt.save(update_fields=[field])
        return Response({"image_url": url})

    def delete(self, request, pk):
        lt = self._lesson_type(request, pk)
        if lt is None:
            return Response({"error": "not_found"}, status=404)
        lang = request.query_params.get("lang", "en")
        if lang not in self.LANGS:
            return Response({"error": "invalid_lang"}, status=400)
        field = f"image_url_{lang}"
        setattr(lt, field, "")
        lt.save(update_fields=[field])
        return Response(status=204)
