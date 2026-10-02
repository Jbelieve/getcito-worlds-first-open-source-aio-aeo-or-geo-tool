#!/usr/bin/env bash
#
# Corta un release del plugin de WordPress de BeAOS: sube la versión, arma el ZIP, etiqueta y publica.
#
#   bash scripts/release-wordpress-plugin.sh 0.2.0
#   bash scripts/release-wordpress-plugin.sh 0.2.0 --dry-run     # imprime el plan y no toca nada
#   bash scripts/release-wordpress-plugin.sh 0.2.0 --sin-push    # deja el commit local, sin empujar
#
# Los cuatro pasos, en orden:
#
#   1. sube `Version:` en la cabecera del plugin (`apps/beaos-wordpress/beaos-aos.php`), que es la única
#      fuente de la versión: la leen el nombre del ZIP, el panel de BeAOS y este script;
#   2. arma `dist/beaos-aos-<version>.zip` con `scripts/release-wordpress-plugin.mjs`;
#   3. commitea la cabecera y el changelog, y empuja;
#   4. etiqueta y publica el release de GitHub con el ZIP adjunto, reusando `scripts/gh-release.mjs
#      --wp-plugin` (la misma maquinaria del release del producto: idempotencia, tag y notas del
#      changelog).
#
# **Antes de correrlo**: escribí la sección `## <version>` en `apps/beaos-wordpress/CHANGELOG.md`. El
# script no la inventa —las notas del release salen de ahí— y falla si no está.
#
# Este script **publica** (commit, push, tag y release). Con `--dry-run` no toca nada.

set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
ROOT="$(cd -- "$HERE/.." && pwd)"
HEADER="$ROOT/apps/beaos-wordpress/beaos-aos.php"
CHANGELOG="$ROOT/apps/beaos-wordpress/CHANGELOG.md"
PACKER="$ROOT/scripts/release-wordpress-plugin.mjs"
GH_RELEASE="$ROOT/scripts/gh-release.mjs"

NUEVA=""
DRY=""
PUSH=1

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    --sin-push) PUSH=0 ;;
    -h | --help)
      sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*)
      echo "ERROR: no conozco la opción $arg" >&2
      exit 1
      ;;
    *) NUEVA="$arg" ;;
  esac
done

[ -n "$NUEVA" ] || {
  echo "ERROR: falta la versión. Uso: bash scripts/release-wordpress-plugin.sh <x.y.z> [--dry-run] [--sin-push]" >&2
  exit 1
}

if ! printf '%s' "$NUEVA" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "ERROR: la versión tiene que ser x.y.z (sin 'v' y sin sufijos): WordPress no acepta otra forma" >&2
  exit 1
fi

ACTUAL="$(node "$PACKER" --version)"
[ "$NUEVA" != "$ACTUAL" ] || {
  echo "ERROR: la cabecera del plugin ya dice $ACTUAL. Este script sube la versión: elegí la siguiente." >&2
  exit 1
}

if ! grep -qE "^## ${NUEVA}( |\$)" "$CHANGELOG"; then
  echo "ERROR: $CHANGELOG no tiene la sección '## $NUEVA'." >&2
  echo "       Escribila antes: las notas del release salen de ahí y este script no las inventa." >&2
  exit 1
fi

RAMA="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)"
if [ "$RAMA" != "master" ] && [ -z "$DRY" ]; then
  echo "AVISO: estás en la rama '$RAMA', no en master: el tag va a apuntar a un commit de esta rama." >&2
fi

if [ -n "$DRY" ]; then
  echo "[dry-run] no se toca nada. El plan, en orden:"
  echo "  1. cabecera   $HEADER"
  echo "                Version: $ACTUAL  →  Version: $NUEVA"
  echo "  2. paquete    node scripts/release-wordpress-plugin.mjs"
  echo "                → dist/beaos-aos-$NUEVA.zip"
  echo "  3. commit     git add apps/beaos-wordpress/beaos-aos.php apps/beaos-wordpress/CHANGELOG.md"
  echo "                git commit -m 'chore(wordpress): la versión $NUEVA del plugin de BeAOS'"
  if [ "$PUSH" = 1 ]; then
    echo "  4. push       git push origin HEAD   ($RAMA)"
  else
    echo "  4. push       (omitido por --sin-push)"
  fi
  echo "  5. release    node scripts/gh-release.mjs --wp-plugin"
  echo "                → tag beaos-aos-v$NUEVA y el ZIP adjunto"
  echo
  echo "Después del push, el build de BeAOS sirve el ZIP en /beaos-aos.zip y publica /beaos-aos-version.json."
  exit 0
fi

# 1 · La versión, en la cabecera. Se toca **una sola línea** (la del campo Version) y se confirma con el
# lector del propio empaquetador: si el reemplazo no dio exactamente lo esperado, se restaura el archivo.
cp "$HEADER" "$HEADER.bak"
TMP="$(mktemp)"
trap 'rm -f "$TMP" "$HEADER.bak"' EXIT

# Con `awk` y no con `sed`: en un `sed` el reemplazo sería `\1${NUEVA}` y una versión que empieza con
# dígito (`\10.2.0`) se lee como la retrorreferencia 10. Acá la versión va como variable, sin ambigüedad,
# y sólo se tocan las líneas del campo `Version` (una, en esta cabecera).
awk -v v="$NUEVA" '
  /^[[:space:]]*\*[[:space:]]*Version:/ { sub(/Version:[[:space:]]*[^[:space:]]+/, "Version: " v) }
  { print }
' "$HEADER" >"$TMP"

CAMBIOS="$(diff "$HEADER" "$TMP" | grep -c '^[<>]' || true)"
if [ "$CAMBIOS" != "2" ]; then
  echo "ERROR: esperaba exactamente una línea cambiada en la cabecera y cambiaron $CAMBIOS. No toco nada." >&2
  exit 1
fi

cat "$TMP" >"$HEADER"
if [ "$(node "$PACKER" --version)" != "$NUEVA" ]; then
  cat "$HEADER.bak" >"$HEADER"
  echo "ERROR: la cabecera no quedó en $NUEVA. Se restauró el archivo." >&2
  exit 1
fi
rm -f "$HEADER.bak"
echo "versión:  $ACTUAL  →  $NUEVA"

# 2 · El ZIP de la release.
node "$PACKER"

# 3 · El commit, y el push si corresponde. El ZIP no se commitea: lo ignora .gitignore.
git -C "$ROOT" add apps/beaos-wordpress/beaos-aos.php apps/beaos-wordpress/CHANGELOG.md
git -C "$ROOT" commit -m "chore(wordpress): la versión $NUEVA del plugin de BeAOS"

if [ "$PUSH" = 0 ]; then
  echo
  echo "Commit hecho y sin empujar (--sin-push). Para publicar el release:"
  echo "  git push origin HEAD && node scripts/gh-release.mjs --wp-plugin"
  exit 0
fi

git -C "$ROOT" push origin HEAD

# 4 · El release de GitHub, con el ZIP adjunto.
node "$GH_RELEASE" --wp-plugin

echo
echo "Listo: beaos-aos-v$NUEVA con dist/beaos-aos-$NUEVA.zip adjunto."
echo "El build de BeAOS sirve la última versión en /beaos-aos.zip (y su versión en /beaos-aos-version.json)."
