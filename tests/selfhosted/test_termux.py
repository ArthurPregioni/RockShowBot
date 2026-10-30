"""Host-side QA for generated Termux files; never modifies real home/services."""
import base64
import io
import json
import os
from pathlib import Path
import signal
import socket
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

from deploy.termux import manage
from selfhosted import rockshowbot as bot


class TermuxTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        self.root = root
        self.layout = manage.Layout(root / "home", root / "prefix", root / "checkout with spaces", Path(sys.executable))
        self.layout.repo.mkdir()
        template = self.layout.repo / "deploy/termux/.env.example"
        template.parent.mkdir(parents=True)
        template.write_text((Path(__file__).resolve().parents[2] / "deploy/termux/.env.example").read_text())
        self.layout.prefix.joinpath("bin").mkdir(parents=True)

    def tearDown(self):
        self.temporary.cleanup()

    def create_database(self):
        with patch.object(bot, "DB_PATH", str(self.layout.database)):
            bot.init_db()
        with sqlite3.connect(self.layout.database) as connection:
            connection.execute("INSERT INTO artists(name) VALUES('QA Artist')")
            connection.execute("INSERT INTO settings(key,value) VALUES('email','fan@example.test')")
            connection.execute("INSERT INTO events(id,artist,title,source,email_sent) VALUES('qa','QA Artist','Show','QA',1)")

    def test_install_is_private_disabled_idempotent_and_preserves_other_apps(self):
        other = self.layout.prefix / "var/service/another-app/run"
        other.parent.mkdir(parents=True)
        other.write_text("other service")
        self.assertTrue(manage.install(self.layout))
        config = manage.validated_config(self.layout)
        self.assertGreaterEqual(len(config["APP_PASSWORD"]), 32)
        self.assertEqual(config["HOST"], "127.0.0.1")
        self.assertEqual(config["PORT"], "8765")
        self.assertTrue((self.layout.service / "down").exists())
        self.assertEqual(self.layout.config.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.layout.data.stat().st_mode & 0o777, 0o700)
        content = self.layout.config.read_bytes()
        (self.layout.service / "down").unlink()
        self.assertFalse(manage.install(self.layout))
        self.assertEqual(self.layout.config.read_bytes(), content)
        self.assertFalse((self.layout.service / "down").exists())
        self.assertEqual(other.read_text(), "other service")
        for script in [self.layout.service / "run", self.layout.service / "log/run", self.layout.boot, self.layout.launcher]:
            subprocess.run(["bash", "-n", str(script)], check=True)
        self.assertIn("checkout with spaces", (self.layout.service / "run").read_text())

    def test_installer_refuses_existing_foreign_service_before_writing_config(self):
        self.layout.service.mkdir(parents=True)
        foreign = self.layout.service / "run"
        foreign.write_text("foreign")
        with self.assertRaises(manage.OperationError):
            manage.install(self.layout)
        self.assertEqual(foreign.read_text(), "foreign")
        self.assertFalse(self.layout.config.exists())

    def test_start_waits_for_supervisor_without_restarting_other_services(self):
        manage.install(self.layout)

        def supervisor_ready(_delay):
            (self.layout.service / "supervise").mkdir(exist_ok=True)
            (self.layout.service / "supervise/ok").touch()

        def service_ready(*_args, **_kwargs):
            self.assertTrue((self.layout.service / "supervise/ok").exists())

        with patch.object(manage.subprocess, "run") as command, \
             patch.object(manage.time, "sleep", side_effect=supervisor_ready), \
             patch.object(manage, "service_command", side_effect=service_ready) as service, \
             patch.object(manage.urllib.request, "urlopen", return_value=io.BytesIO(b'{"app":"RockShowBot"}')):
            manage.start(self.layout)
        self.assertEqual(command.call_args.args[0], [str(self.layout.prefix / "bin/service-daemon"), "start"])
        service.assert_called_once_with(self.layout, "-w", "15", "up")

    def test_start_has_a_bounded_wait_for_missing_supervisor(self):
        manage.install(self.layout)
        with patch.object(manage.subprocess, "run"), \
             patch.object(manage.time, "monotonic", side_effect=[0, 16]):
            with self.assertRaisesRegex(manage.OperationError, "supervisor"):
                manage.start(self.layout)

    def test_config_is_data_and_never_executes_shell_expressions(self):
        manage.install(self.layout)
        marker = self.root / "must-not-exist"
        with self.layout.config.open("a") as output:
            output.write(f'SMTP_PASSWORD="$(touch {marker}) # literal"\n')
        config = manage.read_config(self.layout.config)
        self.assertIn("$(touch", config["SMTP_PASSWORD"])
        self.assertIn("# literal", config["SMTP_PASSWORD"])
        self.assertFalse(marker.exists())
        for value in ["nan", "inf", "0", "-1"]:
            self.layout.config.write_text(f"APP_PASSWORD=long-enough-test-password\nSCAN_INTERVAL_HOURS={value}\n")
            with self.assertRaises(manage.OperationError):
                manage.validated_config(self.layout)

    def test_sqlite_backup_restore_preserves_sent_state_and_excludes_credentials(self):
        manage.install(self.layout)
        self.create_database()
        archive = manage.backup(self.layout)
        with tarfile.open(archive) as content:
            self.assertEqual(set(content.getnames()), {"rockshowbot.db", "manifest.json"})
        self.assertEqual(archive.stat().st_mode & 0o777, 0o600)
        with sqlite3.connect(self.layout.database) as connection:
            connection.execute("DELETE FROM artists")
        manage.restore(self.layout, archive)
        with sqlite3.connect(self.layout.database) as connection:
            self.assertEqual(connection.execute("SELECT name FROM artists").fetchone()[0], "QA Artist")
            self.assertEqual(connection.execute("SELECT email_sent FROM events").fetchone()[0], 1)
        self.assertTrue((self.layout.service / "down").exists())
        self.assertEqual(len(list((self.layout.data / "backups").glob("*.tar.gz"))), 2)

    def test_corrupt_and_traversal_archives_leave_original_database_untouched(self):
        manage.install(self.layout)
        self.create_database()
        before = self.layout.database.read_bytes()
        bad = self.root / "bad.tar.gz"
        for name in ["../escape", "rockshowbot.db"]:
            with tarfile.open(bad, "w:gz") as archive:
                for member, content in [(name, b"invalid database"), ("manifest.json", b'{}')]:
                    entry = tarfile.TarInfo(member)
                    entry.size = len(content)
                    archive.addfile(entry, io.BytesIO(content))
            with self.assertRaises(manage.OperationError):
                manage.restore(self.layout, bad)
            self.assertEqual(self.layout.database.read_bytes(), before)
        self.assertFalse((self.root / "escape").exists())

    def test_d1_database_is_not_silently_treated_as_python_database(self):
        database = self.root / "sites.db"
        with sqlite3.connect(database) as connection:
            connection.execute("CREATE TABLE watch_artists(id TEXT)")
        with self.assertRaisesRegex(manage.OperationError, "D1/Sites"):
            manage.validate_database(database)

    def test_termux_cli_refuses_regular_linux_host(self):
        result = subprocess.run([sys.executable, "deploy/termux/manage.py", "install"],
            cwd=Path(__file__).resolve().parents[2], env={**os.environ, "PREFIX": str(self.root / "not-termux")},
            capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Termux nativo", result.stderr)

    def test_native_backend_loopback_authentication_and_clean_sigterm(self):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        environment = {**os.environ, "HOST": "127.0.0.1", "PORT": str(port),
            "APP_USER": "admin", "APP_PASSWORD": "local-qa-only-password-long", "DATABASE_PATH": str(self.root / "qa.db"),
            "TICKETMASTER_API_KEY": "", "PREDICTHQ_API_KEY": "", "SMTP_HOST": ""}
        process = subprocess.Popen([sys.executable, "-m", "selfhosted.rockshowbot"],
            cwd=Path(__file__).resolve().parents[2], env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        try:
            for _ in range(80):
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=0.2) as response:
                        self.assertEqual(json.load(response)["app"], "RockShowBot")
                    break
                except (OSError, urllib.error.URLError):
                    if process.poll() is not None:
                        self.fail("The local server exited before /healthz")
                    time.sleep(0.05)
            else:
                self.fail("The local server did not start")
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/")
            self.assertEqual(error.exception.code, 401)
            error.exception.close()
            authorization = base64.b64encode(b"admin:local-qa-only-password-long").decode()
            with urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{port}/", headers={"Authorization": "Basic " + authorization})) as response:
                self.assertEqual(response.status, 200)
            process.send_signal(signal.SIGTERM)
            self.assertEqual(process.wait(timeout=5), 0)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
            process.stderr.close()
