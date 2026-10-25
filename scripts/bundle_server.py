#!/usr/bin/env python3
"""Bundle exactly what the backend needs into one uploadable ZIP.

A hosting panel gives you a file manager and a console, not a dev machine. The full repository
is 16 MB and mostly Android build output; the running server needs about 5 MB of it. This builds
`release/server/riderise-server.zip` with only the files `backend/server.js` reads at runtime:

    backend/   config/   web_app/   assets/brand/   deploy/panel/start.sh
    package.json  package-lock.json  docs/DEPLOY_AND_BAKE.md  README.md

It refuses to include secrets: `.env`, SQLite databases, keystores and `google-services.json`
are never added, and the script fails loudly if one sneaks into the list.

Usage
    python3 scripts/bundle_server.py               # write release/server/riderise-server.zip
    python3 scripts/bundle_server.py --list        # show what would go in (no file written)
    python3 scripts/bundle_server.py --out /tmp/x.zip --include-apk
"""

from __future__ import annotations

import argparse
import os
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

INCLUDE_DIRS = [
    "backend",
    "config",
    "web_app",
    "assets/brand",
    "deploy",
    "docs",
]
INCLUDE_FILES = [
    "package.json",
    "package-lock.json",
    "README.md",
]

# Never uploaded: source-control noise, build output, local state and anything secret.
SKIP_DIR_NAMES = {
    ".git",
    ".build",
    ".github",
    "node_modules",
    "tests",
    "android",
    "release",
    "__pycache__",
}
SKIP_SUFFIXES = (".sqlite", ".sqlite-shm", ".sqlite-wal", ".log", ".zip")
SECRET_NAMES = {".env", "google-services.json", "KEYSTORE-CREDENTIALS.txt"}
SECRET_PREFIXES = (".env.",)
SECRET_SUFFIXES = (".keystore", ".jks", ".pem", ".key")

# Docs are optional on a server; keep the whole folder (it is small) so error messages that
# point at docs/FIREBASE_AUTH.md still resolve when someone reads the files over SFTP.
MAX_BYTES = 40 * 1024 * 1024


def is_secret(name: str) -> bool:
    return (
        name in SECRET_NAMES
        or name.startswith(SECRET_PREFIXES)
        or name.endswith(SECRET_SUFFIXES)
    )


def collect(include_apk: bool = False):
    """Return (included, skipped_secrets) as lists of (relative path, size)."""
    included = []
    secrets = []

    for rel in INCLUDE_DIRS:
        base = ROOT / rel
        if not base.exists():
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIR_NAMES)
            for filename in sorted(filenames):
                full = Path(dirpath) / filename
                relpath = full.relative_to(ROOT).as_posix()
                if is_secret(filename):
                    secrets.append((relpath, full.stat().st_size))
                    continue
                if filename.endswith(SKIP_SUFFIXES):
                    continue
                included.append((relpath, full.stat().st_size))

    for rel in INCLUDE_FILES:
        full = ROOT / rel
        if full.exists():
            included.append((rel, full.stat().st_size))

    if include_apk:
        apk_dir = ROOT / "release" / "apk"
        if apk_dir.exists():
            for apk in sorted(apk_dir.glob("*.apk")):
                included.append((f"release/apk/{apk.name}", apk.stat().st_size))

    included.sort()
    return included, secrets


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Build the server upload bundle.")
    parser.add_argument("--out", default=str(ROOT / "release" / "server" / "riderise-server.zip"))
    parser.add_argument("--list", action="store_true", help="print the file list and exit")
    parser.add_argument("--include-apk", action="store_true", help="also ship the signed APKs")
    args = parser.parse_args(argv)

    included, secrets = collect(include_apk=args.include_apk)
    total = sum(size for _, size in included)

    if args.list:
        for relpath, size in included:
            print(f"{size:>9}  {relpath}")
        print(f"\n{len(included)} files, {total / 1048576:.1f} MB uncompressed")
        if secrets:
            print(f"left out {len(secrets)} secret-looking file(s): {', '.join(p for p, _ in secrets)}")
        return 0

    if not any(p == "backend/server.js" for p, _ in included):
        print("ERROR: backend/server.js is missing — run this from the repository.", file=sys.stderr)
        return 1
    if total > MAX_BYTES:
        print(f"ERROR: bundle would be {total / 1048576:.1f} MB — larger than the 40 MB upload limit most panels allow.", file=sys.stderr)
        return 1

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for relpath, _ in included:
            zf.write(ROOT / relpath, arcname=relpath)

    size = out.stat().st_size
    print(f"Wrote {out}")
    print(f"  {len(included)} files, {total / 1048576:.1f} MB uncompressed -> {size / 1048576:.1f} MB zip")
    if secrets:
        print(f"  left out {len(secrets)} secret-looking file(s): {', '.join(p for p, _ in secrets)}")
    print("")
    print("Upload it with the panel's Files -> Upload, then in the console:")
    print("  cd /home/container && unzip -o riderise-server.zip && ls")
    print("Then set the startup command to:  bash /home/container/deploy/panel/start.sh")
    print("Guide: docs/DEPLOY_AND_BAKE.md (or docs/SERVER_SETUP_WALKTHROUGH.md for a click-by-click walkthrough)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
