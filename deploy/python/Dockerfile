FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=10000 \
    DATABASE_PATH=/var/data/rockshowbot.db

WORKDIR /app
COPY selfhosted/ ./selfhosted/
EXPOSE 10000
CMD ["python", "-m", "selfhosted.rockshowbot"]
