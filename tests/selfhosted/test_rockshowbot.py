import base64
import io
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from datetime import date, timedelta
from http.server import ThreadingHTTPServer
from unittest.mock import patch

from selfhosted import rockshowbot as bot


class FakeSource:
    name = "Fonte falsa de teste"

    def find(self, artist, countries):
        return [{"id": "fake:1", "artist": artist, "title": "Show de teste",
                 "venue": "Casa de teste", "city": "São Paulo", "region": "BR",
                 "starts_at": "2030-01-01", "url": "https://example.com/show",
                 "source": self.name}]


class RockShowBotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_path = bot.DB_PATH
        bot.DB_PATH = self.temp.name + "/test.db"
        bot.init_db()
        with bot.db() as con:
            con.execute("INSERT INTO artists(name) VALUES('Sepultura')")
        bot.set_setting("email", "fan@example.com")

    def tearDown(self):
        bot.DB_PATH = self.old_path
        self.temp.cleanup()

    def test_csv_accepts_headers_and_simple_lists(self):
        self.assertEqual(bot.parse_artist_csv("artist,notes\nSepultura,metal\nAngra,power\n"),
                         ["Sepultura", "Angra"])
        self.assertEqual(bot.parse_artist_csv("Sepultura\nAngra\n"), ["Sepultura", "Angra"])

    def test_ticketmaster_match_rejects_keyword_homonyms(self):
        self.assertTrue(bot.ticketmaster_matches("Sepultura", {"name": "Sepultura", "_embedded": {"attractions": [{"name": "Sepultura"}]}}))
        self.assertFalse(bot.ticketmaster_matches("Sepultura", {"name": "Sepultura tribute", "_embedded": {"attractions": [{"name": "Sepultura Experience"}]}}))

    @patch.object(bot, "TM_KEY", "ticketmaster-test-key")
    @patch.object(bot.urllib.request, "urlopen")
    def test_ticketmaster_adapter_maps_only_matching_attractions(self, urlopen):
        payload = {"_embedded": {"events": [{"id": "event-1", "name": "Sepultura Live",
            "url": "https://tickets.example/event-1", "dates": {"start": {"localDate": "2030-01-01"}},
            "_embedded": {"attractions": [{"name": "Sepultura"}],
                          "venues": [{"name": "Arena", "city": {"name": "São Paulo"}}]}}]}}
        urlopen.return_value = io.BytesIO(json.dumps(payload).encode())
        events = bot.TicketmasterSource().find("Sepultura", ["BR"])
        self.assertEqual(len(events), 1)
        self.assertEqual((events[0]["id"], events[0]["city"], events[0]["status"]),
                         ("tm:event-1", "São Paulo", "listed"))

    @patch.object(bot, "PHQ_KEY", "predicthq-test-key")
    @patch.object(bot.urllib.request, "urlopen")
    def test_predicthq_adapter_maps_matching_events(self, urlopen):
        payload = {"results": [{"id": "event-2", "title": "Sepultura at a festival",
            "start": "2030-05-10", "entities": [{"name": "Sepultura"}], "location": [],
            "place": {"name": "Buenos Aires"}}]}
        urlopen.return_value = io.BytesIO(json.dumps(payload).encode())
        events = bot.PredictHQSource().find("Sepultura", ["AR"])
        self.assertEqual(len(events), 1)
        self.assertEqual((events[0]["id"], events[0]["city"], events[0]["region"]),
                         ("phq:event-2", "Buenos Aires", "AR"))

    @patch.object(bot, "send_email", return_value=True)
    def test_scan_deduplicates_and_emails_only_new_events(self, send_email):
        self.assertEqual(bot.scan([FakeSource()]), 1)
        self.assertEqual(bot.scan([FakeSource()]), 0)
        self.assertEqual(send_email.call_count, 1)
        with bot.db() as con:
            self.assertEqual(con.execute("SELECT count(*) FROM events").fetchone()[0], 1)
            self.assertEqual(con.execute("SELECT email_sent FROM events").fetchone()[0], 1)

    @patch.object(bot, "send_email", side_effect=[False, True])
    def test_unsent_email_stays_queued_and_retries(self, send_email):
        bot.scan([FakeSource()])
        bot.notify_pending()
        self.assertEqual(send_email.call_count, 2)
        with bot.db() as con:
            self.assertEqual(con.execute("SELECT email_sent FROM events").fetchone()[0], 1)

    @patch.object(bot, "send_email", return_value=True)
    def test_community_tip_is_explicitly_unverified_and_deduplicated(self, _send_email):
        kwargs = ("Sepultura", "Possível show", "2030-03-04", "São Paulo", "BR", "https://example.com/rumor")
        self.assertTrue(bot.add_tip(*kwargs))
        self.assertFalse(bot.add_tip(*kwargs))
        with bot.db() as con:
            event = con.execute("SELECT status,source FROM events").fetchone()
        self.assertEqual(tuple(event), ("unverified", "Dica da comunidade"))

    def test_community_tip_rejects_non_web_links(self):
        with self.assertRaises(ValueError):
            bot.add_tip("Sepultura", "Possível show", "", "", "BR", "javascript:alert(1)")

    @patch.object(bot, "send_email", return_value=True)
    def test_retention_removes_old_provider_events_but_keeps_user_tips(self, _send_email):
        old_date = (date.today() - timedelta(days=60)).isoformat()
        with bot.db() as con:
            con.execute("""INSERT INTO events(id,artist,title,starts_at,source,status,email_sent)
                VALUES('tm:old','Sepultura','Old show',?,'Ticketmaster','listed',1)""", (old_date,))
        bot.add_tip("Sepultura", "Old rumor", old_date, "São Paulo", "BR", "https://example.com/old")
        bot.prune_expired_events()
        with bot.db() as con:
            ids = {row[0] for row in con.execute("SELECT id FROM events")}
        self.assertNotIn("tm:old", ids)
        self.assertTrue(any(item.startswith("tip:") for item in ids))

    def test_health_is_public_but_dashboard_requires_password(self):
        old_password, old_user = bot.APP_PASSWORD, bot.APP_USER
        bot.APP_PASSWORD, bot.APP_USER = "test-secret", "admin"
        server = ThreadingHTTPServer(("127.0.0.1", 0), bot.Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            with urllib.request.urlopen(base + "/healthz") as response:
                self.assertEqual(response.status, 200)
            with urllib.request.urlopen(base + "/privacy") as response:
                self.assertIn("Privacidade", response.read().decode())
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(base + "/")
            self.assertEqual(error.exception.code, 401)
            error.exception.close()
            request = urllib.request.Request(base + "/", headers={
                "Authorization": "Basic " + base64.b64encode(b"admin:test-secret").decode()})
            with urllib.request.urlopen(request) as response:
                self.assertEqual(response.status, 200)
                self.assertIn("Ticketmaster", response.read().decode())
            boundary = "rockshowbot-test-boundary"
            body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"bands.csv\"\r\n"
                    "Content-Type: text/csv; charset=utf-8\r\n\r\nartist\nSepultura\nAngra\n"
                    f"--{boundary}--\r\n").encode()
            upload = urllib.request.Request(base + "/artists/import", data=body, headers={
                "Authorization": "Basic " + base64.b64encode(b"admin:test-secret").decode(),
                "Origin": base, "Content-Type": "multipart/form-data; boundary=" + boundary})
            with urllib.request.urlopen(upload) as response:
                imported_page = response.read().decode()
                self.assertEqual(response.status, 200)
                self.assertIn("Angra", imported_page)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
            bot.APP_PASSWORD, bot.APP_USER = old_password, old_user


if __name__ == "__main__":
    unittest.main()
