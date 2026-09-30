#!/usr/bin/env bash
#
# Arma el zip de la release de la extensión BeAOS (Manifest V3, vanilla, sin build).
#
#   bash scripts/release-extension.sh
#
# Deja `dist/beaos-extension-<version>.zip` con **solo lo que va al paquete**: el manifest, los
# archivos de la extensión y los íconos. Nada de tests, `store/`, markdown de desarrollo ni
# `.DS_Store`. La lista es explícita a propósito: si mañana alguien agrega un archivo al directorio,
# no entra al zip por accidente.
#
# La versión sale del manifest, que es la fuente de verdad: así el nombre del zip no puede mentir.
# Esto **no publica** en la Chrome Web Store — publicar es un paso humano en el dev console.

set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
ROOT="$(cd -- "$HERE/.." && pwd)"
EXT="$ROOT/apps/aos-extension"
MANIFEST="$EXT/manifest.json"

[ -f "$MANIFEST" ] || { echo "ERROR: no encuentro $MANIFEST" >&2; exit 1; }

VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$MANIFEST" | head -n 1)"
[ -n "$VERSION" ] || { echo "ERROR: no pude leer la version de $MANIFEST" >&2; exit 1; }

# Lo que va al paquete. Lo que no está en estas dos listas, no entra.
FILES=(manifest.json background.js lib.js content-overlay.js popup.html popup.css popup.js)
DIRS=(icons)

OUT_DIR="$ROOT/dist"
OUT="$OUT_DIR/beaos-extension-$VERSION.zip"
mkdir -p "$OUT_DIR"
rm -f "$OUT"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

for f in "${FILES[@]}"; do
  [ -f "$EXT/$f" ] || { echo "ERROR: falta $EXT/$f" >&2; exit 1; }
  cp "$EXT/$f" "$STAGE/$f"
done
for d in "${DIRS[@]}"; do
  [ -d "$EXT/$d" ] || { echo "ERROR: falta $EXT/$d" >&2; exit 1; }
  cp -R "$EXT/$d" "$STAGE/$d"
done

# El `.DS_Store` de macOS se cuela solo: se barre explícitamente antes de comprimir.
find "$STAGE" -name '.DS_Store' -delete
( cd "$STAGE" && zip -q -r -X "$OUT" "${FILES[@]}" "${DIRS[@]}" )

# El overlay viaja byte por byte igual al de la extensión (regla de Jorge: "el overlay queda igual").
# Si el zip mandara otra cosa, esto lo dice y no se publica nada.
if command -v unzip >/dev/null 2>&1; then
  if ! diff -q <(unzip -p "$OUT" content-overlay.js) "$EXT/content-overlay.js" >/dev/null; then
    echo "ERROR: el content-overlay.js del zip no es identico al de apps/aos-extension" >&2
    exit 1
  fi
fi

SIZE="$(wc -c < "$OUT" | tr -d '[:space:]')"
echo "zip:      $OUT"
echo "tamaño:   $SIZE bytes ($((SIZE / 1024)) KB)"
echo "versión:  $VERSION"
echo "sha256:   $(shasum -a 256 "$OUT" | awk '{print $1}')"
echo "contenido:"
if command -v unzip >/dev/null 2>&1; then
  unzip -l "$OUT" | awk 'NR>3 && NF>=4 {printf "  %8s  %s\n", $1, $4}'
else
  ( cd "$STAGE" && ls -1 )
fi
