FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=10000 \
    DATABASE_PATH=/var/data/rockshowbot.db

WORKDIR /app
COPY rockshowbot.py spotify_integration.py ./
EXPOSE 10000
CMD ["python", "rockshowbot.py"]
