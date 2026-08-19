from core.media_views import ModelImageUploadView
from core.viewsets import is_hq

from .models import Teacher


class TeacherImageUploadView(ModelImageUploadView):
    model = Teacher
    field = "photo_url"
    subdir = "teacher-photos"

    def check_object_permission(self, user, obj):
        return is_hq(user) or obj.user_id == user.id
