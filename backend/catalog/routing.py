from django.urls import re_path

from .consumers import SchoolCalendarConsumer, TeacherCalendarConsumer

websocket_urlpatterns = [
    re_path(r"^ws/calendar/school/(?P<school_id>[0-9a-fA-F-]{36})/$", SchoolCalendarConsumer.as_asgi()),
    re_path(r"^ws/calendar/teacher/(?P<teacher_id>[0-9a-fA-F-]{36})/$", TeacherCalendarConsumer.as_asgi()),
]
