#!/usr/bin/env python3
"""Create an origin-scoped Apple Music JWT without uploading the private key."""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import time
import urllib.parse


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--team-id", required=True)
    parser.add_argument("--key-id", required=True)
    parser.add_argument("--private-key", required=True, type=Path)
    parser.add_argument("--origin", required=True, help="Exact app origin, e.g. https://rockshowbot.onrender.com")
    parser.add_argument("--days", default=30, type=int, choices=range(1, 181), metavar="1..180")
    parser.add_argument("--output", type=Path, default=Path(".apple-music-token"))
    args = parser.parse_args()
    try:
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
    except ImportError:
        parser.error("Install the signing helper dependency: python -m pip install -r scripts/requirements-token.txt")
    if not all(re.fullmatch(r"[A-Z0-9]{10}", value) for value in (args.team_id, args.key_id)):
        parser.error("Team ID and Key ID must each contain 10 uppercase letters/digits")
    origin = args.origin.rstrip("/")
    url = urllib.parse.urlsplit(origin)
    if (not url.netloc or url.path or url.query or url.fragment or url.username or url.password
            or not (url.scheme == "https" or (url.scheme == "http" and url.hostname in ("localhost", "127.0.0.1", "::1")))):
        parser.error("Use an HTTPS origin without a path (HTTP is allowed for local development)")
    try:
        key = serialization.load_pem_private_key(args.private_key.read_bytes(), password=None)
    except (OSError, ValueError, TypeError):
        parser.error("Cannot read the MusicKit private key; use the .p8 downloaded from Apple")
    if not isinstance(key, ec.EllipticCurvePrivateKey) or not isinstance(key.curve, ec.SECP256R1):
        parser.error("The MusicKit private key must use P-256 (ES256)")
    encode = lambda value: base64.urlsafe_b64encode(value).rstrip(b"=")
    now = int(time.time())
    header = {"alg": "ES256", "kid": args.key_id, "typ": "JWT"}
    claims = {"iss": args.team_id, "iat": now - 30, "exp": now + args.days * 86400, "origin": [origin]}
    payload = b".".join(encode(json.dumps(value, separators=(",", ":")).encode()) for value in (header, claims))
    r, s = decode_dss_signature(key.sign(payload, ec.ECDSA(hashes.SHA256())))
    token = payload + b"." + encode(r.to_bytes(32, "big") + s.to_bytes(32, "big"))
    try:
        descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as output:
            output.write(token + b"\n")
    except OSError:
        parser.error("Cannot create the output file. It must not already exist; choose another --output")
    print(f"Developer token written to {args.output}. Valid for {args.days} day(s). Keep the .p8 private.")


if __name__ == "__main__":
    main()
