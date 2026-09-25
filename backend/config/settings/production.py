from decouple import Csv, config

from .base import *  # noqa: F401,F403

DEBUG = False
# The public hosts from the environment, plus the compose service name: the
# Next.js server (generateMetadata, Server Components) calls Django inside
# the compose network as http://django:8000 (DJANGO_API_URL), and Django
# answered 400 DisallowedHost to it — the special-event share preview came
# out blank in production while it worked locally, where the hosts are "*".
# "django" resolves only inside the compose network, so nothing is opened.
ALLOWED_HOSTS = config("DJANGO_ALLOWED_HOSTS", cast=Csv()) + ["django"]

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_CONTENT_TYPE_NOSNIFF = True
