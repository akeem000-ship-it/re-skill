#!/bin/bash
# MTenn3D for Windows: build.sh VERSION [private|shareable] [OUT.exe] [linux]
#   private    carries your ROMs (../../rom, ../../../mario-golf-gbc/rom), the recompiled code (web/gen) and mods (web/mods): keep it to yourself
#   shareable  none of them: each game asks for its own ROM once (it is remembered)
# The files are put together in site/ (as the Android app's assets), then embedded; site/ is never committed.
set -e
V=${1:?version}; KIND=${2:-private}; OUT=$(realpath -m "${3:-MTenn3D.exe}")
cd "$(dirname "$0")"; P=../..; G=$P/../mario-golf-gbc
rm -rf site && mkdir -p site/web site/golf/web
EX="--exclude=./tests"; [ "$KIND" = shareable ] && EX="$EX --exclude=./gen --exclude=./mods"
(cd $P/web && tar cf - $EX .) | (cd site/web && tar xf -)
(cd $G/web && tar cf - --exclude=./tests .) | (cd site/golf/web && tar xf -)
if [ "$KIND" = private ]; then
  mkdir -p site/rom site/golf/rom
  cp $P/rom/*.gbc site/rom/ 2>/dev/null || true
  cp $G/rom/*.gbc site/golf/rom/ 2>/dev/null || true
fi
if [ "$KIND" = shareable ] && find site \( -iname '*.gbc' -o -iname '*.gb' -o -path '*/web/gen*' -o -path '*/web/mods*' -o -path '*/rom/*' \) | grep -q .; then
  echo "shareable build would carry game data: stopped"; rm -rf site; exit 1
fi
if [ "$4" = linux ]; then go build -o "$OUT" .
else GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-H windowsgui -s -w -X main.version=$V" -o "$OUT" .; fi
rm -rf site
ls -la "$OUT"
