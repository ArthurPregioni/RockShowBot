import base64
import hashlib
import http.client
import os
import tempfile
import threading
import time
import unittest
import urllib.parse
from http.server import ThreadingHTTPServer
from unittest.mock import patch

from selfhosted import rockshowbot as bot
from selfhosted import spotify_integration as spotify


class SpotifyTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"SPOTIFY_CLIENT_ID": "test-client",
            "SPOTIFY_REDIRECT_URI": "https://shows.example/spotify/callback"})
        self.env.start()

    def tearDown(self):
        self.env.stop()

    def test_pkce_browser_binding_expiration_and_replay(self):
        sessions = spotify.ImportSessions()
        state, url, secure = sessions.start()
        params = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
        verifier = sessions.sessions[state]["verifier"]
        expected = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        self.assertTrue(secure)
        self.assertEqual(params["code_challenge"], [expected])
        self.assertEqual(params["scope"], ["user-follow-read"])
        with patch.object(spotify, "request_json") as remote:
            with self.assertRaises(spotify.SpotifyError):
                sessions.finish(state, "other-browser", "authorization-code")
            remote.assert_not_called()
            sessions.sessions[state]["expires"] = time.time() - 1
            with self.assertRaises(spotify.SpotifyError):
                sessions.finish(state, state, "authorization-code")
            remote.assert_not_called()

    def test_followed_artists_paginates_without_following_remote_urls(self):
        responses = [
            {"artists": {"items": [{"id": "a", "name": "Angra"}], "next": "https://untrusted.example/next", "cursors": {"after": "a"}}},
            {"artists": {"items": [{"id": "a", "name": "Angra"}, {"id": "s", "name": "Sepultura"}], "next": None}},
        ]
        with patch.object(spotify, "request_json", side_effect=responses) as remote:
            self.assertEqual([a["name"] for a in spotify.followed_artists("test-token")], ["Angra", "Sepultura"])
            self.assertTrue(all(call.args[0].full_url.startswith("https://api.spotify.com/v1/me/following?") for call in remote.call_args_list))
            self.assertIn("after=a", remote.call_args_list[1].args[0].full_url)

    def test_full_http_authorization_preview_and_selected_import(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(bot, "DB_PATH", directory + "/test.db"), \
                patch.object(bot, "APP_PASSWORD", "test-password-long-enough"), \
                patch.object(spotify, "sessions", spotify.ImportSessions()):
            bot.init_db()
            server = ThreadingHTTPServer(("127.0.0.1", 0), bot.Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            connection = http.client.HTTPConnection("127.0.0.1", server.server_port)
            origin = f"http://127.0.0.1:{server.server_port}"
            headers = {"Authorization": "Basic " + base64.b64encode(b"admin:test-password-long-enough").decode(),
                       "Origin": origin, "Content-Type": "application/x-www-form-urlencoded"}
            try:
                connection.request("POST", "/spotify/connect", body="", headers=headers)
                response = connection.getresponse()
                self.assertEqual(response.status, 303)
                location, cookie = response.getheader("Location"), response.getheader("Set-Cookie")
                response.read()
                self.assertIn("HttpOnly", cookie)
                self.assertIn("Secure", cookie)
                state = urllib.parse.parse_qs(urllib.parse.urlsplit(location).query)["state"][0]
                headers["Cookie"] = cookie.split(";", 1)[0]
                responses = [{"access_token": "test-access", "refresh_token": "test-refresh"},
                    {"artists": {"items": [{"id": "a", "name": "Angra"}, {"id": "s", "name": "Sepultura"}], "next": None}}]
                with patch.object(spotify, "request_json", side_effect=responses) as remote:
                    connection.request("GET", f"/spotify/callback?state={state}&code=test-code", headers=headers)
                    response = connection.getresponse()
                    self.assertEqual(response.status, 303)
                    self.assertEqual(response.getheader("Location"), "/spotify/artists")
                    response.read()
                    token_body = urllib.parse.parse_qs(remote.call_args_list[0].args[0].data.decode())
                    self.assertIn("code_verifier", token_body)
                    self.assertNotIn("test-access", repr(spotify.sessions.sessions))
                    self.assertNotIn("test-refresh", repr(spotify.sessions.sessions))
                connection.request("GET", "/spotify/artists", headers=headers)
                response = connection.getresponse()
                page = response.read().decode()
                self.assertIn("Angra", page)
                self.assertIn("Sepultura", page)
                connection.request("POST", "/spotify/import", body="artist_id=s&artist_id=forged", headers=headers)
                response = connection.getresponse()
                self.assertEqual(response.status, 303)
                self.assertIn("Max-Age=0", response.getheader("Set-Cookie"))
                response.read()
                with bot.db() as con:
                    self.assertEqual([r[0] for r in con.execute("SELECT name FROM artists")], ["Sepultura"])
                self.assertNotIn(state, spotify.sessions.sessions)
                with self.assertRaises(spotify.SpotifyError):
                    spotify.sessions.finish(state, state, "replayed-code")
            finally:
                connection.close()
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)

    def test_invalid_callback_and_denied_consent(self):
        with patch.dict(os.environ, {"SPOTIFY_REDIRECT_URI": "http://localhost:8000/spotify/callback"}):
            with self.assertRaises(spotify.SpotifyError):
                spotify.configuration()
        sessions = spotify.ImportSessions()
        state, _, _ = sessions.start()
        with patch.object(spotify, "request_json") as remote:
            with self.assertRaises(spotify.SpotifyError):
                sessions.finish(state, state, "", "access_denied")
            remote.assert_not_called()


if __name__ == "__main__":
    unittest.main()
