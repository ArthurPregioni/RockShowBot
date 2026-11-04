#!/data/data/com.termux/files/usr/bin/bash
# Native React/Node service; independent of the legacy Python preset.
set -eu
app_root="$(cd "$(dirname "$0")/../.." && pwd)"
service_root="$PREFIX/var/service/rockshowbot-web"
config_root="$HOME/.config/rockshowbot"
state_root="$HOME/.local/state/rockshowbot-web"
if [ -e "$service_root" ] && [ ! -f "$service_root/.rockshowbot-managed" ]; then
  echo 'An unmanaged rockshowbot-web service exists; preserving it.' >&2
  exit 1
fi
umask 077
mkdir -p "$service_root/log" "$config_root" "$state_root/logs" "$HOME/.termux/boot"
node "$app_root/deploy/node/setup.mjs"
if [ ! -f "$service_root/.rockshowbot-managed" ]; then touch "$service_root/down"; fi
printf 'rockshowbot-web-v1\n' > "$service_root/.rockshowbot-managed"
cat > "$service_root/run" <<RUN
#!$PREFIX/bin/sh
export PATH=$PREFIX/bin:\$PATH
export TZ=America/Sao_Paulo
export ROCKSHOWBOT_ENV_FILE=$config_root/node.env
cd '$app_root'
exec $PREFIX/bin/node '$app_root/server.js' 2>&1
RUN
cat > "$service_root/log/run" <<RUN
#!$PREFIX/bin/sh
exec $PREFIX/bin/svlogd -tt '$state_root/logs'
RUN
printf 's1048576\nn5\n' > "$state_root/logs/config"
cat > "$HOME/.termux/boot/50-rockshowbot-web" <<RUN
#!$PREFIX/bin/sh
export PATH=$PREFIX/bin:\$PATH
export SVDIR=$PREFIX/var/service
export LOGDIR=$PREFIX/var/log
[ -f '$service_root/down' ] && exit 0
termux-wake-lock
service-daemon start
sv -w 20 up '$service_root'
RUN
chmod 700 "$service_root/run" "$service_root/log/run" "$HOME/.termux/boot/50-rockshowbot-web"
printf 'Node service installed; configuration preserved.\n'
