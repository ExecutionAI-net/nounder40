# syntax=docker/dockerfile:1
FROM python:3.13-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# System deps: build tools for psycopg2/Pillow, curl for healthcheck, postgres client for waits.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
        libjpeg-dev \
        zlib1g-dev \
        curl \
        postgresql-client \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /code

COPY requirements.txt /code/
RUN pip install --no-cache-dir -r requirements.txt

COPY . /code/

# Media/static mount points (populated by volumes in compose).
RUN mkdir -p /var/www/static /var/www/media

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f -H "Host: ${HEALTHCHECK_HOST:?HEALTHCHECK_HOST must be set}" http://localhost:8000/api/health/ || exit 1

# Default (production) command; compose overrides for dev with runserver.
# daphne, not gunicorn: this app serves WebSocket traffic (Django Channels,
# config/asgi.py) alongside HTTP, and gunicorn's WSGI workers can't handle
# that protocol at all — only http would work, every /ws/ connection would
# fail. daphne speaks ASGI, so both share the one process/port.
CMD ["daphne", "-b", "0.0.0.0", "-p", "8000", "config.asgi:application"]
