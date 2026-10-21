FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
COPY requirements.lock ./requirements.lock
RUN pip install --upgrade pip && pip install -r requirements.lock

COPY backend ./backend
COPY data ./data
COPY artifacts ./artifacts
COPY .env.example ./.env.example

EXPOSE 10000
CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:${PORT:-10000} --workers 1 --timeout 120 backend.wsgi:app"]
