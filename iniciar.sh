#!/usr/bin/env sh
# Arranca la aplicacion (servidor Python) y, si GLiNER esta instalado, su servicio local. Solo escucha en 127.0.0.1.
cd "$(dirname "$0")" || exit 1
PYBIN=""
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' >/dev/null 2>&1; then PYBIN="$c"; break; fi
done
if [ -z "$PYBIN" ]; then
  echo "No se encontro Python 3.8 o superior. Modo simulacion: abra index.html en el navegador."
  echo "Para la API real o GLiNER: macOS 'brew install python', Linux 'sudo apt install python3'."
  exit 1
fi
exec "$PYBIN" jev_server.py --open "$@"
