from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from . import views

app_name = "accounts"

urlpatterns = [
    path("register/", views.RegisterView.as_view(), name="register"),
    path("login/", views.LoginView.as_view(), name="login"),
    path("refresh/", TokenRefreshView.as_view(), name="refresh"),
    path("logout/", views.logout_view, name="logout"),
    path("me/", views.me_view, name="me"),
    path("change-password/", views.change_password_view, name="change-password"),
    path("my-role/", views.my_role_view, name="my-role"),
    path("google/", views.GoogleLoginView.as_view(), name="google-login"),
    path("password-reset/", views.password_reset_request_view, name="password-reset"),
    path("password-reset-confirm/", views.password_reset_confirm_view, name="password-reset-confirm"),
    path("complete-invite/", views.complete_invite_view, name="complete-invite"),
]
