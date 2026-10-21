#!/usr/bin/env sh
# Instalacion OPCIONAL del modulo GLiNER2. Requiere Python >= 3.10 e internet (descarga PyTorch y el modelo: varios cientos de MB).
cd "$(dirname "$0")" || exit 1
PYBIN=""
for c in python3 python; do command -v "$c" >/dev/null 2>&1 && PYBIN="$c" && break; done
[ -n "$PYBIN" ] || { echo "No se encontro Python 3."; exit 1; }
"$PYBIN" -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)" || { echo "Se necesita Python 3.10 o superior."; exit 1; }
if [ "$(uname -s)" = "Darwin" ]; then
  GLENV="${JEV_GLINER_ENV:-$HOME/Library/Application Support/JEV/gliner_env}"
else
  GLENV="${JEV_GLINER_ENV:-${XDG_DATA_HOME:-$HOME/.local/share}/JEV/gliner_env}"
fi
GLPY="$GLENV/bin/python"
echo "Instalando GLiNER en: $GLENV"
[ -x "$GLPY" ] || "$PYBIN" -m venv "$GLENV" || { echo "No se pudo crear el entorno virtual (Debian/Ubuntu: sudo apt install python3-venv)."; exit 1; }
"$GLPY" -m pip install --upgrade pip && "$GLPY" -m pip install "gliner2[local]" || { echo "La instalacion fallo."; exit 1; }
echo; echo "Comprobacion:"; "$GLPY" gliner_service.py --check || { echo "Las dependencias no cargan. Revise el error anterior."; exit 1; }
echo; echo "Prueba con el modelo real (la primera vez descarga el modelo):"; "$GLPY" gliner_service.py --selftest || { echo "La prueba del modelo fallo. Revise el error anterior."; exit 1; }
"$GLPY" -c "import os,sys;from pathlib import Path;Path('gliner_python.txt').write_text(os.path.abspath(sys.executable)+'\n',encoding='utf-8')" || { echo "No se pudo guardar la ruta del entorno."; exit 1; }
echo; echo "Hecho. Ejecute: sh iniciar.sh   (arranca tambien el servicio GLiNER)"
echo "Si ya dispone del modelo en una carpeta (p. ej. la de Atlas-Abstracts-USB), escriba su ruta en la primera linea de gliner_model.txt."
