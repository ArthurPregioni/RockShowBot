"""Read Apple Music library artists for a short-lived, user-approved import."""
import base64
import json
import os
from pathlib import Path
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request


class AppleMusicError(ValueError):
    pass


def configuration():
    token = os.getenv("APPLE_MUSIC_DEVELOPER_TOKEN", "").strip()
    token_file = os.getenv("APPLE_MUSIC_DEVELOPER_TOKEN_FILE", "").strip()
    if not token and token_file:
        try:
            token = Path(token_file).read_text().strip()
        except OSError:
            raise AppleMusicError("Não foi possível ler o arquivo de token Apple Music.") from None
    origin = (os.getenv("APPLE_MUSIC_ORIGIN") or os.getenv("RENDER_EXTERNAL_URL", "")).rstrip("/")
    parsed = urllib.parse.urlsplit(origin)
    local = parsed.hostname in ("127.0.0.1", "localhost", "::1")
    if (not parsed.netloc or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment
            or not (parsed.scheme == "https" or (parsed.scheme == "http" and local))):
        raise AppleMusicError("Configure APPLE_MUSIC_ORIGIN com a URL HTTPS da instalação (veja o README).")
    try:
        header, claims, _signature = token.split(".")
        decode = lambda value: json.loads(base64.urlsafe_b64decode(value + "=" * (-len(value) % 4)))
        header, claims = decode(header), decode(claims)
        if not isinstance(header, dict) or not isinstance(claims, dict):
            raise ValueError()
        # These are configuration checks. Apple verifies the actual JWT signature.
        if header.get("alg") != "ES256" or not header.get("kid") or not claims.get("iss"):
            raise ValueError()
        if float(claims["exp"]) <= time.time() + 60:
            raise AppleMusicError("Token de desenvolvedor Apple Music expirado ou próximo de expirar. Gere outro.")
        allowed = claims.get("origin")
        if allowed and (not isinstance(allowed, list) or origin not in allowed):
            raise AppleMusicError("O token Apple Music não permite a origem desta instalação. Gere-o para a URL correta.")
    except AppleMusicError:
        raise
    except (ValueError, KeyError, TypeError, UnicodeError):
        raise AppleMusicError("Configure um token Apple Music ES256 válido (veja o README).") from None
    return token, origin


def request_json(request):
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        status = exc.code
        exc.close()
        messages = {401: "Apple recusou o token de desenvolvedor. Confira a chave MusicKit, origem e validade.",
                    403: "Apple recusou o acesso à biblioteca. Confira a assinatura Apple Music e autorize novamente.",
                    429: "Limite de consultas Apple Music atingido. Aguarde antes de tentar novamente."}
        raise AppleMusicError(messages.get(status, f"Apple Music indisponível (HTTP {status}). Tente novamente.")) from None
    except (OSError, ValueError):
        raise AppleMusicError("Não foi possível consultar a biblioteca Apple Music. Tente novamente.") from None


def library_artists(user_token):
    if not isinstance(user_token, str) or not user_token or len(user_token) > 20000 or "\n" in user_token or "\r" in user_token:
        raise AppleMusicError("Autorização Apple Music inválida. Conecte novamente.")
    developer_token, origin = configuration()
    path = "/v1/me/library/artists?limit=25"
    seen, artists = set(), {}
    while path:
        parts = urllib.parse.urlsplit(path)
        if parts.scheme or parts.netloc or parts.path != "/v1/me/library/artists" or parts.fragment or path in seen:
            raise AppleMusicError("Apple retornou paginação inválida. Nenhum artista foi importado.")
        seen.add(path)
        request = urllib.request.Request("https://api.music.apple.com" + path, headers={
            "Authorization": "Bearer " + developer_token, "Music-User-Token": user_token,
            "Origin": origin, "Accept": "application/json", "User-Agent": "RockShowBot/0.3"})
        page = request_json(request)
        for item in page.get("data", []):
            name = item.get("attributes", {}).get("name", "").strip()
            if item.get("id") and name:
                artists[str(item["id"])] = {"id": str(item["id"]), "name": name}
        path = page.get("next")
    return sorted(artists.values(), key=lambda item: item["name"].casefold())


class ImportSessions:
    def __init__(self):
        self.sessions = {}
        self.lock = threading.Lock()

    def start(self):
        _token, origin = configuration()
        state = secrets.token_urlsafe(32)
        with self.lock:
            self.sessions = {key: value for key, value in self.sessions.items() if value["expires"] > time.time()}
            if len(self.sessions) >= 50:
                raise AppleMusicError("Muitas importações pendentes. Aguarde alguns minutos.")
            self.sessions[state] = {"expires": time.time() + 600}
        return state, origin.startswith("https://")

    def pending(self, state):
        with self.lock:
            session = self.sessions.get(state)
            if not session or session["expires"] <= time.time() or "artists" in session:
                raise AppleMusicError("Conexão Apple Music expirada ou já utilizada. Conecte novamente.")

    def fetch(self, state, user_token):
        with self.lock:
            session = self.sessions.pop(state, None)
        if not session or session["expires"] <= time.time() or "artists" in session:
            raise AppleMusicError("Conexão Apple Music expirada ou já utilizada. Conecte novamente.")
        artists = library_artists(user_token)
        # Only candidate names/IDs remain. User/developer tokens are not session data.
        with self.lock:
            self.sessions[state] = {"expires": time.time() + 600, "artists": artists}

    def candidates(self, state):
        with self.lock:
            session = self.sessions.get(state)
            if not session or session["expires"] <= time.time() or "artists" not in session:
                self.sessions.pop(state, None)
                raise AppleMusicError("Seleção Apple Music expirada. Conecte novamente.")
            return list(session["artists"])

    def discard(self, state):
        with self.lock:
            self.sessions.pop(state, None)


sessions = ImportSessions()
