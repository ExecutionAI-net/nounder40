"""Chat API surface — mounted at /api/chat/, matching the frontend's existing
paths. Permissions follow the HQ↔School / School↔Student / Teacher↔HQ(support)
matrix (see chat/views.visible_conversations)."""

from django.urls import path
from rest_framework.routers import DefaultRouter

from chat.views import ConversationViewSet, MessageDetailView, QuickReplyTemplateViewSet, UnreadCountView

router = DefaultRouter()
router.register("conversations", ConversationViewSet, basename="chat-conversations")
router.register("quick-replies", QuickReplyTemplateViewSet, basename="chat-quick-replies")

urlpatterns = router.urls + [
    path("messages/<uuid:pk>/", MessageDetailView.as_view(), name="chat-message-detail"),
    path("unread/", UnreadCountView.as_view(), name="chat-unread"),
]
