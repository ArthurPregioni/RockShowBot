import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "check-public-repo.py"
spec = importlib.util.spec_from_file_location("check_public_repo", SCRIPT)
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)

# Built at run time so that this file does not contain the markers it tests.
EXPORT = ('{"format": "rockshowbot-web-' + 'sqlite-v1", "tables": {}}').encode()
PASSWORD_HASH = b"APP_PASSWORD_HASH=scrypt:" + b"ab" * 16 + b":" + b"cd" * 64


class FakeCatFile:
    """Stands in for `git cat-file --batch`: answers each requested object from a dict."""

    def __init__(self, blobs):
        self.blobs, self.buffer = blobs, b""
        self.stdin = self.stdout = self

    def write(self, data):
        oid = data.decode().strip()
        self.buffer += f"{oid} blob {len(self.blobs[oid])}\n".encode() + self.blobs[oid] + b"\n"

    def readline(self):
        line, _, self.buffer = self.buffer.partition(b"\n")
        return line + b"\n"

    def read(self, size):
        data, self.buffer = self.buffer[:size], self.buffer[size:]
        return data

    def flush(self):
        pass

    def close(self):
        pass

    def wait(self):
        return 0


class PublicRepoCheckTests(unittest.TestCase):
    def test_device_configuration_and_credentials_are_private_paths(self):
        for name in ("node.env", "deploy/node/server.env", "login.txt", "config/bridge.json", ".env", "data/web.db",
                     ".openai/hosting.json", "hosted/.openai/hosting.json"):
            self.assertTrue(check.private_path(name), name)
        for name in ("selfhosted/.env.example", "deploy/node/.env.example", ".openai/hosting.example.json",
                     "docs/guides/termux.md", "src/features/radar/catalog.json"):
            self.assertFalse(check.private_path(name), name)

    def test_database_exports_and_password_hashes_are_recognised_by_content(self):
        self.assertEqual(check.scan_content("backup.json", EXPORT), ["backup.json:1: database-export"])
        self.assertEqual(check.scan_content("notes.txt", b"first line\n" + PASSWORD_HASH), ["notes.txt:2: password-hash"])

    def test_history_is_checked_for_private_paths_as_well_as_content(self):
        published = sorted(check.PUBLISHED_HISTORY)[0]
        blobs = {"1" * 40: b"SMTP_HOST=smtp.example.test\n", "2" * 40: b"# Readme\n", "3" * 40: EXPORT, published: b"{}"}
        names = {"1" * 40: "node.env", "2" * 40: "README.md", "3" * 40: "notes/old.json", published: ".openai/hosting.json"}
        listing = "".join(f"{oid} {name}\n" for oid, name in names.items()).encode()
        with patch.object(check, "git", return_value=listing), \
                patch.object(check.subprocess, "Popen", return_value=FakeCatFile(blobs)):
            count, findings, already_published = check.scan_history()
        self.assertEqual(count, 4)
        self.assertEqual(findings, ["history 111111111111:node.env: private/runtime file",
                                    "history 333333333333:notes/old.json:1: database-export"])
        # A blob that was pushed before the rule existed is reported apart and does not fail the run.
        self.assertEqual(already_published, [f"history {published[:12]}:.openai/hosting.json: private/runtime file"])


if __name__ == "__main__":
    unittest.main()
