import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('phone_bridge', Path(__file__).parents[2] / 'deploy/termux/bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class BridgeTests(unittest.TestCase):
    def test_canonical_origin_stays_fixed_across_tunnel_rotations(self):
        with tempfile.TemporaryDirectory() as temporary:
            config = Path(temporary) / 'node.env'
            config.write_text('SMTP_PASSWORD=test-only-value\nROCKSHOWBOT_SITE_ORIGIN=http://127.0.0.1:8765\n')
            settings = {'publicOrigin': 'https://rockshowbot.example.workers.dev'}
            self.assertTrue(bridge.configure_origin(config, 'https://one.trycloudflare.com', settings))
            self.assertFalse(bridge.configure_origin(config, 'https://two.trycloudflare.com', settings))
            self.assertIn('SMTP_PASSWORD=test-only-value', config.read_text())
            self.assertIn(settings['publicOrigin'], config.read_text())
            self.assertEqual((config.parent / 'tunnel-url.txt').read_text().strip(), 'https://two.trycloudflare.com')
            self.assertEqual((config.parent / 'public-url.txt').read_text().strip(), settings['publicOrigin'])
            self.assertEqual(config.stat().st_mode & 0o777, 0o600)

    def test_temporary_only_installations_keep_working_and_invalid_settings_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            self.assertIsNone(bridge.bridge_settings(temporary))
            config = Path(temporary) / 'node.env'
            config.write_text('ROCKSHOWBOT_SITE_ORIGIN=http://127.0.0.1:8765\n')
            bridge.configure_origin(config, 'https://one.trycloudflare.com')
            self.assertIn('https://one.trycloudflare.com', config.read_text())
            (Path(temporary) / 'bridge.json').write_text(json.dumps({'publicOrigin': 'https://evil.example', 'updateToken': 'test-' * 10}))
            with self.assertRaises(ValueError):
                bridge.bridge_settings(temporary)

    def test_publisher_uses_authenticated_post_and_requires_confirmation(self):
        class Client:
            def open(inner, request, timeout):
                self.assertEqual(request.method, 'POST')
                self.assertEqual(request.full_url, 'https://rockshowbot.example.workers.dev/_rockshowbot/tunnel')
                self.assertEqual(request.get_header('Authorization'), 'Bearer test-only')
                self.assertEqual(json.loads(request.data)['origin'], 'https://one.trycloudflare.com')
                self.assertEqual(timeout, 30)
                result = io.BytesIO(b'{"updated":true}')
                result.status = 200
                return result
        bridge.publish_origin({'publicOrigin': 'https://rockshowbot.example.workers.dev', 'updateToken': 'test-only'}, 'https://one.trycloudflare.com', Client())
        with self.assertRaises(ValueError):
            bridge.publish_origin({}, 'https://evil.example', Client())


if __name__ == '__main__':
    unittest.main()
