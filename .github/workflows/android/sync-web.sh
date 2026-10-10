#!/bin/sh
# Copies the web app (parent folder) into the APK's assets. sw.js is skipped on purpose:
# inside the app a service worker would only cache old files and block updates.
set -e
cd "$(dirname "$0")"
DEST=app/src/main/assets/www
rm -rf "$DEST" && mkdir -p "$DEST"
for f in ../*.html ../*.js ../*.json; do
  [ "$(basename "$f")" = "sw.js" ] && continue
  cp "$f" "$DEST/"
done
cp -r ../icons "$DEST/icons"
cp -r ../img "$DEST/img"
echo "Web files copied to $DEST"
