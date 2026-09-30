#!/usr/bin/env bash
#
# Rehace el woff2 del wordmark de Believe: Fraunces variable (OFL) subseteada a los glifos que la
# marca usa de verdad. Deja **el mismo archivo** en los dos lugares que lo sirven:
#
#   apps/aos-extension/fonts/fraunces-wordmark.woff2   → el @font-face del popup (chrome-extension://)
#   apps/web/public/fonts/fraunces-wordmark.woff2      → el @font-face de la web (servido de /fonts)
#
#   bash scripts/subset-fraunces-wordmark.sh
#
# Por qué existe: el woff2 es un binario que se commitea, y un binario sin receta no se puede auditar.
# Esto deja la receta. No corre en CI ni en la build: la fuente ya está en el repo y se carga de ahí,
# sin llamadas a Google Fonts en runtime.
#
# Necesita `python3` (con pip) solo para esta receta; el repo no depende de fonttools en runtime.
#
# Origen: https://github.com/google/fonts/tree/main/ofl/fraunces — la misma familia que sirve la
# Google Fonts API (`family=Fraunces:opsz,wght@9..144,500`), pero desde el TTF variable fuente, que
# trae los cuatro ejes (opsz, wght, SOFT, WONK) en vez del recorte de dos ejes que sirve la API.
#
# Qué se le hace, y por qué:
#   1. SOFT=0 y WONK=1 se fijan (son los defaults del archivo, y los mismos que deja la API de
#      Google al recortar): ninguno de los dos cambia un solo contorno de la familia en esta versión,
#      así que dejarlos variables solo engordaría el gvar. Quedan **opsz y wght** variables, que son
#      los dos que el brandbook manda usar ("Fraunces 500, opsz 144").
#   2. Se subsettea a un conjunto **cerrado y explícito**: el lockup completo, los dígitos, los
#      acentos del español y los signos que el popup pinta. Nada de "todo Latin-1".
#
# Si mañana la marca pinta texto nuevo en Fraunces, se agrega el glifo acá y se vuelve a correr.

set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
ROOT="$(cd -- "$HERE/.." && pwd)"
EXT="$ROOT/apps/aos-extension/fonts"
WEB="$ROOT/apps/web/public/fonts"

SRC_TTF_URL="https://raw.githubusercontent.com/google/fonts/main/ofl/fraunces/Fraunces%5BSOFT%2CWONK%2Copsz%2Cwght%5D.ttf"
SRC_OFL_URL="https://raw.githubusercontent.com/google/fonts/main/ofl/fraunces/OFL.txt"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "bajando Fraunces variable (OFL) de google/fonts…"
curl -fsSL -o "$WORK/Fraunces-var.ttf" "$SRC_TTF_URL"
curl -fsSL -o "$WORK/OFL.txt" "$SRC_OFL_URL"

echo "instalando fonttools en un directorio temporal (no toca el repo)…"
python3 -m pip install --quiet --disable-pip-version-check --target "$WORK/py" fonttools brotli

PYTHONPATH="$WORK/py" python3 - "$WORK" <<'PY'
import os, sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

work = sys.argv[1]

# El conjunto, cerrado y a la vista. La «e» girada y el punto cian son CSS: no son glifos, así que
# acá no están.
LETRAS  = "BeAOSbyliv"      # la unión de "BeAOS" y de "by Believe" (el wordmark solo necesita Believe)
DIGITOS = "0123456789"
ESPANOL = "áéíóúüñÁÉÍÓÚÜÑ"
SIGNOS  = " .·—™€¿¡"        # el popup usa el · del footer, el — de los rangos y el ™ de AOS™
unicodes = sorted({ord(c) for c in LETRAS + DIGITOS + ESPANOL + SIGNOS})

# 1. Fijar SOFT y WONK en sus defaults; dejar opsz y wght variables.
inst = instancer.instantiateVariableFont(
    TTFont(os.path.join(work, "Fraunces-var.ttf")), {"SOFT": 0, "WONK": 1}, inplace=False
)
assert sorted(a.axisTag for a in inst["fvar"].axes) == ["opsz", "wght"], "los ejes que quedan son opsz y wght"

# 2. Subsettear.
opts = subset.Options()
opts.flavor = "woff2"                      # woff2, que es el formato que sirven los dos @font-face
opts.layout_features = ["kern", "liga", "calt", "ccmp", "locl", "mark", "mkmk", "rlig"]
opts.name_IDs = ["*"]                      # la tabla de nombres entera: la licencia y la atribución viajan
opts.notdef_outline = True
opts.recalc_bounds = True
f = inst
s = subset.Subsetter(options=opts)
s.populate(unicodes=unicodes)
s.subset(f)
f.flavor = "woff2"
out = os.path.join(work, "fraunces-wordmark.woff2")
f.save(out)

g = TTFont(out)
cm = g.getBestCmap()
faltan = [c for c in "BeAOS" + "Believe" + DIGITOS + ESPANOL if ord(c) not in cm]
if faltan:
    sys.exit(f"ERROR: el subset no cubre {faltan}")
print(f"subset:   {len(unicodes)} caracteres → {g['maxp'].numGlyphs} glifos")
print(f"ejes:     {', '.join(f'{a.axisTag} {a.minValue:g}..{a.maxValue:g}' for a in g['fvar'].axes)}")
print(f"tamaño:   {os.path.getsize(out)} bytes")
PY

for dest in "$EXT" "$WEB"; do
  mkdir -p "$dest"
  cp "$WORK/fraunces-wordmark.woff2" "$dest/fraunces-wordmark.woff2"
  cp "$WORK/OFL.txt" "$dest/OFL.txt"
done

echo "escrito:"
for dest in "$EXT" "$WEB"; do
  echo "  $dest/fraunces-wordmark.woff2  ($(wc -c < "$dest/fraunces-wordmark.woff2" | tr -d '[:space:]') bytes)"
  echo "  $dest/OFL.txt                  ($(wc -c < "$dest/OFL.txt" | tr -d '[:space:]') bytes)"
done
echo "sha256:   $(shasum -a 256 "$EXT/fraunces-wordmark.woff2" | awk '{print $1}')"
