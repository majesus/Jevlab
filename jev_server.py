#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Servidor local único de la consola JEV (biblioteca estándar de Python; sin dependencias).

Sustituye a router.php + proxy.php + gliner.php de la versión con PHP:

  GET  /, /index.html, /js/*.js, /css/*.css   archivos estáticos (lista cerrada)
  POST /api/systemone                         proxy hacia https://api.typesafe.ai/v1/systemone (la clave no pasa por el navegador
                                              salvo la que el usuario escriba en la consola; nunca se escribe en disco)
  GET  /api/gliner?health=1                   estado del servicio GLiNER local
  POST /api/gliner                            extracción de entidades (puente al servicio 127.0.0.1)

Uso:   python jev_server.py --open            (Windows: INICIAR.bat; macOS/Linux: sh iniciar.sh)
       python jev_server.py --check           (diagnóstico)

Clave de API (orden de precedencia): variable TYPESAFE_API_KEY → config.local.json → cabecera X-Jev-Api-Key (consola web).
Variables opcionales: JEV_PORT, JEV_BIND (127.0.0.1), JEV_ALLOWED_HOSTS, JEV_RATE_LIMIT_PER_MINUTE, TYPESAFE_CA_BUNDLE,
JEV_UPSTREAM_URL (solo https://, para pruebas), JEV_GLINER_PORT (8765), JEV_GLINER_PYTHON, JEV_GLINER_AUTOSTART (0 = no).
"""
import sys

if sys.version_info < (3, 8):
    sys.exit('Se requiere Python 3.8 o superior (versión detectada: %d.%d).' % sys.version_info[:2])

import argparse
import atexit
import base64
import http.client
import importlib.util
import json
import os
import re
import socket
import ssl
import subprocess
import threading
import time
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit

ROOT = os.path.dirname(os.path.abspath(__file__))

UPSTREAM_URL_DEFAULT = 'https://api.typesafe.ai/v1/systemone'
DEFAULT_MODEL = 'jev-latest'
MODEL_RE = re.compile(r'^jev-[a-z0-9][a-z0-9.\-]{0,31}$')
KEY_RE = re.compile(r'^[\x21-\x7E]{8,512}$')
QUESTION_ID_RE = re.compile(r'^[A-Za-z0-9_\-]{1,64}$')
STATIC_RE = re.compile(r'^/(js|css)/([A-Za-z0-9_.\-]+\.(js|css))$')
MAX_BODY_BYTES = 1048576        # 1 MiB; el límite de la API es 32 MiB, pero este proxy atiende un registro por llamada.
MAX_RESPONSE_BYTES = 33554432   # 32 MiB
MAX_QUESTIONS = 50
MAX_CHOICE_OPTIONS = 255        # Límite documentado.
SCORE_MIN_LEVELS = 2            # Límite documentado.
SCORE_MAX_LEVELS = 10           # Límite documentado.
MAX_JSON_DEPTH = 64             # Límite documentado.
GL_MAX_BODY = 1048576
GL_MAX_TEXT_CHARS = 100000
GL_MAX_LABELS = 30

CSP = ("default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; "
       "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")


class ApiError(Exception):
    def __init__(self, status, message, headers=None, extra=None):
        Exception.__init__(self, message)
        self.status = status
        self.message = message
        self.headers = headers or {}
        self.extra = extra or {}


# ───────────────────────────── utilidades ─────────────────────────────

def allowed_hostnames():
    extra = os.environ.get('JEV_ALLOWED_HOSTS', '')
    out = ['localhost', '127.0.0.1', '[::1]']
    out.extend(h.strip() for h in extra.lower().split(',') if h.strip())
    return out


_rl_lock = threading.Lock()
_rl_hits = {}


def rate_limit(bucket, client, default_per_minute):
    """Ventana deslizante de 60 s por IP y «cubo» (proxy / gliner), en memoria."""
    try:
        limit = int(os.environ.get('JEV_RATE_LIMIT_PER_MINUTE') or default_per_minute)
    except ValueError:
        limit = default_per_minute
    if limit <= 0:
        return
    now = time.time()
    with _rl_lock:
        stamps = [t for t in _rl_hits.get((bucket, client), []) if t > now - 60]
        if len(stamps) >= limit:
            _rl_hits[(bucket, client)] = stamps
            raise ApiError(429, 'Límite de peticiones superado. Reintente en un minuto.', {'Retry-After': '60'})
        stamps.append(now)
        _rl_hits[(bucket, client)] = stamps


def _reject_constant(name):
    raise ValueError('constante JSON no válida: ' + name)


def json_depth(obj):
    """Niveles máximos de anidamiento de objetos/listas (calculado sin recursión)."""
    best = 0
    stack = [(obj, 1)]
    while stack:
        cur, d = stack.pop()
        if isinstance(cur, dict):
            best = max(best, d)
            stack.extend((v, d + 1) for v in cur.values())
        elif isinstance(cur, list):
            best = max(best, d)
            stack.extend((v, d + 1) for v in cur)
    return best


def parse_json(raw, max_depth):
    """Devuelve el valor decodificado o lanza ValueError (UTF-8 inválido, sintaxis, NaN/Infinity o demasiado anidado)."""
    try:
        text = raw.decode('utf-8')
        data = json.loads(text, parse_constant=_reject_constant)
    except (UnicodeDecodeError, RecursionError) as exc:
        raise ValueError(str(exc))
    if json_depth(data) > max_depth:
        raise ValueError('anidamiento excesivo')
    return data


def dumps(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def resolve_api_key(header_value):
    key = (os.environ.get('TYPESAFE_API_KEY') or '').strip()
    if key:
        return key
    cfg = os.path.join(ROOT, 'config.local.json')
    if os.path.isfile(cfg):
        try:
            with open(cfg, 'r', encoding='utf-8-sig') as fh:
                data = json.load(fh)
            if isinstance(data, dict) and isinstance(data.get('api_key'), str) and data['api_key'].strip():
                return data['api_key'].strip()
        except (OSError, ValueError):
            pass
    return (header_value or '').strip()


def build_question(qid, q):
    if not isinstance(q, dict):
        raise ValueError("La pregunta '%s' debe ser un objeto." % qid)
    qtype = q.get('type')
    if qtype is None:
        qtype = q.get('primitive')
    qtype = qtype.lower() if isinstance(qtype, str) else ''
    if qtype not in ('choice', 'score', 'noul'):
        raise ValueError("La pregunta '%s' tiene un tipo no soportado (use choice, score o noul)." % qid)

    instructions = q.get('instructions')
    if isinstance(instructions, str):
        instructions = instructions.strip()
    if instructions is None or instructions == '' or instructions == [] or instructions == {}:
        raise ValueError("La pregunta '%s' requiere 'instructions'." % qid)
    if not isinstance(instructions, (str, list, dict)):
        raise ValueError("La pregunta '%s' tiene 'instructions' con tipo inválido." % qid)

    out = {'type': qtype, 'instructions': instructions}
    criteria = q.get('criteria')
    if qtype == 'choice':
        if not isinstance(criteria, dict) or not criteria:
            raise ValueError("La pregunta '%s' (choice) requiere 'criteria' como mapa opción → descripción." % qid)
        if len(criteria) > MAX_CHOICE_OPTIONS:
            raise ValueError("La pregunta '%s' supera las %d opciones permitidas." % (qid, MAX_CHOICE_OPTIONS))
        for option, description in criteria.items():
            if option == '' or not (description is None or isinstance(description, str)):
                raise ValueError("La pregunta '%s' contiene una opción inválida." % qid)
        out['criteria'] = criteria
    elif qtype == 'score':
        if isinstance(criteria, dict):
            levels = list(criteria.values())
        elif isinstance(criteria, list):
            levels = criteria
        else:
            raise ValueError("La pregunta '%s' (score) requiere 'criteria' como lista ordenada de niveles." % qid)
        if not (SCORE_MIN_LEVELS <= len(levels) <= SCORE_MAX_LEVELS):
            raise ValueError("La pregunta '%s' (score) requiere entre %d y %d niveles." % (qid, SCORE_MIN_LEVELS, SCORE_MAX_LEVELS))
        if any(not isinstance(level, str) for level in levels):
            raise ValueError("La pregunta '%s' (score) contiene un nivel que no es texto." % qid)
        out['criteria'] = levels
    else:  # noul
        if criteria is not None:
            if not isinstance(criteria, dict):
                raise ValueError("La pregunta '%s' (noul) tiene 'criteria' inválido." % qid)
            noul = {}
            for k in ('true', 'false'):
                if criteria.get(k) is not None:
                    if not isinstance(criteria[k], str):
                        raise ValueError("La pregunta '%s' (noul) tiene 'criteria.%s' inválido." % (qid, k))
                    noul[k] = criteria[k]
            if noul:
                out['criteria'] = noul
    return out


def validate_systemone(data):
    """Valida el cuerpo del navegador y devuelve (payload_utf8, status_code=None). Lanza ApiError."""
    if not isinstance(data, dict):
        raise ApiError(400, 'El cuerpo debe ser un objeto JSON.')
    model = data.get('model')
    if model is None:
        model = DEFAULT_MODEL
    if not isinstance(model, str) or not MODEL_RE.match(model):
        raise ApiError(422, "Modelo inválido. Use un alias ('jev-latest', 'jev-preview') o un ID versionado ('jev-1.13.0').")
    state = data.get('state')
    if isinstance(state, str):
        if state.strip() == '':
            raise ApiError(422, "'state' no puede estar vacío.")
    elif not isinstance(state, (dict, list)) or not state:
        raise ApiError(422, "'state' debe ser texto, objeto o lista no vacíos.")
    questions = data.get('questions')
    if not isinstance(questions, dict) or not questions:
        raise ApiError(422, "'questions' debe ser un objeto con al menos una pregunta.")
    if len(questions) > MAX_QUESTIONS:
        raise ApiError(422, 'Se superó el máximo de %d preguntas por petición en este proxy.' % MAX_QUESTIONS)
    out_q = {}
    for qid, q in questions.items():
        if not QUESTION_ID_RE.match(qid):
            raise ApiError(422, "Identificador de pregunta inválido: '%s' (use A-Z, a-z, 0-9, _ o -; máx. 64)." % qid[:40])
        try:
            out_q[qid] = build_question(qid, q)
        except ValueError as exc:
            raise ApiError(422, str(exc))
    try:
        return dumps({'state': state, 'model': model, 'questions': out_q}).encode('utf-8')
    except (UnicodeEncodeError, ValueError) as exc:
        raise ApiError(400, 'No se pudo codificar el contenido (%s). Compruebe que es UTF-8 válido y que los números son finitos.' % exc)


# ───────────────────────────── salida hacia TypeSafe ─────────────────────────────

def _ssl_context():
    ca = os.environ.get('TYPESAFE_CA_BUNDLE', '')
    return ssl.create_default_context(cafile=ca) if ca else ssl.create_default_context()


def _proxy_for(host):
    """Proxy HTTP(S) del sistema (variables de entorno o configuración de Windows), respetando NO_PROXY."""
    try:
        if urllib.request.proxy_bypass(host):
            return None
        proxy = urllib.request.getproxies().get('https') or urllib.request.getproxies().get('http')
    except Exception:
        return None
    if not proxy:
        return None
    if '://' not in proxy:
        proxy = 'http://' + proxy
    return urlsplit(proxy)


def call_upstream(url, payload, api_key):
    """POST JSON a TypeSafe. Devuelve (status, cuerpo_bytes, retry_after|None). Lanza ApiError ante fallos de red."""
    u = urlsplit(url)
    host, port = u.hostname, u.port or 443
    path = (u.path or '/') + ('?' + u.query if u.query else '')
    proxy = _proxy_for(host)
    conn = None
    try:
        ctx = _ssl_context()
        if proxy is not None:
            conn = http.client.HTTPSConnection(proxy.hostname, proxy.port or 80, timeout=10, context=ctx)
            hdrs = {}
            if proxy.username:
                cred = '%s:%s' % (unquote(proxy.username), unquote(proxy.password or ''))
                hdrs['Proxy-Authorization'] = 'Basic ' + base64.b64encode(cred.encode('utf-8')).decode('ascii')
            conn.set_tunnel(host, port, headers=hdrs)
        else:
            conn = http.client.HTTPSConnection(host, port, timeout=10, context=ctx)
        conn.connect()
        conn.sock.settimeout(60)
        conn.request('POST', path, body=payload, headers={
            'Content-Type': 'application/json', 'Accept': 'application/json',
            'Authorization': 'Bearer ' + api_key, 'Accept-Encoding': 'identity'})
        resp = conn.getresponse()
        body = resp.read(MAX_RESPONSE_BYTES + 1)
        if len(body) > MAX_RESPONSE_BYTES:
            raise ApiError(502, 'La respuesta de TypeSafe supera el tamaño máximo admitido.')
        retry = (resp.getheader('Retry-After') or '').strip()
        retry_after = retry if retry.isdigit() and int(retry) <= 3600 else None
        return resp.status, body, retry_after
    except ApiError:
        raise
    except socket.timeout:
        raise ApiError(504, 'TypeSafe no respondió en 60 s. Reintente; si persiste, compruebe su conexión.')
    except ssl.SSLError as exc:
        if 'timed out' in str(exc):
            raise ApiError(504, 'TypeSafe no respondió en 60 s. Reintente; si persiste, compruebe su conexión.')
        raise ApiError(502, 'No se pudo verificar el certificado TLS de TypeSafe (%s). Si usa un proxy con inspección TLS, indique su '
                            'certificado raíz en la variable TYPESAFE_CA_BUNDLE; en macOS con Python de python.org ejecute '
                            '«Install Certificates.command». No se desactiva la verificación TLS.' % (getattr(exc, 'reason', None) or exc.__class__.__name__))
    except (OSError, http.client.HTTPException) as exc:
        raise ApiError(502, 'Fallo de conexión con TypeSafe AI (%s: %s).' % (exc.__class__.__name__, str(exc)[:160]))
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


def gliner_port():
    try:
        port = int(os.environ.get('JEV_GLINER_PORT') or 8765)
    except ValueError:
        port = 0
    if port < 1024 or port > 65535:
        raise ApiError(500, 'JEV_GLINER_PORT debe estar entre 1024 y 65535.')
    return port


def call_service(method, path, payload, timeout):
    """Llama al servicio GLiNER local (destino fijo 127.0.0.1; nunca a través de un proxy). Devuelve (status, bytes)."""
    port = gliner_port()
    conn = http.client.HTTPConnection('127.0.0.1', port, timeout=2)
    try:
        conn.connect()
        conn.sock.settimeout(timeout)
        headers = {'Accept': 'application/json'}
        if method == 'POST':
            headers['Content-Type'] = 'application/json'
        conn.request(method, path, body=payload, headers=headers)
        resp = conn.getresponse()
        return resp.status, resp.read(MAX_RESPONSE_BYTES)
    except ConnectionRefusedError:
        raise ApiError(503, 'El servicio GLiNER no está en marcha.',
                       extra={'hint': 'Cierre y vuelva a abrir INICIAR (arranca el servicio si GLiNER está instalado); si no lo está, ejecute INSTALAR_GLINER.',
                              'service_down': True})
    except socket.timeout:
        raise ApiError(504, 'El servicio GLiNER tardó demasiado (la primera carga del modelo puede superar 1–2 minutos). Reintente.')
    except (OSError, http.client.HTTPException) as exc:
        raise ApiError(502, 'No se pudo contactar con el servicio GLiNER (%s).' % exc.__class__.__name__)
    finally:
        conn.close()


# ───────────────────────────── servidor HTTP ─────────────────────────────

class Handler(BaseHTTPRequestHandler):
    server_version = 'JevServer'
    sys_version = ''
    protocol_version = 'HTTP/1.0'
    timeout = 120

    # ----- registro: solo se muestran los códigos de error (nunca cabeceras ni cuerpos) -----
    def log_request(self, code='-', size='-'):
        try:
            status = int(code)
        except (TypeError, ValueError):
            status = 0
        if status >= 400:
            sys.stderr.write('[%s] %s %s -> %s\n' % (self.log_date_time_string(), self.command, urlsplit(self.path).path[:120], status))

    def log_message(self, fmt, *args):
        sys.stderr.write('[%s] %s\n' % (self.log_date_time_string(), (fmt % args)[:200]))

    # ----- envío -----
    def _send(self, status, body=b'', ctype='application/json; charset=utf-8', headers=None):
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def _json(self, status, obj, headers=None):
        h = {'Cache-Control': 'no-store'}
        h.update(headers or {})
        self._send(status, dumps(obj).encode('utf-8'), headers=h)

    def _raw_json(self, status, body, headers=None):
        h = {'Cache-Control': 'no-store'}
        h.update(headers or {})
        self._send(status, body, headers=h)

    def _plain(self, status, text, headers=None):
        self._send(status, text.encode('utf-8'), 'text/plain; charset=utf-8', headers)

    # ----- comprobaciones comunes -----
    def _guard_origin(self):
        host_header = (self.headers.get('Host') or '').lower()
        hostname = re.sub(r':\d+$', '', host_header)
        if not hostname or hostname not in allowed_hostnames():
            raise ApiError(403, 'Host no autorizado.')
        origin = self.headers.get('Origin')
        if origin is not None:
            try:
                origin_host = urlsplit(origin).netloc.lower()
            except ValueError:
                origin_host = ''
            if not origin_host or origin_host != host_header:
                raise ApiError(403, 'Origen no autorizado.')
        site = self.headers.get('Sec-Fetch-Site')
        if site is not None and site != 'same-origin':
            raise ApiError(403, 'Petición cross-site rechazada.')

    def _require_json_post(self):
        if self.command != 'POST':
            raise ApiError(405, 'Método no permitido. Use POST.', {'Allow': 'POST'})
        if not (self.headers.get('Content-Type') or '').lower().startswith('application/json'):
            raise ApiError(415, 'Content-Type debe ser application/json.')

    def _read_body(self, max_bytes):
        if 'chunked' in (self.headers.get('Transfer-Encoding') or '').lower():
            raise ApiError(411, 'Se requiere Content-Length (no se admite Transfer-Encoding: chunked).')
        try:
            declared = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            raise ApiError(400, 'Content-Length inválido.')
        if declared < 0:
            raise ApiError(400, 'Content-Length inválido.')
        if declared > max_bytes:
            remaining = min(declared, 8 * 1024 * 1024)   # se descarta lo enviado para que el cliente reciba el 413 y no un corte
            while remaining > 0:
                chunk = self.rfile.read(min(65536, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
            raise ApiError(413, 'Cuerpo demasiado grande.')
        raw = self.rfile.read(declared) if declared else b''
        if not raw:
            raise ApiError(400, 'Cuerpo vacío.')
        return raw

    # ----- despacho -----
    def _dispatch(self):
        try:
            self._route()
        except ApiError as err:
            self._json(err.status, dict([('error', err.message)] + list(err.extra.items())), err.headers)
        except (socket.timeout, ConnectionError):
            self.close_connection = True
        except Exception as exc:   # último recurso: nunca devolver trazas ni datos internos
            sys.stderr.write('Error interno: %s: %s\n' % (exc.__class__.__name__, exc))
            try:
                self._json(500, {'error': 'Error interno del servidor.'})
            except Exception:
                self.close_connection = True

    do_GET = do_HEAD = do_POST = do_PUT = do_DELETE = do_PATCH = do_OPTIONS = _dispatch

    def _route(self):
        parts = urlsplit(self.path)
        path = unquote(parts.path)
        method = self.command
        if path in ('/', '/index.html'):
            return self._static_index(method)
        if path == '/api/systemone':
            return self._systemone()
        if path == '/api/gliner':
            return self._gliner(parse_qs(parts.query, keep_blank_values=True))
        if path == '/favicon.ico':
            return self._send(204, b'', 'text/plain; charset=utf-8')
        m = STATIC_RE.match(path)
        if m:
            return self._static_asset(method, m)
        self._plain(404, 'Not found')

    # ----- estáticos -----
    def _static_index(self, method):
        if method not in ('GET', 'HEAD'):
            return self._plain(405, 'Method not allowed', {'Allow': 'GET, HEAD'})
        try:
            with open(os.path.join(ROOT, 'index.html'), 'rb') as fh:
                body = fh.read()
        except OSError:
            return self._plain(404, 'Not found')
        self._send(200, body, 'text/html; charset=utf-8', {
            'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store', 'Content-Security-Policy': CSP})

    def _static_asset(self, method, m):
        if method not in ('GET', 'HEAD'):
            return self._plain(405, 'Method not allowed', {'Allow': 'GET, HEAD'})
        fpath = os.path.join(ROOT, m.group(1), m.group(2))
        try:
            with open(fpath, 'rb') as fh:
                body = fh.read()
        except OSError:
            return self._plain(404, 'Not found')
        ctype = 'text/javascript; charset=utf-8' if m.group(3) == 'js' else 'text/css; charset=utf-8'
        self._send(200, body, ctype, {'Cache-Control': 'no-cache'})

    # ----- /api/systemone -----
    def _systemone(self):
        self._guard_origin()
        self._require_json_post()
        rate_limit('proxy', self.client_address[0], 240)
        api_key = resolve_api_key(self.headers.get('X-Jev-Api-Key'))
        if not api_key or not KEY_RE.match(api_key):
            raise ApiError(401, 'API Key ausente o con formato inválido. Defina TYPESAFE_API_KEY, config.local.json o introdúzcala en la consola.')
        raw = self._read_body(MAX_BODY_BYTES)
        try:
            data = parse_json(raw, MAX_JSON_DEPTH)
        except ValueError:
            raise ApiError(400, 'Cuerpo JSON mal formado o con más de %d niveles de anidamiento.' % MAX_JSON_DEPTH)
        payload = validate_systemone(data)
        upstream = os.environ.get('JEV_UPSTREAM_URL') or UPSTREAM_URL_DEFAULT
        if not upstream.startswith('https://'):
            raise ApiError(500, 'Configuración inválida del endpoint de destino (debe ser https://).')
        status, body, retry_after = call_upstream(upstream, payload, api_key)
        try:
            json.loads(body.decode('utf-8'))
        except (UnicodeDecodeError, ValueError):
            raise ApiError(502, 'Respuesta no JSON del servicio TypeSafe (HTTP %d).' % status)
        # Solo se transmiten 2xx, 4xx y 5xx. Una redirección (no seguida) o un código anómalo no deben llegar al navegador como tales.
        out_status = status if (200 <= status <= 299 or 400 <= status <= 599) else 502
        self._raw_json(out_status, body, {'Retry-After': retry_after} if retry_after else None)

    # ----- /api/gliner -----
    def _gliner(self, query):
        self._guard_origin()
        gliner_port()
        if self.command == 'GET':
            if 'health' not in query:
                raise ApiError(400, 'Use ?health=1 o POST.')
            code, body = call_service('GET', '/health', None, 4)
            try:
                json.loads(body.decode('utf-8'))
            except (UnicodeDecodeError, ValueError):
                raise ApiError(502, 'Respuesta no válida del servicio GLiNER.')
            return self._raw_json(200 if code == 200 else 502, body)
        self._require_json_post()
        rate_limit('gliner', self.client_address[0], 120)
        raw = self._read_body(GL_MAX_BODY)
        try:
            data = parse_json(raw, 8)
        except ValueError:
            raise ApiError(400, 'Cuerpo JSON mal formado.')
        if not isinstance(data, dict):
            raise ApiError(400, 'El cuerpo debe ser un objeto JSON.')
        text = data.get('text')
        if not isinstance(text, str) or text.strip() == '':
            raise ApiError(422, "'text' debe ser un texto no vacío.")
        if len(text) > GL_MAX_TEXT_CHARS:
            raise ApiError(422, "'text' supera el máximo de %d caracteres." % GL_MAX_TEXT_CHARS)
        labels = data.get('labels')
        if not isinstance(labels, dict) or not labels:
            raise ApiError(422, "'labels' debe ser un objeto {etiqueta: descripción} con al menos una etiqueta.")
        if len(labels) > GL_MAX_LABELS:
            raise ApiError(422, 'Se admiten como máximo %d etiquetas.' % GL_MAX_LABELS)
        clean = {}
        for name, desc in labels.items():
            if name.strip() == '' or len(name) > 80 or not (desc is None or isinstance(desc, str)) or len(desc or '') > 600:
                raise ApiError(422, 'Etiqueta inválida: nombre de 1–80 caracteres y descripción de texto de hasta 600.')
            clean[name] = desc or ''
        out = {'text': text, 'labels': clean}
        if 'threshold' in data:
            t = data['threshold']
            if isinstance(t, bool) or not isinstance(t, (int, float)) or t < 0 or t > 1:
                raise ApiError(422, "'threshold' debe ser un número entre 0 y 1.")
            out['threshold'] = t
        try:
            payload = dumps(out).encode('utf-8')
        except (UnicodeEncodeError, ValueError) as exc:
            raise ApiError(400, 'No se pudo codificar la petición (%s).' % exc)
        code, body = call_service('POST', '/extract', payload, 180)
        try:
            json.loads(body.decode('utf-8'))
        except (UnicodeDecodeError, ValueError):
            raise ApiError(502, 'Respuesta no válida del servicio GLiNER.')
        self._raw_json(code if (200 <= code <= 299 or 400 <= code <= 599) else 502, body)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    # En Windows SO_REUSEADDR permite que dos procesos compartan el puerto; se desactiva para detectar «puerto ocupado».
    allow_reuse_address = os.name != 'nt'


# ───────────────────────────── servicio GLiNER (opcional) ─────────────────────────────

_gliner_proc = None


def gliner_healthy():
    try:
        conn = http.client.HTTPConnection('127.0.0.1', gliner_port(), timeout=1)
        conn.request('GET', '/health')
        ok = conn.getresponse().status == 200
        conn.close()
        return ok
    except Exception:
        return False


def find_gliner_python():
    """Find this user's shared installation even after the app folder is moved."""
    cands = []
    if os.environ.get('JEV_GLINER_PYTHON'):
        cands.append(os.environ['JEV_GLINER_PYTHON'])
    if os.environ.get('JEV_GLINER_ENV'):
        env = os.environ['JEV_GLINER_ENV']
        cands.append(os.path.join(env, 'Scripts' if os.name == 'nt' else 'bin', 'python.exe' if os.name == 'nt' else 'python'))
    try:
        with open(os.path.join(ROOT, 'gliner_python.txt'), encoding='utf-8-sig') as fh:
            configured = fh.readline(8192).strip().strip('"')
        if os.path.isabs(configured):
            cands.append(configured)
    except OSError:
        pass
    if os.name == 'nt':
        base = os.environ.get('LOCALAPPDATA') or os.path.expanduser('~/AppData/Local')
        cands.append(os.path.join(base, 'JEV', 'gliner_env', 'Scripts', 'python.exe'))
    else:
        base = os.path.expanduser('~/Library/Application Support') if sys.platform == 'darwin' else (os.environ.get('XDG_DATA_HOME') or os.path.expanduser('~/.local/share'))
        cands.append(os.path.join(base, 'JEV', 'gliner_env', 'bin', 'python'))
    # Compatibility with older distributions; new installations live outside ROOT.
    cands.append(os.path.join(ROOT, '.venv_gliner', 'Scripts', 'python.exe'))
    cands.append(os.path.join(ROOT, '.venv_gliner', 'bin', 'python'))
    for candidate in cands:
        if os.path.isfile(candidate):
            return candidate
    return None


def start_gliner():
    """Arranca gliner_service.py si hay un entorno con gliner2 y el servicio no está ya activo. Devuelve el mensaje informativo."""
    global _gliner_proc
    if os.environ.get('JEV_GLINER_AUTOSTART', '1') == '0':
        return 'Servicio GLiNER: arranque automático desactivado (JEV_GLINER_AUTOSTART=0).'
    if gliner_healthy():
        return 'Servicio GLiNER: ya estaba en marcha.'
    py = find_gliner_python()
    if not py:
        return 'GLiNER no está instalado: la pestaña Entidades usará la simulación. (Opcional: INSTALAR_GLINER)'
    probe = subprocess.run([py, '-c', "import importlib.util,sys;sys.exit(0 if importlib.util.find_spec('gliner2') else 1)"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if probe.returncode != 0:
        return 'GLiNER no está instalado en ese entorno: la pestaña Entidades usará la simulación. (Opcional: INSTALAR_GLINER)'
    log = open(os.path.join(ROOT, 'gliner_service.log'), 'ab')
    flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0) if os.name == 'nt' else 0
    # stdin=PIPE + --watch-parent: si este proceso muere sin limpiar (cierre de la ventana, kill), el servicio detecta el EOF y termina.
    _gliner_proc = subprocess.Popen([py, os.path.join(ROOT, 'gliner_service.py'), '--watch-parent'], cwd=ROOT, stdin=subprocess.PIPE,
                                    stdout=log, stderr=subprocess.STDOUT, creationflags=flags)
    atexit.register(stop_gliner)
    return 'Servicio GLiNER local iniciado (la primera extracción carga el modelo y puede tardar 1-2 minutos; registro en gliner_service.log).'


def stop_gliner():
    global _gliner_proc
    if _gliner_proc is not None and _gliner_proc.poll() is None:
        _gliner_proc.terminate()
        try:
            _gliner_proc.wait(5)
        except Exception:
            _gliner_proc.kill()
    _gliner_proc = None


# ───────────────────────────── arranque ─────────────────────────────

def run_check():
    print('Python %s en %s' % (sys.version.split()[0], sys.executable))
    print('Almacén de certificados TLS: %s' % (ssl.get_default_verify_paths().cafile or 'del sistema operativo'))
    ctx = _ssl_context()
    print('Certificados raíz cargados: %d' % len(ctx.get_ca_certs()))
    key = resolve_api_key('')
    print('Clave de API en el servidor: %s' % ('sí (variable de entorno o config.local.json)' if key else 'no (se usará la escrita en la consola web)'))
    proxy = _proxy_for('api.typesafe.ai')
    print('Proxy del sistema para api.typesafe.ai: %s' % (('%s:%s' % (proxy.hostname, proxy.port)) if proxy else 'ninguno'))
    py = find_gliner_python()
    print('Entorno GLiNER: %s' % (py or 'no instalado (opcional)'))
    for f in ('index.html', 'js/app.js', 'css/app.css', 'gliner_service.py'):
        print('  %-18s %s' % (f, 'ok' if os.path.isfile(os.path.join(ROOT, f)) else 'FALTA'))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description='Servidor local de la consola JEV')
    ap.add_argument('--port', type=int, help='puerto (por defecto JEV_PORT o 8000)')
    ap.add_argument('--open', action='store_true', help='abrir el navegador al arrancar')
    ap.add_argument('--check', action='store_true', help='mostrar diagnóstico y salir')
    args = ap.parse_args(argv)
    if args.check:
        return run_check()

    bind = os.environ.get('JEV_BIND', '127.0.0.1')
    explicit = args.port is not None or bool(os.environ.get('JEV_PORT'))
    port = args.port or int(os.environ.get('JEV_PORT') or 8000)
    srv = None
    for candidate in ([port] if explicit else range(port, port + 10)):
        try:
            srv = Server((bind, candidate), Handler)
            port = candidate
            break
        except OSError as exc:
            if explicit:
                sys.stderr.write('No se pudo abrir el puerto %d (%s). Pruebe otro: set JEV_PORT=8001 (Windows) / JEV_PORT=8001 sh iniciar.sh\n' % (candidate, exc))
                return 1
    if srv is None:
        sys.stderr.write('No hay ningún puerto libre entre %d y %d.\n' % (port, port + 9))
        return 1

    if bind not in ('127.0.0.1', 'localhost', '::1'):
        print('AVISO: el servidor escucha en %s, accesible desde la red. Está pensado para uso local; añada autenticación si lo expone.' % bind)
    url = 'http://localhost:%d' % port
    try:   # SIGTERM → salida ordenada (detiene también el servicio GLiNER)
        import signal
        signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    except (ImportError, ValueError, OSError):
        pass
    print(start_gliner())
    print('')
    print('Aplicación en  %s   (deje esta ventana abierta; Ctrl+C para terminar)' % url)
    if args.open:
        threading.Timer(0.8, webbrowser.open, [url]).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\nServidor detenido.')
    finally:
        srv.server_close()
        stop_gliner()
    return 0


if __name__ == '__main__':
    sys.exit(main())
