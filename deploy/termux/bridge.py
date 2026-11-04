"""Private authenticated updates for the optional fixed workers.dev address."""
import json
import re
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
                 'Content-Type': 'application/json'}, method='POST')
    client = opener or urllib.request.build_opener(NoRedirect())
    with client.open(request, timeout=30) as response:
        if response.status != 200 or json.load(response).get('updated') is not True:
            raise RuntimeError('Bridge did not confirm update')
