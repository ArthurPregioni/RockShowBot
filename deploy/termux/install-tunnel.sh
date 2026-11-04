#!/data/data/com.termux/files/usr/bin/bash
# Optional temporary HTTPS address, with no Cloudflare account.
set -eu
command -v cloudflared >/dev/null
app_root="$(cd "$(dirname "$0")/../.." && pwd)"
service="$PREFIX/var/service/rockshowbot-tunnel"
logs="$HOME/.local/state/rockshowbot-tunnel/logs"
if [ -e "$service" ] && [ ! -f "$service/.rockshowbot-managed" ]; then
  echo 'Unmanaged tunnel service preserved.' >&2
  exit 1
fi
umask 077
mkdir -p "$service/log" "$logs"
printf 'rockshowbot-tunnel-v1\n' > "$service/.rockshowbot-managed"
cat > "$service/run" <<RUN
#!$PREFIX/bin/sh
export PATH=$PREFIX/bin:\$PATH
exec $PREFIX/bin/python '$app_root/deploy/termux/tunnel.py' 2>&1
RUN
cat > "$service/log/run" <<RUN
#!$PREFIX/bin/sh
exec $PREFIX/bin/svlogd -tt '$logs'
RUN
printf 's1048576\nn5\n' > "$logs/config"
chmod 700 "$service/run" "$service/log/run"
echo 'Temporary HTTPS service installed. The address changes when the tunnel process restarts.'
