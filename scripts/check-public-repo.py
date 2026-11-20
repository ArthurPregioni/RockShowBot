#!/usr/bin/env python3
"""Offline review of distributable files; prints locations, never matched secrets."""
from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent
SECRET_PATTERNS = {
    "private-key": rb"-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----",
    "github-token": rb"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b",
    "google-api-key": rb"\bAIza[0-9A-Za-z_-]{35}\b",
    "aws-access-key": rb"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b",
    "slack-token": rb"\bxox[baprs]-[0-9A-Za-z-]{20,}\b",
    "jwt": rb"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\b",
    "password-hash": rb"\bscrypt:[0-9a-f]{16,}:[0-9a-f]{64,}\b",
    "database-export": rb"\"format\"\s*:\s*\"rockshowbot-web-sqlite-v1\"",
}
PATTERNS = {name: re.compile(pattern) for name, pattern in SECRET_PATTERNS.items()}
RUNTIME_DIRECTORIES = {"node_modules", ".wrangler", ".sites-runtime", ".cache", "__pycache__", ".extension-build", ".next", ".vinext", ".venv"}
# Configuration, credentials and tunnel settings an installation keeps outside the checkout.
PRIVATE_NAMES = {".env", ".dev.vars", "node.env", "server.env", "login.txt", "bridge.json"}
# Blobs pushed before a rule existed. Listing one here does not make it private again: it is still
# reported on every run, without failing it, until history is rewritten and the entry removed.
PUBLISHED_HISTORY = {
    "55b701b1325d164430ed458a4957cb1a5e4d0654",  # .openai/hosting.json
    "ad6847e10a20cc2ba29ae42abe2e89c41a3b76f0",  # hosted/.openai/hosting.json
}


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", *args], cwd=ROOT)


def private_path(name: str) -> bool:
    path = Path(name)
    if path.name.endswith((".example", ".sample")):
        return False
    return (
        path.name in PRIVATE_NAMES
        or path.name.startswith((".env.", ".dev.vars.", ".apple-music-token"))
        or path.suffix in {".p8", ".pem", ".key", ".db", ".sqlite", ".sqlite3"}
        or path.parts[-2:] == (".openai", "hosting.json")
        or bool(RUNTIME_DIRECTORIES.intersection(path.parts))
    )


def scan_content(name: str, content: bytes) -> list[str]:
    findings = []
    for kind, pattern in PATTERNS.items():
        for match in pattern.finditer(content):
            line = content[:match.start()].count(b"\n") + 1
            findings.append(f"{name}:{line}: {kind}")
    return findings


def local_links(name: str, content: str) -> list[str]:
    findings = []
    # Inline Markdown links; remote links and anchors do not require network.
    for match in re.finditer(r"\]\(([^)\n]+)\)", content):
        link = match.group(1).strip().strip("<>")
        if urlsplit(link).scheme or link.startswith(("#", "/")):
            continue
        target = unquote(link.split("#", 1)[0])
        if not target:
            continue
        path = (ROOT / name).parent / target
        if not path.exists():
            line = content[:match.start()].count("\n") + 1
            findings.append(f"{name}:{line}: broken local documentation link")
    return findings


def scan_history() -> tuple[int, list[str], list[str]]:
    # Deduplicate blobs before reading; old tree names are sufficient to locate findings.
    objects = {}
    for row in git("rev-list", "--objects", "--all").decode().splitlines():
        oid, _, name = row.partition(" ")
        if name:
            objects[oid] = name
    findings, published = [], []
    process = subprocess.Popen(["git", "cat-file", "--batch"], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    blobs = 0
    try:
        for oid, name in objects.items():
            process.stdin.write((oid + "\n").encode())
            process.stdin.flush()
            header = process.stdout.readline().decode().split()
            if len(header) != 3:
                raise RuntimeError("Git could not read a history object")
            size = int(header[2])
            content = process.stdout.read(size)
            process.stdout.read(1)
            if header[1] == "blob":
                blobs += 1
                # Deleting a private file from the last commit leaves it readable in every clone.
                if private_path(name):
                    (published if oid in PUBLISHED_HISTORY else findings).append(f"history {oid[:12]}:{name}: private/runtime file")
                findings.extend(scan_content(f"history {oid[:12]}:{name}", content))
    finally:
        process.stdin.close()
        process.stdout.close()
        process.wait()
    return blobs, findings, published


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--history", action="store_true", help="Also scan all locally available Git history blobs for credential patterns")
    args = parser.parse_args()
    names = sorted(set(git("ls-files", "--cached", "--others", "--exclude-standard", "-z").decode().split("\0")) - {""})
    findings = []
    checked = 0
    for name in names:
        path = ROOT / name
        if not path.is_file():  # Unstaged deletions are not distributed.
            continue
        checked += 1
        if private_path(name):
            findings.append(f"{name}: private/runtime file in distributable sources")
        content = path.read_bytes()
        findings.extend(scan_content(name, content))
        if path.suffix == ".md":
            findings.extend(local_links(name, content.decode("utf-8")))
        if path.suffix == ".json" and name not in {"package-lock.json"}:
            try:
                data = json.loads(content)
            except (ValueError, UnicodeDecodeError):
                findings.append(f"{name}: invalid JSON")
                continue
            if name == ".openai/hosting.example.json" and data.get("project_id"):
                findings.append(f"{name}: example must not contain a registered Site identity")
    blobs, published = 0, []
    if args.history:
        blobs, history_findings, published = scan_history()
        findings.extend(history_findings)
    for finding in findings:
        print(finding)
    for finding in published:
        print(finding + " (already published; listed in PUBLISHED_HISTORY)")
    print(f"Reviewed {checked} distributable files" + (f" and {blobs} history blobs" if args.history else "") + f"; {len(findings)} finding(s)"
          + (f", {len(published)} already published" if published else "") + ".")
    return int(bool(findings))


if __name__ == "__main__":
    raise SystemExit(main())
