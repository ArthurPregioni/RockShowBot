"""Standalone Python server and streaming integrations."""
import urllib.error
import urllib.parse
import urllib.request


class SameHostRedirects(urllib.request.HTTPRedirectHandler):
    """Requests carry API keys and user tokens; urllib would forward them to any redirect target."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        old, new = urllib.parse.urlsplit(req.full_url), urllib.parse.urlsplit(newurl)
        if (new.scheme, new.hostname, new.port) != (old.scheme, old.hostname, old.port):
            raise urllib.error.HTTPError(req.full_url, code, "Redirect to another host refused", headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_opener = urllib.request.build_opener(SameHostRedirects)


def safe_urlopen(request, timeout):
    return _opener.open(request, timeout=timeout)
