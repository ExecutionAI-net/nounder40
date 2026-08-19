from core.viewsets import SchoolScopedModelViewSet

from .models import QuickReplyTemplate
from .serializers import QuickReplyTemplateSerializer


class QuickReplyTemplateViewSet(SchoolScopedModelViewSet):
    queryset = QuickReplyTemplate.objects.all()
    serializer_class = QuickReplyTemplateSerializer
