"""Reusable public-image-upload view. One model+field+permission = one small
subclass — see catalog/image_views.py for the pattern (Course is the wired-up
reference implementation; the same subclass shape covers packages,
subscriptions, lesson types, shop products, etc. as those panels get built)."""

from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .storage import save_public


class ModelImageUploadView(APIView):
    """POST /.../<id>/image/ — multipart 'file'. Saves to public storage and
    writes the URL onto `field` of `model` instance `pk`."""

    permission_classes = [IsAuthenticated]
    model = None
    field = "image_url"
    subdir = "misc"

    def check_object_permission(self, user, obj) -> bool:
        # Fail closed: every current subclass overrides this with a real
        # ownership check (is_hq(user) or obj.school_id == active_school_id).
        # Defaulting to True here would mean a future subclass that forgets
        # to override it silently allows any authenticated user to edit any
        # object's image — the opposite of what "override per model" implies.
        return False

    def post(self, request, pk):
        obj = self.model.objects.filter(pk=pk).first()
        if obj is None:
            return Response({"error": "not_found"}, status=404)
        if not self.check_object_permission(request.user, obj):
            raise PermissionDenied("Not yours to edit.")
        f = request.FILES.get("file")
        if not f:
            return Response({"error": "file required"}, status=400)
        url = save_public(f, subdir=self.subdir)
        setattr(obj, self.field, url)
        obj.save(update_fields=[self.field])
        return Response({self.field: url})

    def delete(self, request, pk):
        obj = self.model.objects.filter(pk=pk).first()
        if obj is None:
            return Response({"error": "not_found"}, status=404)
        if not self.check_object_permission(request.user, obj):
            raise PermissionDenied("Not yours to edit.")
        setattr(obj, self.field, "")
        obj.save(update_fields=[self.field])
        return Response(status=204)
