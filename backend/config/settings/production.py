from decouple import Csv, config

from .base import *  # noqa: F401,F403

DEBUG = False
ALLOWED_HOSTS = config("DJANGO_ALLOWED_HOSTS", cast=Csv())

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_CONTENT_TYPE_NOSNIFF = True
