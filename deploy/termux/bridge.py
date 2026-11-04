"""Private authenticated updates for the optional fixed workers.dev address."""
import json
import re
import os
import tempfile
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def bridge_settings(directory):
    filename = Path(directory) / 'bridge.json'
    if not filename.exists():
        return None
    value = json.loads(filename.read_text())
    origin = value.get('publicOrigin', '')
    url = urlsplit(origin)
    if (url.scheme != 'https' or url.username or url.password or url.port
            or url.path not in ('', '/') or url.query or url.fragment
            or not re.fullmatch(r'[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev', url.hostname or '')
            or not re.fullmatch(r'[A-Za-z0-9_-]{32,128}', value.get('updateToken', ''))):
        raise ValueError('Invalid bridge configuration')
    return {'publicOrigin': origin.rstrip('/'), 'updateToken': value['updateToken']}


def publish_origin(settings, tunnel, opener=None):
    url = urlsplit(tunnel)
    if (url.scheme != 'https' or url.username or url.password or url.port
            or url.path not in ('', '/') or url.query or url.fragment
            or not re.fullmatch(r'[a-z0-9-]+\.trycloudflare\.com', url.hostname or '')):
        raise ValueError('Invalid tunnel origin')
    request = urllib.request.Request(
        settings['publicOrigin'] + '/_rockshowbot/tunnel',
        data=json.dumps({'origin': tunnel}).encode(),
        headers={'Authorization': 'Bearer ' + settings['updateToken'],
                 'Content-Type': 'application/json', 'Accept': 'application/json',
                 'User-Agent': 'RockShowBot/0.1'}, method='POST')
    client = opener or urllib.request.build_opener(NoRedirect())
    with client.open(request, timeout=30) as response:
        if response.status != 200 or json.load(response).get('updated') is not True:
            raise RuntimeError('Bridge did not confirm update')


def private_write(filename, value):
    with tempfile.NamedTemporaryFile(mode='w', dir=filename.parent, delete=False) as stream:
        temporary = Path(stream.name)
        os.chmod(temporary, 0o600)
        stream.write(value)
    temporary.replace(filename)


def configure_origin(config, tunnel, settings=None):
    """Keep the app's canonical address fixed while the transport changes."""
    origin = settings['publicOrigin'] if settings else tunnel
    text = config.read_text()
    line = 'ROCKSHOWBOT_SITE_ORIGIN=' + origin
    updated = re.sub(r'^ROCKSHOWBOT_SITE_ORIGIN=.*$', line, text, flags=re.M)
    if not re.search(r'^ROCKSHOWBOT_SITE_ORIGIN=', text, flags=re.M):
        updated = text.rstrip() + '\n' + line + '\n'
    private_write(config.parent / 'tunnel-url.txt', tunnel + '\n')
    private_write(config.parent / 'public-url.txt', origin + '\n')
    if updated == text:
        return False
    private_write(config, updated)
    return True
