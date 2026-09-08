from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.query_token_auth import QueryParamJWTAuthentication
from core.section_guard import hq_has_permission, hq_school_godmode
from core.storage import private_accel_response, save_private
from core.viewsets import SchoolScopedModelViewSet, is_hq

from .realtime import broadcast_inbox_changed, broadcast_inbox_read, broadcast_message

from .models import Conversation, Message, QuickReplyTemplate
from .panel import request_panel_role
from .serializers import ConversationSerializer, MessageSerializer, QuickReplyTemplateSerializer


class QuickReplyTemplateViewSet(SchoolScopedModelViewSet):
    queryset = QuickReplyTemplate.objects.all()
    serializer_class = QuickReplyTemplateSerializer


def _role_context(user):
    """(student, teacher, school_id) for the current user, whichever apply."""
    from students.models import Student
    from teachers.models import Teacher, TeacherSchool

    student = Student.objects.filter(user=user).first()
    teacher = Teacher.objects.filter(user=user).first()
    school_id = user.active_school_id
    if teacher is not None and school_id is None:
        # Same "flat column vs. real relation" gap as hq_sub_role/school_sub_role:
        # a teacher's active_school is never populated by qa_platform.py (and
        # likely other paths), TeacherSchool is the actual link. Only resolve
        # it here when unambiguous -- a teacher at exactly one school -- a
        # teacher at several with none picked still needs to choose, same as
        # every other teacher endpoint that reads active_school_id directly.
        schools = list(
            TeacherSchool.objects.filter(teacher=teacher, active=True).values_list("school_id", flat=True)[:2]
        )
        if len(schools) == 1:
            school_id = schools[0]
    return student, teacher, school_id


def visible_conversations(user, role: str | None = None):
    """Chat permission matrix: HQ↔School, School↔Student, Teacher(support)↔HQ.

    `role` is the panel the caller is acting from (chat/panel.py) -- a
    multi-role account gets exactly ONE branch below, the one for the panel
    it is on, never the union of everything its roles could see. Defaults to
    the account's primary role, so single-role callers are unaffected.

    R2-C2 / X-R2-01: a *teacher* used to get the same broad `school_id ==
    <her school>` filter as a school-role user, so she could list, read,
    reply to, resolve and delete every conversation of her school -- including
    private school<->student threads and HQ<->school threads she has no
    business seeing, not just her own school<->teacher / teacher-support
    threads. Only a "school" role account (owner/admin/staff of the school
    itself) legitimately sees every conversation of its school; a teacher
    (and a student) is scoped to conversations where she is the participant
    (`teacher=self` / `student=self`).

    R2-H2 / X-R2-03: HQ used to be unconditional god-mode here too, so a
    narrow HQ role (e.g. `support`/`tech_support`, permissions only
    `["dashboard", "inbox"]`) could read/post into every school's private
    student/teacher chats. Only an HQ role with real cross-school authority
    (owner/super_admin, or the `schools_create_edit` permission -- see
    core.section_guard.hq_school_godmode) keeps that; a narrower HQ role
    holding the "inbox" permission is scoped to the conversation types HQ's
    own inbox is actually for (HQ<->School, and Teacher<->HQ support
    threads), never school<->student or school<->teacher chats. An HQ role
    without even "inbox" sees nothing.
    """
    role = role or user.role
    if role == "hq" and is_hq(user):
        if hq_school_godmode(user):
            return Conversation.objects.all()
        if hq_has_permission(user, "inbox"):
            return Conversation.objects.filter(
                type__in=[Conversation.Type.HQ_SCHOOL, Conversation.Type.TEACHER_SUPPORT]
            )
        return Conversation.objects.none()

    student, teacher, school_id = _role_context(user)
    if role == "school":
        # School owner/admin/staff: every conversation of their own school
        # (HQ<->School, School<->Student, School<->Teacher) -- this is the
        # one role the broad school_id filter is actually meant for.
        if school_id:
            return Conversation.objects.filter(school_id=school_id)
        return Conversation.objects.none()
    if role == "student" and student is not None:
        return Conversation.objects.filter(student=student)
    if role == "teacher" and teacher is not None:
        return Conversation.objects.filter(teacher=teacher)
    return Conversation.objects.none()


def unread_messages(conversation, user, role: str):
    """Messages `user`, acting as `role`, has not read yet. A message is
    "mine" only if I sent it *from this same panel*: a multi-role account
    that wrote as HQ and now looks as the school genuinely has something to
    read there (and is how one person tests both sides of a thread).
    Internal notes only count for the staff side."""
    qs = conversation.messages.filter(read_at__isnull=True).exclude(sender=user, sender_role=role)
    if role not in ("hq", "school"):
        qs = qs.filter(is_internal=False)
    return qs


class ConversationViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    # Needed so the `attachment` action's GET (a plain <a href>/<img src>,
    # which can't carry an Authorization header) can authenticate via ?token=.
    authentication_classes = [QueryParamJWTAuthentication]
    serializer_class = ConversationSerializer
    filterset_fields = ["type", "status", "priority", "school"]

    def get_queryset(self):
        return visible_conversations(self.request.user, self.panel_role).order_by("-last_message_at", "-created_at")

    @property
    def panel_role(self) -> str:
        return request_panel_role(self.request)

    @property
    def is_staff_side(self) -> bool:
        """HQ and school-role callers see internal notes, mark threads
        answered, and may delete anyone's message."""
        return self.panel_role in ("hq", "school")

    def get_serializer_context(self):
        return {"request": self.request}

    def perform_create(self, serializer):
        user = self.request.user
        role = self.panel_role
        student, teacher, school_id = _role_context(user)
        conv_type = serializer.validated_data.get("type")

        # One branch per panel: the same account acting from the school panel
        # must produce a school-owned thread, not an HQ-owned one. (`school_id`
        # stays: a teacher's school_teacher thread needs her school too.)
        if role != "student":
            student = None
        if role != "teacher":
            teacher = None

        if role == "hq" and is_hq(user):
            serializer.save(hq=user)
        elif student is not None and conv_type == Conversation.Type.SCHOOL_STUDENT:
            school = serializer.validated_data.get("school") or student.school
            if school is None:
                raise ValidationError("school is required")
            serializer.save(student=student, school=school)
        elif teacher is not None and conv_type == Conversation.Type.TEACHER_SUPPORT:
            serializer.save(teacher=teacher)
        elif teacher is not None and conv_type == Conversation.Type.SCHOOL_TEACHER:
            # QA report: this branch was missing entirely, so a teacher-
            # initiated "message my school" fell through to the generic
            # school_id branch below and created a conversation with no
            # `teacher` set -- invisible again in visible_conversations()
            # for the very teacher who started it.
            if not school_id:
                raise ValidationError("no_active_school")
            serializer.save(teacher=teacher, school_id=school_id)
        elif role == "school" and school_id and conv_type in (
            Conversation.Type.HQ_SCHOOL, Conversation.Type.SCHOOL_STUDENT, Conversation.Type.SCHOOL_TEACHER
        ):
            serializer.save(school_id=school_id)
        else:
            raise PermissionDenied("Cannot start this conversation type.")

    @action(detail=True, methods=["get", "post"])
    def messages(self, request, pk=None):
        conversation = self.get_object()
        if request.method == "GET":
            qs = conversation.messages.order_by("created_at")
            if not self.is_staff_side:
                qs = qs.filter(is_internal=False)
            return Response(MessageSerializer(qs, many=True).data)

        role = self.panel_role
        is_internal = bool(request.data.get("is_internal")) and self.is_staff_side
        message = Message.objects.create(
            conversation=conversation,
            sender=request.user,
            sender_role=role,
            content=request.data.get("content") or "",
            is_internal=is_internal,
            attachment_url=request.data.get("attachment_url") or "",
        )
        conversation.last_message_at = timezone.now()
        if conversation.first_response_at is None and self.is_staff_side:
            conversation.first_response_at = timezone.now()
        conversation.save(update_fields=["last_message_at", "first_response_at"])
        serialized = MessageSerializer(message).data
        broadcast_message(message, serialized=serialized)
        broadcast_inbox_changed(conversation, sender_id=request.user.id)
        return Response(serialized, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get", "post"], url_path="attachment")
    def attachment(self, request, pk=None):
        """POST multipart 'file' → stored privately, creates a message carrying
        it. GET ?path=&name=&mime= → streams it back via X-Accel-Redirect.
        get_object() already enforces visible_conversations(), and the path is
        namespaced under this conversation's id so one conversation's link
        can't be used to fetch another's attachment."""
        conversation = self.get_object()

        if request.method == "POST":
            f = request.FILES.get("file")
            if not f:
                return Response({"error": "file required"}, status=status.HTTP_400_BAD_REQUEST)
            info = save_private(f, subdir=f"chat-attachments/{conversation.id}")
            message = Message.objects.create(
                conversation=conversation, sender=request.user,
                sender_role=self.panel_role, content="",
                attachment_url=info["path"],
            )
            conversation.last_message_at = timezone.now()
            conversation.save(update_fields=["last_message_at"])
            serialized = MessageSerializer(message).data
            broadcast_message(message, serialized=serialized)
            broadcast_inbox_changed(conversation, sender_id=request.user.id)
            return Response({**serialized, "attachment_name": info["name"]}, status=status.HTTP_201_CREATED)

        path = request.query_params.get("path", "")
        if not path.startswith(f"chat-attachments/{conversation.id}/"):
            return Response({"error": "invalid path"}, status=status.HTTP_400_BAD_REQUEST)
        # No `?mime=`: the served type comes from the stored bytes
        # (core/downloads.py). Nothing in the frontend ever sent that
        # parameter -- it only ever let a participant ask for their own
        # `<script>`-bearing .txt back as inline text/html on the app origin.
        return private_accel_response(path, filename=request.query_params.get("name", "file"))

    @action(detail=True, methods=["post"])
    def read(self, request, pk=None):
        conversation = self.get_object()
        qs = unread_messages(conversation, request.user, self.panel_role)
        updated = qs.update(read_at=timezone.now())
        if updated:
            broadcast_inbox_read(conversation, user_id=request.user.id)
        return Response({"marked_read": updated})


class MessageDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        message = Message.objects.filter(pk=pk).first()
        if message is None or message.conversation not in visible_conversations(request.user, request_panel_role(request)):
            return Response({"error": "not_found"}, status=status.HTTP_404_NOT_FOUND)
        if "read_at" in request.data:
            message.read_at = timezone.now()
            message.save(update_fields=["read_at"])
            broadcast_inbox_read(message.conversation, user_id=request.user.id)
        return Response(MessageSerializer(message).data)

    def delete(self, request, pk):
        role = request_panel_role(request)
        message = Message.objects.filter(pk=pk).first()
        if message is None or message.conversation not in visible_conversations(request.user, role):
            return Response({"error": "not_found"}, status=status.HTTP_404_NOT_FOUND)
        if not (message.sender_role == role or role in ("hq", "school")):
            raise PermissionDenied()
        message.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class UnreadCountView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        role = request_panel_role(request)
        by_conv = {}
        by_type: dict[str, int] = {}
        total = 0
        for conv in visible_conversations(request.user, role):
            n = unread_messages(conv, request.user, role).count()
            if n:
                by_conv[str(conv.id)] = n
                by_type[conv.type] = by_type.get(conv.type, 0) + n
                total += n
        return Response({"total": total, "by_conversation": by_conv, "by_type": by_type})
