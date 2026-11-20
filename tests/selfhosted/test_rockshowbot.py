import base64
import io
import json
import os
import socket
import ssl
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from selfhosted import apple_music_integration as apple
from selfhosted import rockshowbot as bot
from selfhosted import spotify_integration as spotify

try:
    from zoneinfo import ZoneInfo
    ZoneInfo("America/Sao_Paulo")
    HAS_TIME_ZONES = True
except Exception:  # Windows without the tzdata package
    HAS_TIME_ZONES = False


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
    @patch.object(bot, "safe_urlopen")
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
    @patch.object(bot, "safe_urlopen")
    def test_predicthq_adapter_maps_matching_events(self, urlopen):
        payload = {"results": [{"id": "event-2", "title": "Sepultura at a festival",
            "start": "2030-05-10", "entities": [{"name": "Sepultura"}], "location": [],
            "place": {"name": "Buenos Aires"}}]}
        urlopen.return_value = io.BytesIO(json.dumps(payload).encode())
        events = bot.PredictHQSource().find("Sepultura", ["AR"])
        self.assertEqual(len(events), 1)
        self.assertEqual((events[0]["id"], events[0]["city"], events[0]["region"]),
                         ("phq:event-2", "Buenos Aires", "AR"))

    def test_titles_must_bill_the_artist_itself(self):
        for artist, title in (("Queen", "Queen Experience In Concert"), ("Pink Floyd", "Pink Floyd Tribute Night"),
                              ("Angra", "Angra dos Reis Jazz Festival"), ("Rush", "Rush Hour Party"),
                              ("Kiss", "Kiss FM Festival"), ("Rush", "Big Time Rush - Worldwide Tour"),
                              ("Angra", "Angrada Folk Festival"), ("Queen", "Tributo ao Queen")):
            self.assertFalse(bot.names_artist(title, artist), title)
            self.assertFalse(bot.ticketmaster_matches(artist, {"name": title}), title)
        for title in ("Sepultura", "Sepultura - Tour Name", "Sepultura | São Paulo", "Sepultura: live",
                      "Sepultura ao vivo", "SEPULTURA!", "Angra + Sepultura", "Sepultura em Curitiba"):
            self.assertTrue(bot.names_artist(title, "Sepultura"), title)
            self.assertTrue(bot.ticketmaster_matches("Sepultura", {"name": title}), title)
        self.assertTrue(bot.names_artist("Big Time Rush - Worldwide Tour", "Big Time Rush"))

    @patch.object(bot, "PHQ_KEY", "predicthq-test-key")
    @patch.object(bot, "safe_urlopen")
    def test_predicthq_titles_do_not_match_inside_other_names(self, urlopen):
        payload = {"results": [
            {"id": "longer", "title": "Big Time Rush - Worldwide Tour", "start": "2030-05-10", "entities": [{"name": "Big Time Rush"}]},
            {"id": "party", "title": "Rush Hour Party", "start": "2030-05-11", "entities": []},
            {"id": "real", "title": "Rush - R50 Tour", "start": "2030-05-12", "entities": []}]}
        urlopen.return_value = io.BytesIO(json.dumps(payload).encode())
        self.assertEqual([event["id"] for event in bot.PredictHQSource().find("Rush", ["BR"])], ["phq:real"])

    @patch.object(bot, "TM_KEY", "ticketmaster-test-key")
    @patch.object(bot, "PHQ_KEY", "predicthq-test-key")
    @patch.object(bot, "safe_urlopen")
    def test_cancelled_events_are_skipped_and_the_local_day_is_kept(self, urlopen):
        billed = {"_embedded": {"attractions": [{"name": "Sepultura"}]}}
        events = [
            {"id": "night", "name": "Sepultura", "url": "https://tickets.example/night", **billed, "dates": {"start": {
                "localDate": "2030-01-05", "localTime": "21:30:00", "dateTime": "2030-01-06T00:30:00Z"}}},
            {"id": "cancelled", "name": "Sepultura", **billed,
             "dates": {"start": {"localDate": "2030-02-01"}, "status": {"code": "cancelled"}}},
            {"id": "postponed", "name": "Sepultura", **billed,
             "dates": {"start": {"localDate": "2030-03-01"}, "status": {"code": "postponed"}}}]
        urlopen.return_value = io.BytesIO(json.dumps({"_embedded": {"events": events}}).encode())
        found = bot.TicketmasterSource().find("Sepultura", ["BR"])
        self.assertEqual([(event["id"], event["starts_at"]) for event in found], [("tm:night", "2030-01-05T21:30:00")])
        results = [
            {"id": "night", "title": "Sepultura", "state": "active",
             "start": "2030-05-11T00:30:00Z", "start_local": "2030-05-10T21:30:00"},
            {"id": "deleted", "title": "Sepultura", "state": "deleted", "start": "2030-06-01T03:00:00Z"}]
        urlopen.return_value = io.BytesIO(json.dumps({"results": results}).encode())
        found = bot.PredictHQSource().find("Sepultura", ["BR"])
        self.assertEqual([(event["id"], event["starts_at"]) for event in found], [("phq:night", "2030-05-10T21:30:00")])
        # Without local fields the provider's own value is kept rather than guessed.
        self.assertEqual(bot.predicthq_start({"start": "2030-05-11T00:30:00Z"}), "2030-05-11T00:30:00Z")
        self.assertEqual(bot.predicthq_start({"start": "2030-05-11", "timezone": "America/Sao_Paulo"}), "2030-05-11")

    @unittest.skipUnless(HAS_TIME_ZONES, "No time zone database on this system")
    def test_predicthq_utc_start_becomes_the_venue_day(self):
        event = {"start": "2030-05-11T00:30:00Z", "timezone": "America/Sao_Paulo"}
        self.assertEqual(bot.predicthq_start(event), "2030-05-10T21:30:00")

    def test_api_credentials_never_follow_a_redirect_to_another_host(self):
        received = []

        class Elsewhere(BaseHTTPRequestHandler):
            def do_GET(self):
                received.append(self.headers.get("Authorization"))
                self.send_response(200)
                self.send_header("Content-Length", "2")
                self.end_headers()
                self.wfile.write(b"{}")

            def log_message(self, *args):
                pass

        elsewhere = ThreadingHTTPServer(("127.0.0.1", 0), Elsewhere)

        class Provider(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/landed":
                    body = b'{"ok": true}'
                    self.send_response(200)
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                same_host = self.path == "/same-host"
                self.send_response(302)
                self.send_header("Location", "/landed" if same_host else f"http://localhost:{elsewhere.server_port}/stolen")
                self.send_header("Content-Length", "0")
                self.end_headers()

            def log_message(self, *args):
                pass

        provider = ThreadingHTTPServer(("127.0.0.1", 0), Provider)
        for server in (elsewhere, provider):
            threading.Thread(target=server.serve_forever, daemon=True).start()
            self.addCleanup(server.server_close)
            self.addCleanup(server.shutdown)

        def request(path):
            return urllib.request.Request(f"http://127.0.0.1:{provider.server_port}{path}",
                                          headers={"Authorization": "Bearer secret", "Music-User-Token": "user"})

        with self.assertRaises(apple.AppleMusicError):
            apple.request_json(request("/other-host"))
        with self.assertRaises(spotify.SpotifyError):
            spotify.request_json(request("/other-host"))
        with self.assertRaises(urllib.error.HTTPError) as refused:
            bot.safe_urlopen(request("/other-host"), timeout=5)
        refused.exception.close()
        self.assertEqual(received, [])
        self.assertEqual(apple.request_json(request("/same-host")), {"ok": True})

    def test_smtp_verifies_the_server_certificate(self):
        calls = []

        class FakeSMTP:
            def __init__(self, host, port, timeout=None, context=None):
                calls.append((type(self).__name__, port, context))

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def starttls(self, context=None):
                calls.append(("starttls", context))

            def send_message(self, message):
                calls.append(("sent", message["To"]))

        class FakeSMTPSSL(FakeSMTP):
            pass

        def verified(context):
            return context is not None and context.verify_mode == ssl.CERT_REQUIRED and context.check_hostname

        with patch.dict(os.environ, {"SMTP_HOST": "smtp.example.test", "SMTP_PORT": "587", "SMTP_STARTTLS": "true",
                                     "SMTP_USERNAME": ""}), \
                patch.object(bot.smtplib, "SMTP", FakeSMTP), patch.object(bot.smtplib, "SMTP_SSL", FakeSMTPSSL):
            self.assertTrue(bot.send_email("Assunto", "Corpo"))
            self.assertEqual([call[0] for call in calls], ["FakeSMTP", "starttls", "sent"])
            self.assertTrue(verified(calls[1][1]))
            calls.clear()
            os.environ["SMTP_PORT"] = "465"
            self.assertTrue(bot.send_email("Assunto", "Corpo"))
            self.assertEqual([call[0] for call in calls], ["FakeSMTPSSL", "sent"])
            self.assertTrue(verified(calls[0][2]))

    def test_first_scan_is_soon_after_startup_and_restarts_keep_the_schedule(self):
        self.assertEqual(bot.next_scan_delay(12), bot.FIRST_SCAN_SECONDS)
        with patch.object(bot, "send_email", return_value=True):
            bot.scan([])
        # A restart right after a scan waits for the rest of the interval instead of scanning again.
        self.assertAlmostEqual(bot.next_scan_delay(12), 12 * 3600, delta=30)
        bot.set_setting("last_scan", str(time.time() - 13 * 3600))
        self.assertEqual(bot.next_scan_delay(12), bot.FIRST_SCAN_SECONDS)
        waits = []

        class Stop:
            def wait(self, seconds):
                waits.append(seconds)
                return len(waits) > 1

        with patch.object(bot, "STOP_SCHEDULER", Stop()), patch.object(bot, "scan", return_value=0) as scan:
            bot.scheduled_scans(12)
        self.assertEqual(waits[0], bot.FIRST_SCAN_SECONDS)
        scan.assert_called_once()

    def test_scan_and_tip_never_mail_the_same_pending_alert(self):
        bodies = []

        def slow_send(subject, body):
            bodies.append(body)
            time.sleep(0.3)
            return True

        with patch.object(bot, "send_email", side_effect=slow_send):
            scanning = threading.Thread(target=bot.scan, args=([FakeSource()],))
            scanning.start()
            time.sleep(0.1)
            bot.add_tip("Sepultura", "Rumor de teste", "2030-03-04", "São Paulo", "BR", "https://example.com/rumor")
            scanning.join()
        self.assertEqual(sum("Show de teste" in body for body in bodies), 1)
        self.assertEqual(sum("Rumor de teste" in body for body in bodies), 1)

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
