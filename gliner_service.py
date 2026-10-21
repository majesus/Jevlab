#!/usr/bin/env python3
"""Servicio local GLiNER2 para JEV // System One Playground.

    python gliner_service.py              # arranca en http://127.0.0.1:8765
    python gliner_service.py --check      # diagnostica el entorno sin cargar el modelo
    python gliner_service.py --selftest   # carga el modelo y extrae entidades de un texto de prueba
    python gliner_service.py --watch-parent   # (lo usa jev_server.py) termina cuando el proceso padre cierra la entrada estándar

Solo escucha en 127.0.0.1. La aplicación web no lo llama directamente: lo hace a través de jev_server.py (/api/gliner, mismo origen).

Modelo (por orden de prioridad):
  1. variable de entorno GLINER2_MODEL (ruta a una carpeta o identificador de Hugging Face)
  2. primera línea útil de gliner_model.txt: ruta a una carpeta con el modelo (p. ej. la de Atlas-Abstracts-USB); se ignoran las líneas vacías y las que empiezan por #
  3. ./models/gliner2.5-base-v1 si existe
  4. fastino/gliner2.5-base-v1 (se descarga la primera vez; requiere internet)

Mismo contrato de integridad que Atlas: no se fabrican desplazamientos. Cada entidad se comprueba contra el texto original y
se descarta si text[start:end] no coincide con el literal devuelto por el modelo.
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE = Path(__file__).resolve().parent
HOST = "127.0.0.1"
try:
    PORT = int(os.getenv("JEV_GLINER_PORT", "8765") or "8765")
except ValueError:
    PORT = 8765
DEFAULT_MODEL = "fastino/gliner2.5-base-v1"
MAX_BODY_BYTES = 1_048_576      # 1 MiB
MAX_TEXT_CHARS = 100_000
MAX_LABELS = 30
MAX_LABEL_CHARS = 80
MAX_DESC_CHARS = 600
ALLOWED_HOSTS = {"localhost", "127.0.0.1", "[::1]"}
SELFTEST_TEXT = ("This study extends UTAUT2 with perceived risk to explain the behavioral intention of university "
                 "teachers to adopt ChatGPT. A questionnaire was administered to 410 respondents and analysed with PLS-SEM.")
SELFTEST_LABELS = {
    "modelo_teorico": "Named theory or model of technology acceptance, such as TAM2, UTAUT2 or TPB.",
    "constructo": "Explicit theoretical construct, such as perceived usefulness, trust or behavioral intention.",
    "tecnica_analisis": "Explicit research analysis method, such as PLS-SEM or regression.",
    "muestra": "Explicit numeric sample size and sampled unit, such as 410 respondents.",
}

_model = None
_extractor_class = None
_model_lock = threading.Lock()
_load_error: str | None = None


def default_threshold() -> float:
    try:
        return min(1.0, max(0.0, float(os.getenv("GLINER2_THRESHOLD", "0.60"))))
    except ValueError:
        return 0.60


def resolve_model() -> str:
    env = os.getenv("GLINER2_MODEL", "").strip()
    if env:
        return env
    pointer = BASE / "gliner_model.txt"
    if pointer.is_file():
        try:
            for raw in pointer.read_text(encoding="utf-8-sig").splitlines():
                line = raw.strip().strip('"')
                if line and not line.startswith("#"):  # se ignoran líneas vacías y comentarios
                    return line
        except OSError:
            pass
    local = BASE / "models" / "gliner2.5-base-v1"
    if (local / "config.json").is_file():
        return str(local)
    return DEFAULT_MODEL


def model_is_local(name: str) -> bool:
    return Path(name).is_dir()


def gliner_installed() -> bool:
    try:
        return importlib.util.find_spec("gliner2") is not None
    except (ImportError, ValueError):
        return False


def get_model():
    """Carga perezosa y serializada. Con una carpeta local se fuerza el modo sin conexión a Hugging Face."""
    global _model, _load_error
    with _model_lock:
        if _model is not None:
            return _model
        name = resolve_model()
        if model_is_local(name):
            os.environ.setdefault("HF_HUB_OFFLINE", "1")
            os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
        os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
        os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
        import warnings
        warnings.filterwarnings("ignore", message=r".*legacy list-valued extra_special_tokens.*", category=UserWarning)
        warnings.filterwarnings("ignore", message=r".*torch\.jit\.script.*is deprecated.*", category=FutureWarning)
        warnings.filterwarnings("ignore", message=r".*Encoder rejected attn_implementation.*", category=RuntimeWarning)
        t0 = time.perf_counter()
        print(f"GLiNER2: cargando modelo {name} (primera carga; puede tardar)…", flush=True)
        try:
            if _extractor_class is None:
                from gliner2 import AutoExtractor
                cls = AutoExtractor
            else:
                cls = _extractor_class
            _model = cls.from_pretrained(name)
        except Exception as exc:  # noqa: BLE001 — se informa al cliente, no se oculta
            _load_error = f"{type(exc).__name__}: {exc}"[:400]
            raise
        _load_error = None
        print(f"GLiNER2: modelo cargado ({time.perf_counter() - t0:.1f} s)", flush=True)
        return _model


def health() -> dict:
    name = resolve_model()
    return {
        "ok": True,
        "service": "jev-gliner",
        "gliner2_installed": gliner_installed(),
        "runtime_ready": _extractor_class is not None,
        "model": name,
        "model_is_local": model_is_local(name),
        "model_loaded": _model is not None,
        "load_error": _load_error,
        "python": sys.version.split()[0],
        "default_threshold": default_threshold(),
    }


def validate_request(payload) -> tuple[str, dict[str, str], float]:
    if not isinstance(payload, dict):
        raise ValueError("El cuerpo debe ser un objeto JSON.")
    text = payload.get("text")
    if not isinstance(text, str) or not text.strip():
        raise ValueError("'text' debe ser un texto no vacío.")
    if len(text) > MAX_TEXT_CHARS:
        raise ValueError(f"'text' supera el máximo de {MAX_TEXT_CHARS} caracteres.")
    labels = payload.get("labels")
    if not isinstance(labels, dict) or not labels:
        raise ValueError("'labels' debe ser un objeto {etiqueta: descripción} con al menos una etiqueta.")
    if len(labels) > MAX_LABELS:
        raise ValueError(f"Se admiten como máximo {MAX_LABELS} etiquetas.")
    clean: dict[str, str] = {}
    for name, desc in labels.items():
        if not isinstance(name, str) or not name.strip() or len(name) > MAX_LABEL_CHARS:
            raise ValueError(f"Nombre de etiqueta inválido (1–{MAX_LABEL_CHARS} caracteres).")
        if desc is None:
            desc = ""
        if not isinstance(desc, str) or len(desc) > MAX_DESC_CHARS:
            raise ValueError(f"La descripción de «{name[:30]}» debe ser texto de hasta {MAX_DESC_CHARS} caracteres.")
        clean[name.strip()] = desc.strip()
    threshold = payload.get("threshold", default_threshold())
    if isinstance(threshold, bool) or not isinstance(threshold, (int, float)) or not (0.0 <= float(threshold) <= 1.0):
        raise ValueError("'threshold' debe ser un número entre 0 y 1.")
    return text, clean, float(threshold)


def run_extraction(extractor, text: str, labels: dict[str, str], threshold: float) -> tuple[list[dict], int]:
    """Llama al modelo y devuelve (entidades verificadas, nº de descartadas)."""
    method = getattr(extractor, "extract_entities_long", None)
    kwargs: dict = {"include_spans": True, "include_confidence": True}
    if method is not None:
        kwargs.update({"chunk_size": 384, "chunk_overlap": 64})
    else:
        method = extractor.extract_entities
    try:  # la documentación de gliner2 no declara `threshold` en estos métodos; se intenta y se filtra además aquí.
        result = method(text, labels, threshold=threshold, **kwargs)
    except TypeError:
        result = method(text, labels, **kwargs)

    entities = result.get("entities", {}) if isinstance(result, dict) else {}
    found: dict[tuple, dict] = {}
    dropped = 0
    if isinstance(entities, dict):
        for label, items in entities.items():
            for item in (items if isinstance(items, list) else [items]):
                if not isinstance(item, dict):
                    dropped += 1
                    continue
                try:
                    start, end = int(item["start"]), int(item["end"])
                except (KeyError, TypeError, ValueError):
                    dropped += 1
                    continue
                if not (0 <= start < end <= len(text)):
                    dropped += 1
                    continue
                literal = text[start:end]
                if item.get("text") is not None and str(item["text"]) != literal:
                    dropped += 1
                    continue
                conf = item.get("confidence")
                try:
                    conf = None if conf is None else round(float(conf), 4)
                except (TypeError, ValueError):
                    conf = None
                if conf is not None and conf < threshold:
                    continue
                found[(label, start, end)] = {"label": label, "text": literal, "start": start, "end": end,
                                              "confidence": conf, "source": "gliner2-local"}
    return sorted(found.values(), key=lambda e: (e["start"], e["end"], e["label"])), dropped


class Handler(BaseHTTPRequestHandler):
    server_version = "JevGliner/1.0"
    timeout = 30  # evita conexiones colgadas

    def log_message(self, fmt, *args):  # noqa: D401 — sin cuerpos ni textos en el registro (privacidad)
        pass

    def _host_ok(self) -> bool:
        host = (self.headers.get("Host") or "").lower()
        hostname = re.sub(r":\d+$", "", host)
        return hostname in ALLOWED_HOSTS

    def _send(self, status: int, body: dict, extra: dict | None = None):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):  # noqa: N802
        if not self._host_ok():
            return self._send(403, {"error": "Host no autorizado."})
        if self.path.split("?", 1)[0] == "/health":
            return self._send(200, health())
        self._send(404, {"error": "No encontrado."})

    def do_POST(self):  # noqa: N802
        if not self._host_ok():
            return self._send(403, {"error": "Host no autorizado."})
        if self.path.split("?", 1)[0] != "/extract":
            return self._send(404, {"error": "No encontrado."})
        if not (self.headers.get("Content-Type") or "").lower().startswith("application/json"):
            return self._send(415, {"error": "Content-Type debe ser application/json."})
        length_header = self.headers.get("Content-Length")
        if length_header is None or not length_header.isdigit():
            return self._send(411, {"error": "Se requiere Content-Length."})
        length = int(length_header)
        if length > MAX_BODY_BYTES:
            return self._send(413, {"error": "Cuerpo demasiado grande."})
        raw = self.rfile.read(length)
        try:
            text, labels, threshold = validate_request(json.loads(raw.decode("utf-8")))
        except (ValueError, UnicodeDecodeError) as exc:  # json.JSONDecodeError es subclase de ValueError
            return self._send(422, {"error": str(exc) if not isinstance(exc, UnicodeDecodeError) else "El cuerpo no es UTF-8 válido."})
        if not gliner_installed():
            return self._send(503, {"error": "El paquete gliner2 no está instalado.",
                                    "hint": 'Ejecute INSTALAR_GLINER (o: pip install "gliner2[local]") y reinicie el servicio.'})
        if _extractor_class is None and _load_error:
            return self._send(503, {"error": "Las dependencias de GLiNER no pudieron inicializarse.",
                                    "detail": _load_error,
                                    "hint": "Revise la instalación con gliner_service.py --check y reinicie el servicio."})
        t0 = time.perf_counter()
        try:
            extractor = get_model()
            with _model_lock:  # inferencia serializada
                entities, dropped = run_extraction(extractor, text, labels, threshold)
        except Exception as exc:  # noqa: BLE001
            msg = f"{type(exc).__name__}: {exc}"[:400]
            return self._send(500, {"error": "Fallo al cargar o ejecutar el modelo GLiNER2.", "detail": msg})
        self._send(200, {"engine": "gliner2-local", "model": resolve_model(), "entities": entities, "dropped": dropped,
                         "elapsed_ms": int((time.perf_counter() - t0) * 1000), "chars": len(text), "threshold": threshold,
                         "offsets": "codepoints"})


def cmd_check() -> int:
    print(f"Python {sys.version.split()[0]} ({sys.executable})")
    ok = gliner_installed()
    print("gliner2:", "instalado" if ok else 'NO instalado → pip install "gliner2[local]"')
    name = resolve_model()
    print("Modelo:", name)
    if model_is_local(name):
        p = Path(name)
        weights = sorted(p.glob("*.safetensors")) + sorted(p.glob("*.bin"))
        print("  carpeta local:", "OK" if (p / "config.json").is_file() else "FALTA config.json")
        print("  pesos:", ", ".join(f"{w.name} ({w.stat().st_size / 1e6:.0f} MB)" for w in weights) or "NO encontrados")
    else:
        print("  se descargará de Hugging Face la primera vez (requiere internet; son varios cientos de MB)")
    try:
        import torch  # noqa: F401
        print("torch:", torch.__version__)
    except Exception as exc:  # noqa: BLE001
        print("torch: NO disponible →", type(exc).__name__)
        ok = False
    if ok:
        try:
            from gliner2 import AutoExtractor
            print("Importación completa de GLiNER2: OK")
        except Exception as exc:  # noqa: BLE001
            print("GLiNER2 no se puede importar:", type(exc).__name__, str(exc))
            ok = False
    return 0 if ok else 1


def cmd_selftest() -> int:
    if not gliner_installed():
        print('gliner2 no está instalado. Ejecute: pip install "gliner2[local]"')
        return 1
    t0 = time.perf_counter()
    ents, dropped = run_extraction(get_model(), SELFTEST_TEXT, SELFTEST_LABELS, default_threshold())
    print(f"\n{len(ents)} entidades verificadas ({dropped} descartadas) en {time.perf_counter() - t0:.1f} s:")
    for e in ents:
        print(f"  {e['label']:<18} {e['text']!r:<28} [{e['start']},{e['end']}]  conf={e['confidence']}")
    return 0 if ents else 2


def main(argv: list[str]) -> int:
    global _extractor_class, _load_error
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    if "--check" in argv:
        return cmd_check()
    if "--selftest" in argv:
        return cmd_selftest()
    # NumPy/PyTorch deben inicializar sus DLL en el hilo principal. Su primera
    # importación desde un hilo HTTP se bloqueaba en Windows al cargar NumPy.
    # Esta fase importa dependencias, pero deja los pesos del modelo para la
    # primera extracción. Después el estado HTTP no depende de una importación.
    if gliner_installed():
        print('GLiNER2: inicializando dependencias (puede tardar unos segundos)…', flush=True)
        try:
            from gliner2 import AutoExtractor
            _extractor_class = AutoExtractor
        except Exception as exc:
            _load_error = f'{type(exc).__name__}: {exc}'[:400]
            print('GLiNER2: error al inicializar dependencias:', _load_error, flush=True)
    try:
        server = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError as exc:
        print(f"No se pudo abrir {HOST}:{PORT} ({exc}). ¿Ya está en marcha? Cambie el puerto con JEV_GLINER_PORT.")
        return 1
    server.daemon_threads = True
    if "--watch-parent" in argv:
        def _watch() -> None:
            try:
                while sys.stdin.read(4096):
                    pass
            except Exception:  # noqa: BLE001
                pass
            os._exit(0)  # el padre ha terminado (cierre de ventana, kill...): no dejar el servicio huérfano
        threading.Thread(target=_watch, daemon=True).start()
    print(f"Servicio GLiNER2 en http://{HOST}:{PORT}  (modelo: {resolve_model()})")
    print("Déjelo abierto mientras use la pestaña «Entidades». Ctrl+C para cerrar.", flush=True)
    if "--preload" in argv and gliner_installed():
        try:
            get_model()
        except Exception as exc:  # noqa: BLE001
            print("Aviso: no se pudo precargar el modelo:", exc)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
