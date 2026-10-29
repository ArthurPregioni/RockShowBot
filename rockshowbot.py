#!/usr/bin/env python3
"""Self-hosted concert alerts, with optional event providers and email."""
from __future__ import annotations

import base64
import csv
import hmac
import hashlib
import html
import io
import json
import os
import re
import smtplib
import sqlite3
import threading
import unicodedata
import urllib.parse
import urllib.request
from datetime import date
from contextlib import contextmanager
from email.message import EmailMessage
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DB_PATH = os.getenv("DATABASE_PATH", "rockshowbot.db")
TM_KEY = os.getenv("TICKETMASTER_API_KEY", "")
PHQ_KEY = os.getenv("PREDICTHQ_API_KEY", "")
APP_USER = os.getenv("APP_USER", "admin")
APP_PASSWORD = os.getenv("APP_PASSWORD", "")
SCAN_LOCK = threading.Lock()
STOP_SCHEDULER = threading.Event()
MAX_POST_BYTES = 1_000_000


@contextmanager
def db():
    con = sqlite3.connect(DB_PATH, timeout=20)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys=ON")
    con.execute("PRAGMA busy_timeout=20000")
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def init_db():
    with db() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS artists (
          id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS regions (code TEXT PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY, artist TEXT NOT NULL, title TEXT NOT NULL,
          venue TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '',
          region TEXT NOT NULL DEFAULT '', starts_at TEXT NOT NULL DEFAULT '',
          url TEXT NOT NULL DEFAULT '', source TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'listed',
          email_sent INTEGER NOT NULL DEFAULT 0,
          discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        INSERT OR IGNORE INTO regions(code,name) VALUES ('BR','Brasil');
        """)
        columns = {row[1] for row in con.execute("PRAGMA table_info(events)")}
        if "status" not in columns:
            con.execute("ALTER TABLE events ADD COLUMN status TEXT NOT NULL DEFAULT 'listed'")
        if "email_sent" not in columns:
            # Keep events from older installs from being mailed again after upgrade.
            con.execute("ALTER TABLE events ADD COLUMN email_sent INTEGER NOT NULL DEFAULT 1")


def setting(key, default=""):
    with db() as con:
        row = con.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row[0] if row else default


def set_setting(key, value):
    with db() as con:
        con.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value.strip()))


def send_email(subject, body):
    recipient = setting("email")
    host = os.getenv("SMTP_HOST", "")
    if not recipient or not host:
        return False
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = os.getenv("SMTP_FROM", os.getenv("SMTP_USERNAME", "rockshowbot@localhost"))
    message["To"] = recipient
    message.set_content(body)
    port = int(os.getenv("SMTP_PORT", "587"))
    with smtplib.SMTP(host, port, timeout=20) as smtp:
        if os.getenv("SMTP_STARTTLS", "true").lower() in ("1", "true", "yes"):
            smtp.starttls()
        username, password = os.getenv("SMTP_USERNAME"), os.getenv("SMTP_PASSWORD")
        if username:
            smtp.login(username, password or "")
        smtp.send_message(message)
    return True


def notify_pending():
    """Send unsent event alerts; leave them queued when SMTP is unavailable."""
    with db() as con:
        pending = con.execute("SELECT * FROM events WHERE email_sent=0 ORDER BY discovered_at,id").fetchall()
    if not pending:
        return 0
    lines = []
    for event in pending:
        label = "DICA NÃO VERIFICADA" if event["status"] == "unverified" else "LISTADO NA FONTE"
        lines.append(f"[{label}] {event['artist']} — {event['title']}\n"
                     f"{event['starts_at']} | {event['venue']} — {event['city']} ({event['region']})\n"
                     f"Fonte: {event['source']}\n{event['url']}")
    try:
        sent = send_email(f"RockShowBot: {len(pending)} alerta(s) novo(s)", "Novos eventos/dicas:\n\n" + "\n\n".join(lines))
    except Exception as exc:
        print(f"Email failed; alerts remain queued: {exc}")
        return 0
    if sent:
        with db() as con:
            con.executemany("UPDATE events SET email_sent=1 WHERE id=?", [(event["id"],) for event in pending])
        return len(pending)
    return 0


def normalized(value):
    value = unicodedata.normalize("NFKD", value or "")
    value = "".join(char for char in value if not unicodedata.combining(char)).casefold()
    return " ".join(re.findall(r"[a-z0-9]+", value))


def ticketmaster_matches(artist, event):
    """Reject keyword hits where Ticketmaster identifies a different attraction."""
    wanted = normalized(artist)
    attractions = event.get("_embedded", {}).get("attractions", [])
    names = [normalized(item.get("name", "")) for item in attractions]
    if names:
        return wanted in names
    # Some event records omit attractions; accept only a full title match.
    title = normalized(event.get("name", ""))
    return title == wanted or title.startswith(wanted + " ") or title.endswith(" " + wanted)


class TicketmasterSource:
    name = "Ticketmaster"

    def find(self, artist, countries):
        if not TM_KEY:
            return []
        found = []
        for country in countries:
            query = urllib.parse.urlencode({"apikey": TM_KEY, "keyword": artist,
                  "countryCode": country, "size": 50, "sort": "date,asc", "classificationName": "music"})
            request = urllib.request.Request("https://app.ticketmaster.com/discovery/v2/events.json?" + query,
                headers={"User-Agent": "RockShowBot/0.2 (open source concert alerts)"})
            try:
                with urllib.request.urlopen(request, timeout=25) as response:
                    payload = json.load(response)
            except Exception as exc:
                print(f"Ticketmaster lookup failed for {artist}/{country}: {exc}")
                continue
            events = payload.get("_embedded", {}).get("events", [])
            for event in events:
                if not ticketmaster_matches(artist, event):
                    continue
                dates = event.get("dates", {}).get("start", {})
                venue = (event.get("_embedded", {}).get("venues") or [{}])[0]
                found.append({"id": "tm:" + event["id"], "artist": artist,
                    "title": event.get("name", artist), "venue": venue.get("name", ""),
                    "city": venue.get("city", {}).get("name", ""), "region": country,
                    "starts_at": dates.get("dateTime") or dates.get("localDate", ""),
                    "url": event.get("url", ""), "source": self.name, "status": "listed"})
        return found


class PredictHQSource:
    """Optional global events source; requires an account/token and may be paid."""
    name = "PredictHQ"

    def find(self, artist, countries):
        if not PHQ_KEY:
            return []
        found = []
        for country in countries:
            query = urllib.parse.urlencode({"q": artist, "category": "concerts,festivals",
                  "country": country, "start.gte": date.today().isoformat(), "limit": 50, "sort": "start"})
            request = urllib.request.Request("https://api.predicthq.com/v1/events/?" + query,
                headers={"Authorization": "Bearer " + PHQ_KEY, "Accept": "application/json",
                         "User-Agent": "RockShowBot/0.2"})
            try:
                with urllib.request.urlopen(request, timeout=25) as response:
                    payload = json.load(response)
            except Exception as exc:
                print(f"PredictHQ lookup failed for {artist}/{country}: {exc}")
                continue
            for event in payload.get("results", []):
                entity_names = [normalized(item.get("name", "")) for item in event.get("entities", [])]
                title = event.get("title", "")
                normalized_title = normalized(title)
                if normalized(artist) not in entity_names and normalized(artist) not in normalized_title:
                    continue
                location = event.get("location", []) or []
                city = event.get("place", {}).get("name", "")
                if not city and len(location) >= 2:
                    city = f"{location[1]}, {location[0]}"
                found.append({"id": "phq:" + str(event["id"]), "artist": artist,
                    "title": title or artist, "venue": "", "city": city, "region": country,
                    "starts_at": event.get("start", ""),
                    "url": "https://predicthq.com/events/" + urllib.parse.quote(str(event["id"])),
                    "source": self.name, "status": "listed"})
        return found


def configured_sources():
    sources = []
    if TM_KEY:
        sources.append(TicketmasterSource())
    if PHQ_KEY:
        sources.append(PredictHQSource())
    return sources


def scan(sources=None):
    """Scan all configured providers. Failures in one provider do not stop others."""
    with SCAN_LOCK:
        with db() as con:
            artists = [row[0] for row in con.execute("SELECT name FROM artists ORDER BY name")]
            countries = [row[0] for row in con.execute("SELECT code FROM regions ORDER BY code")]
        sources = configured_sources() if sources is None else sources
        new_events = []
        for source in sources:
            for artist in artists:
                try:
                    results = source.find(artist, countries)
                except Exception as exc:
                    print(f"{source.name} failed for {artist}: {exc}")
                    continue
                for event in results:
                    event.setdefault("status", "listed")
                    with db() as con:
                        cur = con.execute("""INSERT OR IGNORE INTO events
                            (id,artist,title,venue,city,region,starts_at,url,source,status,email_sent)
                            VALUES(:id,:artist,:title,:venue,:city,:region,:starts_at,:url,:source,:status,0)""", event)
                        if cur.rowcount:
                            new_events.append(event)
        notify_pending()
        return len(new_events)


def parse_artist_csv(text):
    """Read a one-column artist list or a CSV with name/artist/band header."""
    rows = list(csv.reader(io.StringIO(text.lstrip("\ufeff"))))
    if not rows:
        return []
    first = [cell.strip().casefold() for cell in rows[0]]
    headers = {"name", "artist", "band", "artista", "banda"}
    has_header = any(cell in headers for cell in first)
    column = next((i for i, cell in enumerate(first) if cell in headers), 0)
    names = []
    for row in rows[1 if has_header else 0:]:
        if len(row) > column and row[column].strip():
            name = row[column].strip()
            if name.casefold() not in headers and name not in names:
                names.append(name)
    return names


def import_artists(text):
    names = parse_artist_csv(text)
    with db() as con:
        before = con.total_changes
        con.executemany("INSERT OR IGNORE INTO artists(name) VALUES(?)", [(name,) for name in names])
        return con.total_changes - before


def add_tip(artist, title, starts_at, city, region, url):
    if not artist or not title or not url:
        raise ValueError("Artista, nome do evento e link são obrigatórios")
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("O link precisa começar com http:// ou https://")
    if starts_at:
        date.fromisoformat(starts_at[:10])
    raw_id = "|".join((normalized(artist), normalized(title), starts_at, url))
    event = {"id": "tip:" + hashlib.sha256(raw_id.encode()).hexdigest()[:24],
        "artist": artist, "title": title, "venue": "", "city": city, "region": region,
        "starts_at": starts_at, "url": url, "source": "Dica da comunidade", "status": "unverified"}
    with db() as con:
        cur = con.execute("""INSERT OR IGNORE INTO events
          (id,artist,title,venue,city,region,starts_at,url,source,status,email_sent)
          VALUES(:id,:artist,:title,:venue,:city,:region,:starts_at,:url,:source,:status,0)""", event)
    if cur.rowcount:
        notify_pending()
        return True
    return False


def esc(value):
    return html.escape(str(value or ""), quote=True)


def source_status():
    return [
        ("Ticketmaster", bool(TM_KEY), "chave configurada" if TM_KEY else "defina TICKETMASTER_API_KEY"),
        ("PredictHQ", bool(PHQ_KEY), "chave configurada" if PHQ_KEY else "opcional; defina PREDICTHQ_API_KEY"),
        ("Dicas da comunidade", True, "disponível; dicas ficam marcadas como não verificadas"),
    ]


class Handler(BaseHTTPRequestHandler):
    server_version = "RockShowBot/0.2"

    def respond(self, status, body, content_type="text/html; charset=utf-8", headers=()):
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
        for name, value in headers:
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(data)

    def require_auth(self):
        header = self.headers.get("Authorization", "")
        try:
            kind, token = header.split(" ", 1)
            username, password = base64.b64decode(token, validate=True).decode().split(":", 1)
        except Exception:
            username, password, kind = "", "", ""
        valid = (kind.lower() == "basic" and username == APP_USER and
                 bool(APP_PASSWORD) and hmac.compare_digest(password, APP_PASSWORD))
        if not valid:
            self.respond(401, "Autenticação necessária.", headers=(("WWW-Authenticate", 'Basic realm="RockShowBot", charset="UTF-8"'),))
        return valid

    def valid_post_origin(self):
        origin = self.headers.get("Origin")
        host = self.headers.get("Host", "")
        if not origin or not host:
            return False
        return urllib.parse.urlsplit(origin).netloc.casefold() == host.casefold()

    def read_post(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length < 0 or length > MAX_POST_BYTES:
            raise ValueError("Upload muito grande (máximo 1 MB)")
        return self.rfile.read(length)

    def redirect(self, location="/"):
        self.send_response(303)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def page(self, content, status=200):
        body = ("<!doctype html><html lang='pt-BR'><meta charset='utf-8'>"
          "<meta name='viewport' content='width=device-width,initial-scale=1'>"
          "<title>RockShowBot</title><style>"
          "body{font:16px system-ui;max-width:960px;margin:2rem auto;padding:0 1rem;color:#202124}"
          "h1{color:#a52235}h2{margin-top:2rem}form{display:flex;gap:.5rem;flex-wrap:wrap;margin:.8rem 0}"
          "input,button,textarea,select{font:inherit;padding:.55rem}input[type=text],input[type=email],textarea,select{flex:1;min-width:180px}"
          "button{background:#a52235;color:white;border:0;border-radius:4px;cursor:pointer}"
          "article,.panel{padding:.85rem;margin:.5rem 0;border:1px solid #ddd;border-radius:6px}"
          ".muted{color:#666;font-size:.9rem}.badge{font-size:.8rem;border-radius:10px;padding:.2rem .5rem;background:#eee}"
          ".unverified{background:#fff0cc}.good{color:#176b35}.bad{color:#995b00}.inline{display:inline-flex}"
          "</style><body>" f"<h1>🎸 RockShowBot</h1><p>Alertas de shows para suas bandas favoritas.</p>{content}</body></html>")
        self.respond(status, body)

    def do_GET(self):
        if self.path == "/healthz":
            self.respond(200, b'{"status":"ok"}', "application/json")
            return
        if not self.require_auth():
            return
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        flash = ""
        if query.get("email_test") == ["sent"]:
            flash = "<p class='panel good'>E-mail de teste enviado.</p>"
        elif query.get("scan"):
            flash = f"<p class='panel'>Busca concluída: {esc(query['scan'][0])} evento(s) novo(s).</p>"
        elif query.get("tip") == ["added"]:
            flash = "<p class='panel'>Dica adicionada e marcada como não verificada.</p>"
        elif query.get("tip") == ["duplicate"]:
            flash = "<p class='panel'>Essa dica já estava cadastrada.</p>"
        elif query.get("imported"):
            flash = f"<p class='panel'>Artistas novos importados: {esc(query['imported'][0])}.</p>"
        with db() as con:
            artists = con.execute("SELECT name FROM artists ORDER BY name").fetchall()
            regions = con.execute("SELECT code,name FROM regions ORDER BY name").fetchall()
            events = con.execute("SELECT * FROM events ORDER BY CASE WHEN starts_at='' THEN 1 ELSE 0 END, starts_at LIMIT 150").fetchall()
        artist_list = " ".join(f"<form method='post' action='/artist/remove'><input type='hidden' name='name' value='{esc(a['name'])}'><span>{esc(a['name'])}</span><button>Remover</button></form>" for a in artists) or "<p class='muted'>Cadastre uma banda ou importe um CSV.</p>"
        region_list = " ".join(f"<form method='post' action='/region/remove'><input type='hidden' name='code' value='{esc(r['code'])}'><span>{esc(r['name'])} ({esc(r['code'])})</span><button>Remover</button></form>" for r in regions)
        event_cards = []
        for event in events:
            status = "unverified" if event["status"] == "unverified" else ""
            label = "Dica não verificada" if status else "Listado na fonte"
            date_text = f"{esc(event['starts_at'])} · " if event["starts_at"] else "Data a confirmar · "
            loc = " · ".join(part for part in (event["venue"], event["city"], event["region"]) if part)
            href = f"<a href='{esc(event['url'])}' target='_blank' rel='noopener noreferrer'>Abrir fonte/link</a>" if event["url"] else ""
            event_cards.append(f"<article class='{status}'><b>{esc(event['artist'])}</b> — {esc(event['title'])} "
                f"<span class='badge'>{label}</span><br>{date_text}{esc(loc)}<br>{href} <span class='muted'>via {esc(event['source'])}</span></article>")
        event_list = "".join(event_cards) or "<p class='muted'>Ainda não há eventos. Use o botão de busca, ou cadastre uma dica.</p>"
        sources = "".join(f"<li>{esc(name)}: <span class='{('good' if active else 'bad')}'>{esc(state)}</span></li>" for name, active, state in source_status())
        select = "".join(f"<option value='{esc(a['name'])}'>{esc(a['name'])}</option>" for a in artists)
        content = (flash + "<h2>Configuração</h2>"
          f"<div class='panel'><b>Fontes ativas</b><ul>{sources}</ul></div>"
          f"<form method='post' action='/email'><input type='email' name='email' placeholder='Seu e-mail para alertas' value='{esc(setting('email'))}' required><button>Salvar e-mail</button></form>"
          "<form method='post' action='/email/test'><button>Enviar e-mail de teste</button></form>"
          "<h2>Bandas / artistas</h2><form method='post' action='/artist'><input type='text' name='name' placeholder='Nome do artista' required><button>Adicionar</button></form>"
          f"{artist_list}<details><summary>Importar CSV</summary><p class='muted'>Aceita uma coluna ou cabeçalho name, artist, band, artista ou banda.</p>"
          "<form method='post' enctype='multipart/form-data' action='/artists/import'><input type='file' name='file' accept='.csv,text/csv' required><button>Importar artistas</button></form></details>"
          "<h2>Regiões</h2><p class='muted'>Brasil (BR) vem ativado. Códigos ISO de duas letras, como AR, CL, MX, US ou PT.</p>"
          "<form method='post' action='/region'><input type='text' name='code' placeholder='Código, ex. AR' maxlength='2' required><input type='text' name='name' placeholder='Nome, ex. Argentina' required><button>Adicionar região</button></form>"
          f"{region_list}<form method='post' action='/scan'><button>Buscar shows agora</button></form>"
          "<h2>Dica de possível show</h2><p class='muted'>Adicione um anúncio ou rumor com um link de origem. Ele será marcado como não verificado.</p>"
          f"<form method='post' action='/tip'><select name='artist' required>{select}</select><input type='text' name='title' placeholder='Ex.: show anunciado em São Paulo' required>"
          "<input type='date' name='starts_at'><input type='text' name='city' placeholder='Cidade'><input type='text' name='region' placeholder='País/região, ex. BR'>"
          "<input type='url' name='url' placeholder='Link da fonte' required><button>Adicionar dica</button></form>"
          f"<h2>Eventos e dicas</h2>{event_list}<p class='muted'>Eventos listados por terceiros não são confirmação oficial. Dicas da comunidade são rumores não verificados.</p>")
        self.page(content)

    def do_POST(self):
        if not self.require_auth():
            return
        if not self.valid_post_origin():
            self.page("<h2>Requisição recusada</h2><p>Origem não reconhecida. Volte à interface e tente novamente.</p>", 403)
            return
        try:
            body = self.read_post()
            content_type = self.headers.get("Content-Type", "")
            if self.path == "/artists/import":
                message = BytesParser(policy=default).parsebytes(
                    (f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n").encode() + body)
                part = next((p for p in message.walk() if p.get_content_disposition() == "form-data" and p.get_param("name", header="content-disposition") == "file"), None)
                if part is None:
                    raise ValueError("Não encontrei o arquivo CSV no formulário")
                text = part.get_payload(decode=True).decode("utf-8-sig")
                count = import_artists(text)
                self.redirect("/?imported=" + str(count))
                return
            form = urllib.parse.parse_qs(body.decode("utf-8"), keep_blank_values=True)
            value = lambda key: form.get(key, [""])[0].strip()
            if self.path == "/artist" and value("name"):
                with db() as con:
                    con.execute("INSERT OR IGNORE INTO artists(name) VALUES(?)", (value("name"),))
            elif self.path == "/artist/remove":
                with db() as con:
                    con.execute("DELETE FROM artists WHERE name=?", (value("name"),))
            elif self.path == "/region" and re.fullmatch(r"[A-Za-z]{2}", value("code")) and value("name"):
                with db() as con:
                    con.execute("INSERT OR REPLACE INTO regions(code,name) VALUES(?,?)", (value("code").upper(), value("name")))
            elif self.path == "/region/remove" and value("code").upper() != "BR":
                with db() as con:
                    con.execute("DELETE FROM regions WHERE code=?", (value("code").upper(),))
            elif self.path == "/email":
                set_setting("email", value("email"))
            elif self.path == "/email/test":
                if not setting("email"):
                    raise ValueError("Salve um e-mail antes de pedir o teste")
                if not send_email("RockShowBot — teste de e-mail", "O envio de e-mail do RockShowBot está funcionando."):
                    raise ValueError("Configure SMTP_HOST e salve seu e-mail antes de testar")
                self.redirect("/?email_test=sent")
                return
            elif self.path == "/scan":
                count = scan()
                self.redirect("/?scan=" + str(count))
                return
            elif self.path == "/tip":
                if not value("artist"):
                    raise ValueError("Cadastre um artista antes de adicionar dicas")
                added = add_tip(value("artist"), value("title"), value("starts_at"), value("city"), value("region"), value("url"))
                self.redirect("/?tip=" + ("added" if added else "duplicate"))
                return
            else:
                raise ValueError("Ação inválida")
            self.redirect()
        except Exception as exc:
            self.page(f"<h2>Não foi possível concluir</h2><p>{esc(exc)}</p><a href='/'>Voltar</a>", 400)

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))


def scheduled_scans(interval_hours):
    while not STOP_SCHEDULER.wait(interval_hours * 3600):
        try:
            count = scan()
            print(f"Scheduled scan finished: {count} new event(s)")
        except Exception as exc:
            print(f"Scheduled scan failed: {exc}")


def run_server():
    if not APP_PASSWORD:
        raise SystemExit("Configure APP_PASSWORD antes de iniciar (veja .env.example)")
    init_db()
    port = int(os.getenv("PORT", "8000"))
    try:
        interval_hours = float(os.getenv("SCAN_INTERVAL_HOURS", "12"))
    except ValueError as exc:
        raise SystemExit("SCAN_INTERVAL_HOURS precisa ser um número positivo") from exc
    if interval_hours <= 0:
        raise SystemExit("SCAN_INTERVAL_HOURS precisa ser maior que zero")
    scheduler = threading.Thread(target=scheduled_scans, args=(interval_hours,), daemon=True)
    scheduler.start()
    print(f"RockShowBot ouvindo em 0.0.0.0:{port}; buscas automáticas a cada {interval_hours:g}h")
    try:
        ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
    except KeyboardInterrupt:
        STOP_SCHEDULER.set()


if __name__ == "__main__":
    run_server()
