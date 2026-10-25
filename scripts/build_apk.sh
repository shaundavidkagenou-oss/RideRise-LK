#!/usr/bin/env bash
# =============================================================================
# RideRise LK — reproducible APK build (no Android SDK / Gradle required)
#
#   ./scripts/build_apk.sh            # builds debug + signed release APKs
#   ./scripts/build_apk.sh debug      # debug only
#   ./scripts/build_apk.sh release    # signed release only
#
# Toolchain (auto-provisioned into $RIDERISE_TOOLS, default ~/.cache/riderise-apk-tools):
#   Java runtime    — jdk4py wheel (PyPI)
#   aapt2           — aaptjs3 npm package (Linux x86_64 binary)
#   android.jar     — Android API stubs from @drxiaozhi/minapk (npm)
#   d8.jar          — DEX compiler from @drxiaozhi/minapk (npm)
#   ecj.jar         — Eclipse compiler for javac-free Java builds (npm)
#   apksigner.jar   — APK Signature Scheme v1/v2/v3 signer (npm)
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-all}"
TOOLS="${RIDERISE_TOOLS:-$HOME/.cache/riderise-apk-tools}"
BUILD="$ROOT/.build"
OUT="$ROOT/release/apk"
VERSION_NAME="$(python3 -c "import json;print(json.load(open('$ROOT/config/brand.config.json'))['versionName'])")"
VERSION_CODE="$(python3 -c "import json;print(json.load(open('$ROOT/config/brand.config.json'))['versionCode'])")"
PACKAGE_ID="$(python3 -c "import json;print(json.load(open('$ROOT/config/brand.config.json'))['packageId'])")"

mkdir -p "$TOOLS" "$BUILD" "$OUT"

log() { printf '\033[1;38;5;208m▸ %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------------------
# 1. Provision the toolchain
# ---------------------------------------------------------------------------
if [ ! -x "$TOOLS/java/bin/java" ]; then
  log "Fetching Java runtime (jdk4py wheel from PyPI)"
  python3 -m pip download "jdk4py" --only-binary=:all: --platform manylinux_2_17_x86_64 \
      --python-version 311 -d "$TOOLS/jdkwhl" --no-deps -q
  rm -rf "$TOOLS/jdk-extract" && mkdir -p "$TOOLS/jdk-extract"
  python3 - "$TOOLS" <<'PY'
import glob, sys, zipfile, os, shutil
tools = sys.argv[1]
wheel = glob.glob(os.path.join(tools, "jdkwhl", "jdk4py-*.whl"))[0]
with zipfile.ZipFile(wheel) as zf:
    zf.extractall(os.path.join(tools, "jdk-extract"))
src = os.path.join(tools, "jdk-extract", "jdk4py", "java-runtime")
dst = os.path.join(tools, "java")
shutil.rmtree(dst, ignore_errors=True)
shutil.copytree(src, dst)
print("java runtime ready at", dst)
PY
fi
chmod +x "$TOOLS/java/bin/"* 2>/dev/null || true
find "$TOOLS/java" -name "jspawnhelper" -exec chmod +x {} \; 2>/dev/null || true

JAVA="$TOOLS/java/bin/java"
KEYTOOL="$TOOLS/java/bin/keytool"

if [ ! -x "$TOOLS/aapt2" ] || [ ! -f "$TOOLS/d8.jar" ]; then
  log "Fetching aapt2, d8, ecj, apksigner and android.jar (npm packages)"
  ( cd "$TOOLS" && npm init -y >/dev/null 2>&1 || true
    npm install --no-audit --no-fund --silent aaptjs3 @drxiaozhi/minapk >/dev/null )
  cp "$TOOLS/node_modules/aaptjs3/bin/x64/linux/aapt2" "$TOOLS/aapt2"
  chmod +x "$TOOLS/aapt2"
  cp "$TOOLS/node_modules/@drxiaozhi/minapk/tools/d8.jar" "$TOOLS/d8.jar"
  cp "$TOOLS/node_modules/@drxiaozhi/minapk/tools/apksigner.jar" "$TOOLS/apksigner.jar"
  cp "$TOOLS/node_modules/@drxiaozhi/minapk/tools/ecj-3.45.0.jar" "$TOOLS/ecj.jar"
  cp "$TOOLS/node_modules/@drxiaozhi/minapk/tools/android.jar" "$TOOLS/android.jar"
fi
AAPT2="$TOOLS/aapt2"
ANDROID_JAR="$TOOLS/android.jar"

# ---------------------------------------------------------------------------
# 2. Icons & bundled web assets
# ---------------------------------------------------------------------------
log "Generating launcher icons from the official Shaun David Studios badge"
if [ -x "$ROOT/.venv/bin/python" ]; then
  "$ROOT/.venv/bin/python" "$ROOT/scripts/make_icons.py"
else
  python3 "$ROOT/scripts/make_icons.py" || true
fi

log "Bundling the RideRise LK web application into APK assets"
rm -rf "$BUILD/assets" && mkdir -p "$BUILD/assets/webapp"
cp -R "$ROOT/web_app/." "$BUILD/assets/webapp/"
# Never ship build caches or editor artefacts
find "$BUILD/assets/webapp" -name '*.map' -delete
du -sh "$BUILD/assets/webapp"

# ---------------------------------------------------------------------------
# 2b. Server address compiled into the app (config/deployment.config.json)
#
# Set it with:  npm run configure:apk -- --url https://api.example.lk
# With an address, a fresh install goes straight to the welcome screen. Without one the app
# asks the rider for an address. The value becomes the string resource `default_api_base`,
# which MainActivity bridges to the web layer as RRAndroid.getApiBase().
# ---------------------------------------------------------------------------
log "Preparing resources and the built-in server address"
RES_SRC="$BUILD/res"
rm -rf "$RES_SRC" && cp -R "$ROOT/android/res" "$RES_SRC"
python3 "$ROOT/scripts/inject_api_base.py" "$ROOT" "$RES_SRC"

# ---------------------------------------------------------------------------
# 3. AAPT2 compile + link
# ---------------------------------------------------------------------------
compile_and_link() {
  local variant="$1" debuggable="$2" manifest="$BUILD/AndroidManifest-$1.xml"
  log "[$variant] Compiling resources"
  rm -rf "$BUILD/compiled-$variant.zip" "$BUILD/gen-$variant" "$BUILD/base-$variant.apk"
  "$AAPT2" compile --dir "$RES_SRC" -o "$BUILD/compiled-$variant.zip"

  python3 - "$ROOT" "$manifest" "$VERSION_CODE" "$VERSION_NAME" "$debuggable" <<'PY'
import sys, pathlib
root, out, code, name, debuggable = sys.argv[1:6]
src = pathlib.Path(root, "android", "AndroidManifest.xml").read_text()
src = src.replace("${VERSION_CODE}", code).replace("${VERSION_NAME}", name)
src = src.replace("${DEBUGGABLE_ATTR}", 'android:debuggable="true"' if debuggable == "true" else "")
pathlib.Path(out).write_text(src)
PY

  log "[$variant] Linking resources and assets with aapt2"
  "$AAPT2" link \
    -I "$ANDROID_JAR" \
    --manifest "$manifest" \
    -A "$BUILD/assets" \
    -o "$BUILD/base-$variant.apk" \
    --java "$BUILD/gen-$variant" \
    --min-sdk-version 24 \
    --target-sdk-version 34 \
    --auto-add-overlay \
    --no-version-vectors \
    "$BUILD/compiled-$variant.zip"

  # Only MainActivity.java is compiled here. PushBridge.java and RideRiseMessagingService.java
  # live next to it but import Firebase/Play Services, which this SDK-free pipeline does not
  # ship: they belong to the Gradle project in android/ (see android/firebase/README.md).
  # MainActivity reaches PushBridge reflectively, so it compiles in both pipelines.
  log "[$variant] Compiling Java (Eclipse compiler — no JDK required)"
  rm -rf "$BUILD/classes-$variant" && mkdir -p "$BUILD/classes-$variant" "$BUILD/dex-$variant"
  "$JAVA" -jar "$TOOLS/ecj.jar" \
    -source 1.8 -target 1.8 -nowarn \
    -bootclasspath "$ANDROID_JAR" \
    -cp "$BUILD/gen-$variant" \
    -d "$BUILD/classes-$variant" \
    "$ROOT/android/app/src/main/java/lk/shaunstudios/riderise/MainActivity.java" \
    $(find "$BUILD/gen-$variant" -name '*.java')

  log "[$variant] Compiling DEX with d8"
  local d8args=( --lib "$ANDROID_JAR" --min-api 24 --output "$BUILD/dex-$variant" )
  if [ "$variant" = "release" ]; then d8args+=( --release ); fi
  "$JAVA" -cp "$TOOLS/d8.jar" com.android.tools.r8.D8 "${d8args[@]}" \
    $(find "$BUILD/classes-$variant" -name '*.class')

  log "[$variant] Packaging and zip-aligning"
  python3 "$ROOT/scripts/package_apk.py" \
    --base "$BUILD/base-$variant.apk" \
    --dex "$BUILD/dex-$variant/classes.dex" \
    --out "$BUILD/unsigned-$variant.apk"
}

# ---------------------------------------------------------------------------
# 4. Signing keys (kept outside version control — see docs/BUILD_INSTRUCTIONS.md)
# ---------------------------------------------------------------------------
KEYSTORE_DIR="$ROOT/android/keystore"
mkdir -p "$KEYSTORE_DIR"
RELEASE_KS="$KEYSTORE_DIR/riderise-release.keystore"
DEBUG_KS="$KEYSTORE_DIR/riderise-debug.keystore"
CREDS="$KEYSTORE_DIR/KEYSTORE-CREDENTIALS.txt"

if [ ! -f "$RELEASE_KS" ]; then
  log "Generating release signing key (stored locally, never committed)"
  RELEASE_PASS="$(python3 -c "import secrets,string;print(''.join(secrets.choice(string.ascii_letters+string.digits) for _ in range(32)))")"
  "$KEYTOOL" -genkeypair -v -keystore "$RELEASE_KS" -storepass "$RELEASE_PASS" -keypass "$RELEASE_PASS" \
    -alias riderise -keyalg RSA -keysize 4096 -validity 10950 \
    -dname "CN=RideRise LK, OU=Mobile, O=Shaun David Studios, L=Colombo, ST=Western, C=LK" >/dev/null 2>&1
  {
    echo "RideRise LK — local release signing credentials (KEEP PRIVATE, DO NOT COMMIT)"
    echo "generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "keystore: android/keystore/riderise-release.keystore"
    echo "alias: riderise"
    echo "storepass/keypass: $RELEASE_PASS"
    echo
    echo "Back this file up in a secrets manager. Losing it means you cannot ship updates"
    echo "with the same signing identity; leaking it lets anyone publish as Shaun David Studios."
  } > "$CREDS"
  chmod 600 "$CREDS" "$RELEASE_KS"
fi

if [ ! -f "$DEBUG_KS" ]; then
  log "Generating debug signing key"
  DEBUG_PASS="android"
  "$KEYTOOL" -genkeypair -v -keystore "$DEBUG_KS" -storepass "$DEBUG_PASS" -keypass "$DEBUG_PASS" \
    -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Android Debug, O=Android, C=US" >/dev/null 2>&1
fi

RELEASE_PASS="$(grep '^storepass/keypass:' "$CREDS" | awk '{print $2}')"
DEBUG_PASS="android"

sign_apk() {
  local variant="$1" out="$2" ks pass alias
  if [ "$variant" = "release" ]; then ks="$RELEASE_KS"; pass="$RELEASE_PASS"; alias="riderise";
  else ks="$DEBUG_KS"; pass="$DEBUG_PASS"; alias="androiddebugkey"; fi
  log "[$variant] Signing with apksigner (v2 + v3; v1 is unnecessary at minSdk 24)"
  rm -f "$out"
  "$JAVA" -jar "$TOOLS/apksigner.jar" sign \
    --ks "$ks" --ks-key-alias "$alias" --ks-pass "pass:$pass" --key-pass "pass:$pass" \
    --min-sdk-version 24 --max-sdk-version 34 \
    --out "$out" "$BUILD/unsigned-$variant.apk" 2>&1 | grep -v 'WARNING' || true
  "$JAVA" -jar "$TOOLS/apksigner.jar" verify --print-certs --min-sdk-version 24 "$out" 2>&1 | grep -v 'WARNING'
}

build_variant() {
  local variant="$1"
  if [ "$variant" = "release" ]; then compile_and_link release false; else compile_and_link debug true; fi
  local out="$OUT/riderise-lk-phase2-$variant.apk"
  sign_apk "$variant" "$out"
  ls -la "$out"
  python3 - "$out" <<'PY'
import sys, zipfile, hashlib
path = sys.argv[1]
with open(path, "rb") as fh:
    digest = hashlib.sha256(fh.read()).hexdigest()
with zipfile.ZipFile(path) as zf:
    names = zf.namelist()
print(f"SHA-256 {digest}")
print(f"entries: {len(names)} | dex: {[n for n in names if n.endswith('.dex')]} | manifest: {'AndroidManifest.xml' in names}")
PY
}

case "$TARGET" in
  debug)   build_variant debug ;;
  release) build_variant release ;;
  all)     build_variant debug; build_variant release ;;
  *) echo "usage: $0 [debug|release|all]" >&2; exit 1 ;;
esac

log "APK build complete → $OUT"
