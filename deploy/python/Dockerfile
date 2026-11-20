FROM python:3.12.11-slim-bookworm

# The server binds loopback by default; inside a container the published port needs all interfaces.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=10000 \
    DATABASE_PATH=/var/data/rockshowbot.db

RUN useradd --uid 10001 --user-group --no-create-home --shell /usr/sbin/nologin rockshowbot \
    && mkdir -p /var/data && chown rockshowbot:rockshowbot /var/data

WORKDIR /app
COPY selfhosted/ ./selfhosted/
EXPOSE 10000
# Volumes from earlier images and platform disks belong to root: start as root only to hand
# /var/data to the service user, then run the server without privileges. An explicit --user is kept.
ENTRYPOINT ["/bin/sh", "-c", "if [ \"$(id -u)\" = 0 ]; then chown -R rockshowbot:rockshowbot /var/data; exec setpriv --reuid=rockshowbot --regid=rockshowbot --init-groups \"$@\"; fi; exec \"$@\"", "--"]
CMD ["python", "-m", "selfhosted.rockshowbot"]
