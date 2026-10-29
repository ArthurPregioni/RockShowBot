#!/usr/bin/env python3
"""A tiny self-hosted concert alert app. Python 3.10+, standard library only."""
from __future__ import annotations

import html
import json
import os
import smtplib
import sqlite3
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from email.message import EmailMessage
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DB_PATH = os.getenv("DATABASE_PATH", "rockshowbot.db")
TM_KEY = os.getenv("TICKETMASTER_API_KEY", "")


def db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys=ON")
    return con


def init_db():
    with db() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS artists (
          id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS regions (
          code TEXT PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY, artist TEXT NOT NULL, title TEXT NOT NULL,
          venue TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '',
          region TEXT NOT NULL DEFAULT '', starts_at TEXT NOT NULL DEFAULT '',
          url TEXT NOT NULL DEFAULT '', source TEXT NOT NULL,
          discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        INSERT OR IGNORE INTO regions(code,name) VALUES ('BR','Brasil');
        """)


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


class TicketmasterSource:
    """Official Ticketmaster Discovery API adapter; add other sources behind this interface."""
    name = "Ticketmaster Discovery API"

    def find(self, artist, countries):
        if not TM_KEY:
            return []
        found = []
        for country in countries:
            query = urllib.parse.urlencode({"apikey": TM_KEY, "keyword": artist,
                  "countryCode": country, "size": 50, "sort": "date,asc"})
            url = "https://app.ticketmaster.com/discovery/v2/events.json?" + query
            request = urllib.request.Request(url, headers={"User-Agent": "RockShowBot/0.1 (open source concert alerts)"})
            try:
                with urllib.request.urlopen(request, timeout=20) as response:
                    payload = json.load(response)
            except Exception as exc:
                print(f"Ticketmaster lookup failed for {artist}/{country}: {exc}")
                continue
            for event in payload.get("_embedded", {}).get("events", []):
                dates = event.get("dates", {}).get("start", {})
                venue = (event.get("_embedded", {}).get("venues") or [{}])[0]
                city = venue.get("city", {}).get("name", "")
                found.append({"id": "tm:" + event["id"], "artist": artist,
                    "title": event.get("name", artist), "venue": venue.get("name", ""),
                    "city": city, "region": country,
                    "starts_at": dates.get("dateTime") or dates.get("localDate", ""),
                    "url": event.get("url", ""), "source": self.name})
        return found


def scan():
    with db() as con:
        artists = [r[0] for r in con.execute("SELECT name FROM artists ORDER BY name")]
        countries = [r[0] for r in con.execute("SELECT code FROM regions")]
    source = TicketmasterSource()
    new = []
    for artist in artists:
        for event in source.find(artist, countries):
            with db() as con:
                cur = con.execute("INSERT OR IGNORE INTO events(id,artist,title,venue,city,region,starts_at,url,source) VALUES(:id,:artist,:title,:venue,:city,:region,:starts_at,:url,:source)", event)
                if cur.rowcount:
                    new.append(event)
    if new:
        lines = []
        for e in new:
            lines.append(f"{e['artist']} — {e['title']}\n{e['starts_at']} | {e['venue']} — {e['city']} ({e['region']})\n{e['url']}")
        try:
            send_email(f"RockShowBot: {len(new)} show(s) novo(s)", "Novos eventos encontrados:\n\n" + "\n\n".join(lines))
        except Exception as exc:
            print("Email failed:", exc)
    return len(new)


def esc(value):
    return html.escape(str(value), quote=True)


class Handler(BaseHTTPRequestHandler):
    def page(self, content, status=200):
        body = ("<!doctype html><html lang='pt-BR'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
          "<title>RockShowBot</title><style>body{font:16px system-ui;max-width:900px;margin:2rem auto;padding:0 1rem;color:#202124}h1{color:#a52235}form{display:flex;gap:.5rem;flex-wrap:wrap;margin:.8rem 0}input,button{font:inherit;padding:.55rem}input[type=text],input[type=email]{flex:1;min-width:180px}button{background:#a52235;color:white;border:0;border-radius:4px;cursor:pointer}article{padding:.75rem 0;border-bottom:1px solid #ddd}.muted{color:#666;font-size:.9rem}</style><body>"
          f"<h1>🎸 RockShowBot</h1><p>Alertas de shows para suas bandas favoritas.</p>{content}</body></html>").encode()
        self.send_response(status); self.send_header("Content-Type", "text/html; charset=utf-8"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

    def do_GET(self):
        with db() as con:
            artists = con.execute("SELECT name FROM artists ORDER BY name").fetchall()
            regions = con.execute("SELECT code,name FROM regions ORDER BY name").fetchall()
            events = con.execute("SELECT * FROM events ORDER BY starts_at LIMIT 100").fetchall()
        artist_list = " ".join(f"<form method='post' action='/artist/remove'><input type='hidden' name='name' value='{esc(a['name'])}'><span>{esc(a['name'])}</span><button>Remover</button></form>" for a in artists) or "<p class='muted'>Ainda não há artistas cadastrados.</p>"
        region_list = " ".join(f"<form method='post' action='/region/remove'><input type='hidden' name='code' value='{esc(r['code'])}'><span>{esc(r['name'])} ({esc(r['code'])})</span><button>Remover</button></form>" for r in regions)
        event_list = "".join(f"<article><b>{esc(e['artist'])}</b> — {esc(e['title'])}<br>{esc(e['starts_at'])} · {esc(e['venue'])} · {esc(e['city'])} ({esc(e['region'])})<br><a href='{esc(e['url'])}' target='_blank' rel='noopener'>Ver evento</a> <span class='muted'>via {esc(e['source'])}</span></article>" for e in events) or "<p class='muted'>Nenhum evento encontrado ainda.</p>"
        regions_hint = "Brasil (BR) fica ativado por padrão. Adicione códigos ISO de países, como AR, CL ou MX."
        content = (f"<h2>Preferências</h2><form method='post' action='/email'><input type='email' name='email' placeholder='Seu e-mail para alertas' value='{esc(setting('email'))}'><button>Salvar e-mail</button></form>"
          "<h2>Bandas / artistas</h2><form method='post' action='/artist'><input type='text' name='name' placeholder='Nome do artista' required><button>Adicionar</button></form>"+artist_list+
          f"<h2>Regiões</h2><p class='muted'>{regions_hint}</p><form method='post' action='/region'><input type='text' name='code' placeholder='Código, ex. AR' maxlength='2' required><input type='text' name='name' placeholder='Nome, ex. Argentina' required><button>Adicionar região</button></form>{region_list}"
          "<form method='post' action='/scan'><button>Buscar shows agora</button></form>"
          f"<h2>Eventos encontrados</h2>{event_list}<p class='muted'>Fonte configurada: Ticketmaster Discovery API. Eventos são anúncios encontrados, não rumores verificados.</p>")
        self.page(content)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        form = urllib.parse.parse_qs(self.rfile.read(length).decode())
        value = lambda key: form.get(key, [""])[0].strip()
        path = self.path
        try:
            with db() as con:
                if path == "/artist" and value("name"):
                    con.execute("INSERT OR IGNORE INTO artists(name) VALUES(?)", (value("name"),))
                elif path == "/artist/remove":
                    con.execute("DELETE FROM artists WHERE name=?", (value("name"),))
                elif path == "/region" and len(value("code")) == 2:
                    con.execute("INSERT OR REPLACE INTO regions(code,name) VALUES(?,?)", (value("code").upper(), value("name")))
                elif path == "/region/remove" and value("code").upper() != "BR":
                    con.execute("DELETE FROM regions WHERE code=?", (value("code").upper(),))
            if path == "/email": set_setting("email", value("email"))
            if path == "/scan":
                count = scan()
                self.send_response(303); self.send_header("Location", "/?scan="+str(count)); self.end_headers(); return
            self.send_response(303); self.send_header("Location", "/"); self.end_headers()
        except Exception as exc:
            self.page(f"<h2>Erro</h2><pre>{esc(exc)}</pre><a href='/'>Voltar</a>", 500)

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))


def run_server():
    init_db()
    port = int(os.getenv("PORT", "8000"))
    print(f"RockShowBot rodando em http://localhost:{port}")
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()


if __name__ == "__main__":
    run_server()
