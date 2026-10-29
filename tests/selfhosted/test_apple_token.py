import base64
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


@unittest.skipUnless(importlib.util.find_spec("cryptography"), "Optional token-signing dependency not installed")
class AppleTokenTests(unittest.TestCase):
    def test_generated_token_signature_origin_and_permissions(self):
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            key = ec.generate_private_key(ec.SECP256R1())
            key_file, output = directory / "test.p8", directory / "test-token"
            key_file.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
            script = Path(__file__).resolve().parents[2] / "scripts" / "create_apple_token.py"
            command = [sys.executable, str(script), "--team-id", "TESTTEAM12", "--key-id", "TESTKEY123",
                "--private-key", str(key_file), "--origin", "https://shows.example", "--output", str(output)]
            subprocess.run(command, check=True, capture_output=True, text=True)
            header, claims, signature = output.read_text().strip().split(".")
            decode = lambda value: base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
            raw = decode(signature)
            self.assertEqual(len(raw), 64)
            der = encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big"))
            key.public_key().verify(der, (header + "." + claims).encode(), ec.ECDSA(hashes.SHA256()))
            payload = json.loads(decode(claims))
            self.assertEqual(payload["origin"], ["https://shows.example"])
            self.assertEqual(payload["iss"], "TESTTEAM12")
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            # An existing token must not be silently overwritten.
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
