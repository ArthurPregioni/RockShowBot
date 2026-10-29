"""One-time Spotify artist import with PKCE; tokens are never persisted."""
import base64
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request


class SpotifyError(ValueError):
    pass


def configuration():
    client_id = os.getenv("SPOTIFY_CLIENT_ID", "").strip()
    redirect = os.getenv("SPOTIFY_REDIRECT_URI", "").strip()
    if not redirect and os.getenv("RENDER_EXTERNAL_URL"):
        redirect = os.environ["RENDER_EXTERNAL_URL"].rstrip("/") + "/spotify/callback"
    parsed = urllib.parse.urlsplit(redirect)
    loopback = parsed.hostname in ("127.0.0.1", "::1")
    if not client_id or not parsed.netloc or parsed.hostname == "localhost" or parsed.username or parsed.password or parsed.fragment or parsed.query:
        raise SpotifyError("Configure SPOTIFY_CLIENT_ID e SPOTIFY_REDIRECT_URI (veja o README).")
    if parsed.path != "/spotify/callback" or not (parsed.scheme == "https" or (parsed.scheme == "http" and loopback)):
        raise SpotifyError("O callback Spotify precisa usar HTTPS ou http://127.0.0.1:PORT/spotify/callback.")
    return client_id, redirect


def request_json(request):
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        status = exc.code
        exc.close()
        messages = {
            400: "Spotify recusou a autorização. Confira o Client ID e o callback e conecte novamente.",
            401: "Autorização Spotify inválida ou expirada. Conecte novamente.",
            403: "Spotify recusou o acesso. Confira Premium do proprietário e usuários autorizados no Dashboard.",
            429: "Limite de consultas Spotify atingido. Aguarde antes de tentar novamente.",
        }
        raise SpotifyError(messages.get(status, f"Spotify indisponível (HTTP {status}). Tente novamente.")) from None
    except (OSError, ValueError):
        raise SpotifyError("Não foi possível consultar o Spotify. Tente novamente.") from None


def followed_artists(access_token):
    artists = {}
    cursor = None
    seen = set()
    while True:
        params = {"type": "artist", "limit": 50}
        if cursor:
            params["after"] = cursor
        request = urllib.request.Request("https://api.spotify.com/v1/me/following?" + urllib.parse.urlencode(params),
            headers={"Authorization": "Bearer " + access_token})
        page = request_json(request).get("artists", {})
        for item in page.get("items", []):
            if item.get("id") and item.get("name"):
                artists[item["id"]] = {"id": item["id"], "name": item["name"],
                    "url": "https://open.spotify.com/artist/" + urllib.parse.quote(item["id"], safe="")}
        if not page.get("next"):
            return sorted(artists.values(), key=lambda item: item["name"].casefold())
        cursor = page.get("cursors", {}).get("after")
        if not cursor or cursor in seen:
            raise SpotifyError("Spotify retornou paginação inválida. Nenhum artista foi importado.")
        seen.add(cursor)


class ImportSessions:
    """Short-lived, browser-bound import sessions. Restarting cancels pending imports."""
    def __init__(self):
        self.sessions = {}
        self.lock = threading.Lock()

    def start(self):
        client_id, redirect = configuration()
        state = secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(64)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        with self.lock:
            self.sessions = {key: value for key, value in self.sessions.items() if value["expires"] > time.time()}
            if len(self.sessions) >= 50:
                raise SpotifyError("Muitas conexões pendentes. Aguarde alguns minutos.")
            self.sessions[state] = {"expires": time.time() + 600, "verifier": verifier,
                "client_id": client_id, "redirect": redirect}
        params = {"client_id": client_id, "response_type": "code", "redirect_uri": redirect,
            "scope": "user-follow-read", "state": state, "code_challenge": challenge, "code_challenge_method": "S256"}
        return state, "https://accounts.spotify.com/authorize?" + urllib.parse.urlencode(params), redirect.startswith("https://")

    def finish(self, state, browser_state, code, error=None):
        if not state or not browser_state or not hmac.compare_digest(state, browser_state):
            raise SpotifyError("Conexão Spotify inválida. Inicie novamente pelo botão Conectar Spotify.")
        with self.lock:
            session = self.sessions.pop(state, None)
        if not session or session["expires"] <= time.time() or "verifier" not in session:
            raise SpotifyError("Conexão Spotify expirada ou já utilizada. Conecte novamente.")
        if error or not code:
            raise SpotifyError("A autorização Spotify foi cancelada. Você pode tentar novamente.")
        request = urllib.request.Request("https://accounts.spotify.com/api/token", data=urllib.parse.urlencode({
            "grant_type": "authorization_code", "code": code, "redirect_uri": session["redirect"],
            "client_id": session["client_id"], "code_verifier": session["verifier"]}).encode(),
            headers={"Content-Type": "application/x-www-form-urlencoded"})
        token = request_json(request).get("access_token")
        if not token:
            raise SpotifyError("Spotify não retornou uma autorização válida. Conecte novamente.")
        artists = followed_artists(token)
        # Discard access/refresh tokens and PKCE verifier after this one-time read.
        with self.lock:
            self.sessions[state] = {"expires": time.time() + 600, "artists": artists}

    def candidates(self, state):
        with self.lock:
            session = self.sessions.get(state)
            if not session or session["expires"] <= time.time() or "artists" not in session:
                self.sessions.pop(state, None)
                raise SpotifyError("Seleção expirada. Conecte ao Spotify novamente.")
            return list(session["artists"])

    def discard(self, state):
        with self.lock:
            self.sessions.pop(state, None)


sessions = ImportSessions()
