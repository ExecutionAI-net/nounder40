"""Private document storage: upload + permission-checked serving via nginx
X-Accel-Redirect (core/storage.py)."""

from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.query_token_auth import QueryParamJWTAuthentication
from core.storage import private_accel_response, save_private
from core.viewsets import is_hq

from .models import Student, StudentDocument


class DocumentUploadView(APIView):
    """POST /api/documents/upload/ — multipart 'file'. Returns
    {path, name, mime, size} to attach to a StudentDocument.files entry."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        f = request.FILES.get("file")
        if not f:
            return Response({"error": "file required"}, status=400)
        info = save_private(f, subdir="documents")
        return Response(info, status=201)


class DocumentDetailView(APIView):
    """GET/DELETE /api/documents/{id}/ — metadata / removal, permission-checked."""

    permission_classes = [IsAuthenticated]

    def _authorize(self, request, doc):
        user = request.user
        student = Student.objects.filter(user=user).first()
        if is_hq(user):
            return
        if doc.school_id == getattr(user, "active_school_id", None):
            return
        if student is not None and doc.student_id == student.id:
            return
        raise PermissionDenied("Not your document.")

    def get(self, request, pk):
        from .school_serializers import SchoolDocumentSerializer

        doc = StudentDocument.objects.filter(pk=pk).first()
        if doc is None:
            return Response({"error": "not_found"}, status=404)
        self._authorize(request, doc)
        return Response(SchoolDocumentSerializer(doc).data)

    def delete(self, request, pk):
        doc = StudentDocument.objects.filter(pk=pk).first()
        if doc is None:
            return Response({"error": "not_found"}, status=404)
        self._authorize(request, doc)
        doc.delete()
        return Response(status=204)


class DocumentFileView(APIView):
    """GET /api/documents/{id}/file/?path=<key> — streams one attachment from
    a document's `files` list via X-Accel-Redirect, after verifying both (a)
    the requester may see this document AND (b) the requested path is actually
    one of this document's own attachments (no cross-document path guessing)."""

    permission_classes = [IsAuthenticated]
    authentication_classes = [QueryParamJWTAuthentication]

    def get(self, request, pk):
        user = request.user
        doc = StudentDocument.objects.filter(pk=pk).first()
        if doc is None:
            return Response({"error": "not_found"}, status=404)

        student = Student.objects.filter(user=user).first()
        allowed = (
            is_hq(user)
            or doc.school_id == getattr(user, "active_school_id", None)
            or (student is not None and doc.student_id == student.id)
        )
        if not allowed:
            raise PermissionDenied("Not your document.")

        path = request.query_params.get("path")
        entry = next((f for f in (doc.files or []) if f.get("path") == path), None)
        if entry is None:
            return Response({"error": "file not found on this document"}, status=404)

        return private_accel_response(
            path, filename=entry.get("name", "file"), content_type=entry.get("mime", "application/octet-stream")
        )
