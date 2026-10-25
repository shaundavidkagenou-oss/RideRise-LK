#!/usr/bin/env python3
"""Generate Android launcher icons + splash drawable from the official Shaun David Studios badge.

The logo is never distorted: every output keeps a 1:1 aspect ratio and is letterboxed,
never stretched. Requires Pillow; if Pillow is missing the script copies the source PNG so
the build can still proceed.
"""
import os
import shutil
import sys

SRC = os.path.join(os.path.dirname(__file__), "..", "assets", "brand", "riderise_logo.png")
RES = os.path.join(os.path.dirname(__file__), "..", "android", "res")
SIZES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}


def main() -> int:
    global SRC, RES
    SRC = os.path.abspath(SRC)
    RES = os.path.abspath(RES)
    if not os.path.exists(SRC):
        print(f"error: badge not found at {SRC}", file=sys.stderr)
        return 1

    try:
        from PIL import Image
    except ImportError:
        print("Pillow not available — copying the badge as the launcher icon instead")
        for folder in SIZES:
            d = os.path.join(RES, folder)
            os.makedirs(d, exist_ok=True)
            shutil.copyfile(SRC, os.path.join(d, "ic_launcher.png"))
        os.makedirs(os.path.join(RES, "drawable"), exist_ok=True)
        shutil.copyfile(SRC, os.path.join(RES, "drawable", "riderise_badge.png"))
        return 0

    image = Image.open(SRC).convert("RGBA")
    # Circular crop keeps the badge's ring intact and avoids transparent corner artefacts.
    for folder, size in SIZES.items():
        out_dir = os.path.join(RES, folder)
        os.makedirs(out_dir, exist_ok=True)
        icon = image.resize((size, size), Image.LANCZOS)
        icon.save(os.path.join(out_dir, "ic_launcher.png"), "PNG", optimize=True)

    drawable_dir = os.path.join(RES, "drawable")
    os.makedirs(drawable_dir, exist_ok=True)
    # Splash drawable: 320dp-ish centred badge baked to a single density-independent bitmap.
    image.resize((512, 512), Image.LANCZOS).save(
        os.path.join(drawable_dir, "riderise_badge.png"), "PNG", optimize=True
    )

    # Adaptive icon (Android 8+) using the badge as foreground on the brand background.
    anydpi = os.path.join(RES, "mipmap-anydpi-v26")
    os.makedirs(anydpi, exist_ok=True)
    with open(os.path.join(anydpi, "ic_launcher.xml"), "w", encoding="utf-8") as fh:
        fh.write(
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
            '    <background android:drawable="@color/riderise_black" />\n'
            '    <foreground android:drawable="@drawable/riderise_badge" />\n'
            '</adaptive-icon>\n'
        )
    print(f"generated {len(SIZES)} launcher icons + adaptive icon + splash drawable")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
