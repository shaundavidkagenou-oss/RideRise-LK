#!/usr/bin/env python3
"""Inject the built-in server address into an Android values file.

Used by scripts/build_apk.sh (SDK-free pipeline). The Gradle build does the same thing with
`resValue` in android/app/build.gradle.kts, reading the same config/deployment.config.json.
"""
import json
import pathlib
import sys
import xml.sax.saxutils as sx


def load_api_base(root: pathlib.Path) -> str:
    cfg = root / "config" / "deployment.config.json"
    if not cfg.is_file():
        return ""
    try:
        data = json.loads(cfg.read_text())
    except Exception as err:  # noqa: BLE001 - surfaced to the build log
        sys.exit(f"config/deployment.config.json is not valid JSON: {err}")
    return str(data.get("apiBaseUrl") or "").strip().rstrip("/")


def validate(base: str) -> None:
    """Refuse a value the shipped app could never use."""
    if not base:
        return
    if not base.startswith("https://"):
        sys.exit(
            f"Refusing to build: the built-in server address must start with https:// (got {base}).\n"
            "The app blocks cleartext HTTP and runs on a virtual HTTPS origin. Fix it with:\n"
            "  npm run configure:apk -- --url https://your-server"
        )
    host_and_path = base[len("https://"):]
    if "/" in host_and_path or not host_and_path:
        sys.exit(
            f"Refusing to build: the built-in server address must be a bare host with no path (got {base})."
        )
    if any(c.isspace() for c in base):
        sys.exit(f"Refusing to build: the built-in server address contains whitespace (got {base}).")


def write_values(res_dir: pathlib.Path, base: str) -> None:
    values = res_dir / "values"
    values.mkdir(parents=True, exist_ok=True)
    (values / "deployment.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<!-- Generated from config/deployment.config.json. Do not edit; run `npm run configure:apk`. -->\n"
        "<resources>\n"
        f'  <string name="default_api_base">{sx.escape(base)}</string>\n'
        "</resources>\n"
    )


def main(argv) -> int:
    if len(argv) != 3:
        print("usage: inject_api_base.py <repo-root> <res-dir>", file=sys.stderr)
        return 2
    root = pathlib.Path(argv[1]).resolve()
    res_dir = pathlib.Path(argv[2]).resolve()
    base = load_api_base(root)
    validate(base)
    write_values(res_dir, base)
    print(f"built-in server: {base}" if base else "built-in server: none (the app asks on first launch)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
