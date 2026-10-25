#!/usr/bin/env python3
"""RideRise LK APK packager / zipalign.

Takes the aapt2-linked resource APK plus a compiled classes.dex and produces a
zip-aligned unsigned APK that apksigner can sign.

Implemented locally (no Android SDK required) so builds are reproducible in a
plain Linux container:
  * preserves aapt2's entry compression and ordering
  * stores classes.dex uncompressed and 4-byte aligned (fast dex mapping)
  * aligns every STORED entry to 4 bytes like `zipalign -p 4`
"""
import argparse
import struct
import sys
import zipfile
import zlib

STORED = zipfile.ZIP_STORED
DEFLATED = zipfile.ZIP_DEFLATED
ALIGNMENT = 4


def dos_time_date():
    # Deterministic timestamp (2026-01-01 00:00:00) for reproducible builds.
    return (0 << 9) | (0 << 5) | 1, ((2026 - 1980) << 9) | (1 << 5) | 1


def build(src_apk, dex_path, out_apk):
    time_val, date_val = dos_time_date()

    with zipfile.ZipFile(src_apk, "r") as zin:
        entries = []
        for info in zin.infolist():
            entries.append(
                {
                    "name": info.filename,
                    "data": zin.read(info.filename),
                    "compress": info.compress_type,
                    "is_dex": False,
                }
            )

    if dex_path:
        with open(dex_path, "rb") as fh:
            dex_bytes = fh.read()
        # classes.dex must be the first uncompressed, aligned dex for fast loading.
        entries.insert(
            0,
            {"name": "classes.dex", "data": dex_bytes, "compress": STORED, "is_dex": True},
        )

    central = []
    with open(out_apk, "wb") as fh:
        for entry in entries:
            name_bytes = entry["name"].encode("utf-8")
            raw = entry["data"]
            if entry["compress"] == DEFLATED and not entry["is_dex"]:
                compressor = zlib.compressobj(9, zlib.DEFLATED, -15)
                payload = compressor.compress(raw) + compressor.flush()
                method = DEFLATED
            else:
                payload = raw
                method = STORED

            crc = zlib.crc32(raw) & 0xFFFFFFFF
            offset = fh.tell()

            extra = b""
            if method == STORED:
                # Align the start of the file data: offset + 30 + len(name) + len(extra) ≡ 0 (mod 4)
                pad = (ALIGNMENT - ((offset + 30 + len(name_bytes)) % ALIGNMENT)) % ALIGNMENT
                if pad:
                    # 0xCAFE padding extra field (id, size, data)
                    extra = struct.pack("<HH", 0xCAFE, pad) + b"\x00" * pad

            local_header = struct.pack(
                "<IHHHHHIIIHH",
                0x04034B50,
                20,  # version needed
                0,
                method,
                time_val,
                date_val,
                crc,
                len(payload),
                len(raw),
                len(name_bytes),
                len(extra),
            )
            fh.write(local_header)
            fh.write(name_bytes)
            if extra:
                fh.write(extra)
            data_offset = fh.tell()
            assert method != STORED or data_offset % ALIGNMENT == 0, entry["name"]
            fh.write(payload)

            central.append(
                {
                    "name": name_bytes,
                    "method": method,
                    "crc": crc,
                    "comp_size": len(payload),
                    "uncomp_size": len(raw),
                    "offset": offset,
                    "extra": extra,
                }
            )

        central_offset = fh.tell()
        for rec in central:
            fh.write(
                struct.pack(
                    "<IHHHHHHIIIHHHHHII",
                    0x02014B50,
                    20,
                    20,
                    0,
                    rec["method"],
                    time_val,
                    date_val,
                    rec["crc"],
                    rec["comp_size"],
                    rec["uncomp_size"],
                    len(rec["name"]),
                    len(rec["extra"]),
                    0,
                    0,
                    0,
                    0,
                    rec["offset"],
                )
            )
            fh.write(rec["name"])
            if rec["extra"]:
                fh.write(rec["extra"])

        central_size = fh.tell() - central_offset
        fh.write(
            struct.pack(
                "<IHHHHIIH",
                0x06054B50,
                0,
                0,
                len(central),
                len(central),
                central_size,
                central_offset,
                0,
            )
        )

    return out_apk


def verify_alignment(apk_path):
    problems = []
    with zipfile.ZipFile(apk_path) as zf:
        for info in zf.infolist():
            if info.compress_type == STORED:
                offset = info.header_offset + 30 + len(info.filename.encode("utf-8")) + len(info.extra)
                if offset % ALIGNMENT != 0:
                    problems.append(f"{info.filename} stored at unaligned offset {offset}")
    return problems


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", required=True, help="aapt2-linked resource APK")
    parser.add_argument("--dex", default=None, help="classes.dex to embed")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    build(args.base, args.dex, args.out)
    problems = verify_alignment(args.out)
    if problems:
        print("alignment problems:", *problems, sep="\n  ", file=sys.stderr)
        return 1
    with zipfile.ZipFile(args.out) as zf:
        print(f"packaged {len(zf.infolist())} zip entries (zipalign 4-byte verified)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
