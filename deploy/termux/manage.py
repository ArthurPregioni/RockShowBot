#!/usr/bin/env python3
"""Install and operate only RockShowBot's native Termux service. No root required."""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import io
import json
import math
import os
from pathlib import Path
import secrets
import shlex
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timezone
import urllib.error
import urllib.request

class OperationError(ValueError):
    """An operator-safe diagnostic with no private configuration values."""


MARKER = "rockshowbot-termux-v1\n"
FORMAT = "rockshowbot-standalone-v1"
MAX_DATABASE_BYTES = 512 * 1024 * 1024


@dataclass(frozen=True)
class Layout:
    home: Path
    prefix: Path
    repo: Path
    python: Path

    @property
    def config(self):
        return self.home / ".config/rockshowbot/server.env"

    @property
    def data(self):
        return self.home / ".local/share/rockshowbot"

    @property
    def state(self):
        return self.home / ".local/state/rockshowbot"

    @property
    def service(self):
        return self.prefix / "var/service/rockshowbot"

    @property
    def boot(self):
        return self.home / ".termux/boot/50-rockshowbot"

    @property
    def launcher(self):
        return self.prefix / "bin/rockshowbot"

    @property
    def database(self):
        return self.data / "rockshowbot.db"

    @property
    def manager(self):
        return self.repo / "deploy/termux/manage.py"

    @property
    def environment(self):
        return {**os.environ, "PREFIX": str(self.prefix),
                "SVDIR": str(self.prefix / "var/service"),
                "LOGDIR": str(self.prefix / "var/log")}


def private_write(path, content, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Refuse symlinks so installation never overwrites a different app's file.
    if path.is_symlink():
        raise OperationError(f"Arquivo simbólico não permitido: {path}")
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    with os.fdopen(descriptor, "w") as output:
        output.write(content)
    path.chmod(mode)


def read_config(path):
    """Read KEY=value as data, without shell execution or variable expansion."""
    config = {}
    for number, line in enumerate(path.read_text().splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or not key.replace("_", "").isalnum() or not key[0].isalpha():
            raise OperationError(f"Configuração inválida na linha {number}.")
        try:
            words = shlex.split(value, comments=True)
        except ValueError as error:
            raise OperationError(f"Aspas inválidas na linha {number}.") from error
        if len(words) > 1:
            raise OperationError(f"Use aspas em valores com espaços (linha {number}).")
        config[key] = words[0] if words else ""
    return config


def validated_config(layout):
    config = read_config(layout.config)
    password = config.get("APP_PASSWORD", "")
    if len(password) < 16 or password == "change-this-to-a-long-random-password":
        raise OperationError("APP_PASSWORD precisa ter pelo menos 16 caracteres.")
    try:
        port = int(config.get("PORT", "8765"))
        interval = float(config.get("SCAN_INTERVAL_HOURS", "12"))
    except ValueError as error:
        raise OperationError("PORT e SCAN_INTERVAL_HOURS precisam ser números válidos.") from error
    if not 1 <= port <= 65535 or not math.isfinite(interval) or interval <= 0:
        raise OperationError("PORT ou SCAN_INTERVAL_HOURS fora do intervalo permitido.")
    if config.get("HOST", "127.0.0.1") not in {"127.0.0.1", "0.0.0.0"}:
        raise OperationError("Use HOST=127.0.0.1, ou 0.0.0.0 com acesso de rede configurado.")
    if config.get("WAKE_LOCK", "true").lower() not in {"true", "false"}:
        raise OperationError("WAKE_LOCK deve ser true ou false.")
    return config


def install(layout):
    # Check every collision before writing any service or startup file.
    marker = layout.service / ".rockshowbot-managed"
    owned = marker.is_file() and marker.read_text() == MARKER
    if layout.service.is_symlink() or layout.service.exists() and not owned:
        raise OperationError("Já existe um serviço rockshowbot não gerenciado por este instalador.")
    for path in [layout.boot, layout.launcher]:
        if path.exists() and (not owned or "RockShowBot managed" not in path.read_text()):
            raise OperationError(f"Arquivo existente preservado: {path}")
    for directory in [layout.config.parent, layout.data, layout.state,
                      layout.state / "logs", layout.data / "backups"]:
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        directory.chmod(0o700)
    if not layout.config.exists():
        template = (layout.repo / "deploy/termux/.env.example").read_text()
        private_write(layout.config, template.replace("APP_PASSWORD=\n", "APP_PASSWORD=" + secrets.token_urlsafe(32) + "\n", 1))
    elif layout.config.is_symlink():
        raise OperationError("A configuração não pode ser um link simbólico.")
    layout.config.chmod(0o600)
    first_install = not owned
    invoke = f"{shlex.quote(str(layout.python))} {shlex.quote(str(layout.manager))}"
    header = (f"#!{layout.prefix}/bin/sh\n# RockShowBot managed\n"
              f"export PREFIX={shlex.quote(str(layout.prefix))}\n")
    private_write(marker, MARKER)
    if first_install:
        private_write(layout.service / "down", "")
    private_write(layout.service / "run", header + "exec 2>&1\nexec " + invoke + " run\n", 0o700)
    private_write(layout.service / "log/run", header + "exec " + shlex.quote(str(layout.prefix / "bin/svlogd")) + " -tt " + shlex.quote(str(layout.state / "logs")) + "\n", 0o700)
    private_write(layout.state / "logs/config", "s1048576\nn5\n")
    private_write(layout.launcher, header + "exec " + invoke + ' "$@"\n', 0o700)
    # Boot follows only this service's enabled state. It does not edit other boot scripts.
    private_write(layout.boot, header + "[ -f " + shlex.quote(str(layout.service / "down")) + " ] && exit 0\n" +
                  "umask 077\nexec >> " + shlex.quote(str(layout.state / "boot.log")) + " 2>&1\nexec " + invoke + " start\n", 0o700)
    return first_install


def service_command(layout, *arguments, check=True):
    result = subprocess.run([str(layout.prefix / "bin/sv"), *arguments, str(layout.service)],
                            env=layout.environment, capture_output=True, text=True)
    if check and result.returncode:
        raise OperationError("Serviço indisponível. Confira `rockshowbot status` e `rockshowbot logs`.")
    return result


def start(layout):
    config = validated_config(layout)
    if config.get("WAKE_LOCK", "true").lower() == "true":
        wake = layout.prefix / "bin/termux-wake-lock"
        if wake.exists():
            subprocess.run([str(wake)], check=True)
    (layout.service / "down").unlink(missing_ok=True)
    # Starting an already-running shared supervisor can return nonzero. sv up
    # below is the authoritative check; never restart other Termux services.
    subprocess.run([str(layout.prefix / "bin/service-daemon"), "start"],
                   env=layout.environment, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.monotonic() + 15
    while not (layout.service / "supervise/ok").exists():
        if time.monotonic() >= deadline:
            raise OperationError("O supervisor não iniciou. Reabra o Termux e confira termux-services.")
        time.sleep(0.1)
    service_command(layout, "-w", "15", "up")
    url = f"http://127.0.0.1:{config.get('PORT', '8765')}/healthz"
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if json.load(response).get("app") == "RockShowBot":
                    print(f"RockShowBot ativo: {url.removesuffix('/healthz')}")
                    return
        except (OSError, ValueError, urllib.error.URLError):
            time.sleep(0.25)
    raise OperationError("O processo não respondeu ao /healthz. Confira rockshowbot logs.")


def stop(layout):
    # Persist disabled state across a shell restart or reboot.
    private_write(layout.service / "down", "")
    if (layout.service / "supervise/ok").exists():
        service_command(layout, "-w", "15", "down")
    print("RockShowBot desativado. Dados e outros serviços preservados.")


def run(layout):
    config = validated_config(layout)
    os.umask(0o077)
    layout.state.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = (layout.state / "instance.lock").open("a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as error:
        raise OperationError("Já existe uma instância gerenciada em execução.") from error
    os.set_inheritable(lock.fileno(), True)
    environment = {**os.environ, **config, "DATABASE_PATH": str(layout.database),
                   "PYTHONUNBUFFERED": "1", "PYTHONDONTWRITEBYTECODE": "1"}
    os.chdir(layout.repo)
    os.execve(str(layout.python), [str(layout.python), "-u", "-m", "selfhosted.rockshowbot"], environment)


def validate_database(path):
    with sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True) as connection:
        if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise OperationError("Banco SQLite inválido.")
        names = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not {"artists", "regions", "settings", "events"}.issubset(names):
            raise OperationError("O backup precisa ser do servidor Python. D1/Sites exige conversão própria.")


def backup(layout):
    if not layout.database.is_file():
        raise OperationError("O banco ainda não existe; inicie o serviço antes do primeiro backup.")
    directory = layout.data / "backups"
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.TemporaryDirectory(dir=directory) as temporary:
        snapshot = Path(temporary) / "rockshowbot.db"
        with sqlite3.connect(f"{layout.database.as_uri()}?mode=ro", uri=True) as source, sqlite3.connect(snapshot) as target:
            source.backup(target)
        validate_database(snapshot)
        digest = hashlib.sha256(snapshot.read_bytes()).hexdigest()
        manifest = json.dumps({"format": FORMAT, "sha256": digest,
                               "createdAt": datetime.now(timezone.utc).isoformat()}).encode()
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        output = directory / f"rockshowbot-{stamp}-{secrets.token_hex(3)}.tar.gz"
        with output.open("xb") as stream:
            output.chmod(0o600)
            with tarfile.open(fileobj=stream, mode="w:gz") as archive:
                archive.add(snapshot, arcname="rockshowbot.db")
                entry = tarfile.TarInfo("manifest.json")
                entry.size, entry.mode = len(manifest), 0o600
                archive.addfile(entry, io.BytesIO(manifest))
    return output


def restore(layout, archive_path):
    # Stage and validate before stopping anything or changing the existing DB.
    with tempfile.TemporaryDirectory(dir=layout.data) as temporary:
        snapshot = Path(temporary) / "rockshowbot.db"
        with tarfile.open(archive_path, "r:gz") as archive:
            entries = archive.getmembers()
            if len(entries) != 2 or {entry.name for entry in entries} != {"rockshowbot.db", "manifest.json"} or not all(entry.isfile() for entry in entries):
                raise OperationError("Conteúdo de backup inválido.")
            if archive.getmember("manifest.json").size > 4096 or archive.getmember("rockshowbot.db").size > MAX_DATABASE_BYTES:
                raise OperationError("Backup excede o limite permitido.")
            manifest = json.load(archive.extractfile("manifest.json"))
            if not isinstance(manifest, dict) or manifest.get("format") != FORMAT:
                raise OperationError("Formato de backup inválido.")
            digest = hashlib.sha256()
            with archive.extractfile("rockshowbot.db") as source, snapshot.open("wb") as target:
                while chunk := source.read(1024 * 1024):
                    digest.update(chunk)
                    target.write(chunk)
            if manifest.get("sha256") != digest.hexdigest():
                raise OperationError("Integridade do backup inválida.")
        validate_database(snapshot)
        stop(layout)
        with (layout.state / "instance.lock").open("a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise OperationError("Pare também qualquer instância iniciada manualmente antes de restaurar.") from error
            if layout.database.exists():
                print(f"Backup anterior preservado em: {backup(layout)}")
            snapshot.chmod(0o600)
            os.replace(snapshot, layout.database)
    print("Banco restaurado. Serviço permanece parado; inicie com rockshowbot start.")


def doctor(layout):
    print(f"Arquitetura: {os.uname().machine}")
    getprop = Path("/system/bin/getprop")
    if getprop.exists():
        for key in ["ro.product.model", "ro.build.version.release", "ro.build.version.sdk"]:
            value = subprocess.check_output([str(getprop), key], text=True).strip()
            print(f"{key}: {value}")
    config = validated_config(layout)
    print(f"Configuração privada: {layout.config}")
    print(f"Banco: {layout.database}")
    print(f"Painel local: http://127.0.0.1:{config.get('PORT', '8765')}")
    print("SMTP: " + ("configurado" if config.get("SMTP_HOST") else "pendente"))
    providers = [name for name in ["TICKETMASTER_API_KEY", "PREDICTHQ_API_KEY"] if config.get(name)]
    print(f"Fontes API configuradas: {len(providers)}")
    print("Backend: Python independente; migração do painel Sites ainda depende da paridade de recursos.")
    status = service_command(layout, "status", check=False)
    print(status.stdout.strip() or "Supervisor ainda não iniciado.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["install", "start", "stop", "restart", "status", "logs", "doctor", "backup", "restore", "run"])
    parser.add_argument("archive", nargs="?")
    args = parser.parse_args()
    prefix = os.environ.get("PREFIX", "")
    if not prefix or not (Path(prefix) / "bin/pkg").exists():
        parser.error("Execute no Termux nativo, depois de pkg install python termux-services.")
    layout = Layout(Path.home(), Path(prefix).resolve(), Path(__file__).resolve().parents[2], Path(sys.executable).resolve())
    for command in ["sv", "svlogd", "service-daemon"]:
        if not (layout.prefix / "bin" / command).exists():
            parser.error("Instale termux-services e reabra o Termux antes de continuar.")
    os.umask(0o077)
    try:
        if args.command == "install":
            first = install(layout)
            print(f"Configuração: {layout.config}\nDados: {layout.data}")
            print("Instalação preparada, serviço parado. Edite a configuração e use rockshowbot start." if first else "Instalação atualizada; configuração, banco e estado de ativação preservados.")
            return
        marker = layout.service / ".rockshowbot-managed"
        if not marker.is_file() or marker.read_text() != MARKER:
            raise OperationError("Execute primeiro: python deploy/termux/manage.py install")
        if args.command == "run":
            run(layout)
        elif args.command == "start":
            start(layout)
        elif args.command == "stop":
            stop(layout)
        elif args.command == "restart":
            # Validate first so an invalid edit does not stop a healthy process.
            validated_config(layout)
            stop(layout)
            start(layout)
        elif args.command == "status":
            result = service_command(layout, "status", check=False)
            print(result.stdout.strip() or "Supervisor ainda não iniciado.")
            return result.returncode
        elif args.command == "logs":
            log = layout.state / "logs/current"
            print(log.read_text(errors="replace")[-16000:] if log.exists() else "Ainda não há logs.")
        elif args.command == "doctor":
            doctor(layout)
        elif args.command == "backup":
            print(backup(layout))
        elif args.command == "restore":
            if not args.archive:
                raise OperationError("Informe o arquivo: rockshowbot restore /caminho/backup.tar.gz")
            restore(layout, Path(args.archive).expanduser())
    except OperationError as error:
        print(str(error), file=sys.stderr)
        return 1
    except (ValueError, OSError, sqlite3.Error, tarfile.TarError, subprocess.SubprocessError):
        # Avoid exception details: invalid values and transport errors may contain secrets.
        print("Operação não concluída. Confira a configuração, permissões e o estado do serviço; os valores privados não são exibidos.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
