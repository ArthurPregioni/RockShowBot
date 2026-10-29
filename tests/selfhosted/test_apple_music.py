import base64
import http.client
import io
import json
import os
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch

from selfhosted import apple_music_integration as apple
import rockshowbot as bot


def developer_token(exp=None, origin="https://shows.example"):
    encode = lambda value: base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b"=").decode()
    # This is a fake token for local tests. Apple's service verifies real signatures.
    return ".".join((encode({"alg": "ES256", "kid": "TESTKEY123"}),
        encode({"iss": "TESTTEAM12", "exp": exp or int(time.time()) + 3600, "origin": [origin]}), "fake-signature"))


class AppleMusicTests(unittest.TestCase):
    def setUp(self):
        self.token = developer_token()
        self.environment = patch.dict(os.environ, {"APPLE_MUSIC_DEVELOPER_TOKEN": self.token,
            "APPLE_MUSIC_ORIGIN": "https://shows.example"})
        self.environment.start()

    def tearDown(self):
        self.environment.stop()

    def test_token_expiry_and_origin_are_checked(self):
        self.assertEqual(apple.configuration(), (self.token, "https://shows.example"))
        for token in (developer_token(exp=int(time.time()) - 1), developer_token(origin="https://other.example"), "malformed"):
            with patch.dict(os.environ, {"APPLE_MUSIC_DEVELOPER_TOKEN": token}):
                with self.assertRaises(apple.AppleMusicError):
                    apple.configuration()

    def test_library_pagination_and_deduplication(self):
        responses = [{"data": [{"id": "a", "attributes": {"name": "Angra"}}],
                      "next": "/v1/me/library/artists?offset=25"},
                     {"data": [{"id": "a", "attributes": {"name": "Angra"}},
                               {"id": "s", "attributes": {"name": "Sepultura"}}]}]
        with patch.object(apple, "request_json", side_effect=responses) as remote:
            artists = apple.library_artists("test-user-token")
            self.assertEqual([item["name"] for item in artists], ["Angra", "Sepultura"])
            self.assertEqual(remote.call_count, 2)
            for call in remote.call_args_list:
                request = call.args[0]
                self.assertEqual(request.get_header("Music-user-token"), "test-user-token")
                self.assertEqual(request.get_header("Origin"), "https://shows.example")
                self.assertTrue(request.full_url.startswith("https://api.music.apple.com/v1/me/library/artists?"))

    def test_pagination_cannot_send_tokens_to_other_hosts(self):
        with patch.object(apple, "request_json", return_value={"data": [], "next": "https://untrusted.example/steal"}) as remote:
            with self.assertRaises(apple.AppleMusicError):
                apple.library_artists("test-user-token")
            self.assertEqual(remote.call_count, 1)

    def test_missing_or_expired_session_does_not_call_apple(self):
        sessions = apple.ImportSessions()
        state, secure = sessions.start()
        self.assertTrue(secure)
        sessions.sessions[state]["expires"] = time.time() - 1
        with patch.object(apple, "library_artists") as remote:
            for session in ("other-browser", state):
                with self.assertRaises(apple.AppleMusicError):
                    sessions.fetch(session, "test-user-token")
            remote.assert_not_called()

    def test_http_connection_library_preview_and_selected_import(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(bot, "DB_PATH", directory + "/test.db"), \
                patch.object(bot, "APP_PASSWORD", "test-password-long-enough"), \
                patch.object(apple, "sessions", apple.ImportSessions()):
            bot.init_db()
            server = ThreadingHTTPServer(("127.0.0.1", 0), bot.Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            connection = http.client.HTTPConnection("127.0.0.1", server.server_port)
            origin = f"http://127.0.0.1:{server.server_port}"
            headers = {"Authorization": "Basic " + base64.b64encode(b"admin:test-password-long-enough").decode(),
                       "Origin": origin, "Content-Type": "application/x-www-form-urlencoded"}
            try:
                connection.request("POST", "/apple-music/start", body="", headers=headers)
                response = connection.getresponse()
                self.assertEqual(response.status, 303)
                cookie = response.getheader("Set-Cookie")
                self.assertIn("Secure", cookie)
                self.assertIn("HttpOnly", cookie)
                headers["Cookie"] = cookie.split(";", 1)[0]
                response.read()
                connection.request("GET", "/apple-music/connect", headers=headers)
                response = connection.getresponse()
                self.assertIn("https://js-cdn.music.apple.com", response.getheader("Content-Security-Policy"))
                self.assertIn("Autorizar Apple Music", response.read().decode())
                connection.request("GET", "/apple-music/config", headers=headers)
                response = connection.getresponse()
                self.assertEqual(json.loads(response.read())["developerToken"], self.token)
                library = {"data": [{"id": "a", "attributes": {"name": "Angra"}},
                                    {"id": "s", "attributes": {"name": "Sepultura"}}]}
                with patch.object(apple, "request_json", return_value=library):
                    connection.request("POST", "/apple-music/library", body=json.dumps({"music_user_token": "test-user-token"}),
                        headers={**headers, "Content-Type": "application/json"})
                    response = connection.getresponse()
                    self.assertEqual(response.status, 200)
                    response.read()
                self.assertNotIn("test-user-token", repr(apple.sessions.sessions))
                connection.request("GET", "/apple-music/artists", headers=headers)
                response = connection.getresponse()
                page = response.read().decode()
                self.assertIn("Angra", page)
                self.assertIn("Sepultura", page)
                connection.request("POST", "/apple-music/import", body="artist_id=s&artist_id=forged", headers=headers)
                response = connection.getresponse()
                self.assertEqual(response.status, 303)
                self.assertIn("Max-Age=0", response.getheader("Set-Cookie"))
                response.read()
                with bot.db() as con:
                    self.assertEqual([row[0] for row in con.execute("SELECT name FROM artists")], ["Sepultura"])
                self.assertEqual(apple.sessions.sessions, {})
            finally:
                connection.close()
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
