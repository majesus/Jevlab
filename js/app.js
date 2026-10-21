/* Aplicación principal: esquema de preguntas, entrada (individual / CSV), ejecución (simulación o API real), resultados y exportación.
 * Sin scripts en línea: toda la interacción se resuelve por delegación de eventos (data-act). */
(function () {
  'use strict';

  const F = window.JEVF;
  const SIM = window.JEVSim;
  const PRE = window.JEVPRESETS;

  const ID_RE = /^[A-Za-z0-9_\-]{1,64}$/;
  const KEY_RE = /^[\x21-\x7E]{8,512}$/;
  const MODELS = ['jev-latest', 'jev-preview', 'jev-1.14.0', 'jev-1.13.0'];
  const LIMITS = { options: 255, scoreMin: 2, scoreMax: 10, questions: 50, simRows: 5000, liveRows: 500, liveStateChars: 200000, concurrency: 3, retries: 4, page: 100 };

  /* ───────────────────────── utilidades ───────────────────────── */

  const $ = (id) => document.getElementById(id);
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
  const fmt = (x, d) => (typeof x === 'number' && isFinite(x) ? x.toFixed(d === undefined ? 3 : d) : '—');
  const pct = (x) => (typeof x === 'number' && isFinite(x) ? (x * 100).toFixed(1) + ' %' : '—');
  const clip = (s, n) => { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  const store = {
    get(kind, key) { try { return window[kind].getItem(key); } catch (e) { return null; } },
    set(kind, key, v) { try { window[kind].setItem(key, v); } catch (e) { /* almacenamiento no disponible */ } },
    del(kind, key) { try { window[kind].removeItem(key); } catch (e) { /* idem */ } }
  };

  let toastTimer = null;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.remove('opacity-0'); t.classList.add('opacity-100');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.classList.add('opacity-0'); t.classList.remove('opacity-100'); }, 3200);
  }

  let bannerTimer = null;
  function banner(kind, msg) {
    const b = $('banner'); clearTimeout(bannerTimer);
    if (!msg) { b.classList.add('hidden'); return; }
    const cls = { error: 'border-swiss-red bg-red-50 text-red-900', warn: 'border-yellow-500 bg-yellow-50 text-yellow-900', info: 'border-swiss-black bg-white' }[kind] || '';
    b.className = 'mb-4 border-l-4 p-3 text-xs font-mono ' + cls;
    b.textContent = msg;
    if (kind === 'info') bannerTimer = setTimeout(() => b.classList.add('hidden'), 9000);
  }

  function download(name, mime, content) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function copyText(text) {
    const done = () => toast('Copiado al portapapeles');
    const fallback = () => {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('No se pudo copiar; selecciónelo manualmente.'); }
      ta.remove();
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  }

  /** Decimal con coma si el separador de columnas es «;» (Excel en configuración regional española). */
  function fmtNum(n, delim) {
    const s = String(Math.round(n * 1e6) / 1e6);
    return delim === ';' ? s.replace('.', ',') : s;
  }

  /** Celda CSV: comillas RFC 4180 y neutralización de fórmulas (=, +, -, @, tab, CR) SOLO en cadenas, nunca en números. */
  function csvCell(v, delim) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return isFinite(v) ? fmtNum(v, delim) : '';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /["\r\n]/.test(s) || s.indexOf(delim) >= 0 ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  const sleep = (ms, signal) => new Promise((resolve, reject) => {
    if (signal && signal.aborted) { reject(new DOMException('Abortado', 'AbortError')); return; }
    const t = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Abortado', 'AbortError')); }, { once: true });
  });

  /* ───────────────────────── estado ───────────────────────── */

  const S = {
    tab: 'workspace',
    mode: 'sim',
    model: 'jev-latest',
    apiKey: '',
    cacheEnabled: true,
    inputMode: 'single',
    single: '',
    batch: { raw: '', header: true, asObject: false, col: '', parsed: { headers: [], rows: [], delimiter: ',', warnings: [] } },
    questions: [],
    presetKey: 'support_routing',
    sampleIdx: 0,
    results: [],
    shown: LIMITS.page,
    filter: '',
    running: false,
    controller: null,
    runInfo: null,
    noulNo: 0.2,
    noulYes: 0.8
  };
  let uidSeq = 0;
  const actions = {};
  const tabHooks = {};
  let cacheStorage = null;
  try { cacheStorage = window.localStorage; } catch (e) { /* Session-only fallback. */ }
  const jevCache = window.JEVCache.create({ storage: cacheStorage, crypto: window.crypto });

  function paintCache() {
    const status = jevCache.status();
    $('jev-cache-enabled').checked = S.cacheEnabled;
    $('jev-cache-enabled').disabled = S.running || !status.available;
    $('jev-cache-clear').disabled = S.running || !status.count;
    $('jev-cache-status').textContent = !status.available ? 'Caché no disponible en este navegador' :
      status.count + (status.count === 1 ? ' resultado guardado' : ' resultados guardados') +
      (status.persistent ? ' · este navegador' : ' · solo esta pestaña') + (S.mode === 'sim' ? ' · solo API real' : '');
    const summary = $('jev-cache-summary');
    const info = S.runInfo;
    summary.classList.toggle('hidden', !info || info.mode !== 'live');
    if (info && info.mode === 'live') summary.textContent = 'Última ejecución: ' + cacheRunSummary(info);
  }

  function cacheRunSummary(info) {
    return info.cacheHits + ' reutilizado' + (info.cacheHits === 1 ? '' : 's') + ' · ' + info.apiRequests + ' consulta' + (info.apiRequests === 1 ? '' : 's') + ' enviada' + (info.apiRequests === 1 ? '' : 's') + ' a Jev';
  }

  /* ───────────────────────── preguntas ───────────────────────── */

  function newQuestion(primitive, name) {
    const q = { uid: ++uidSeq, primitive, name: name || '', instructions: '', options: [], levels: [], tTrue: '', tFalse: '' };
    if (primitive === 'choice') q.options = [{ k: '', d: '' }, { k: '', d: '' }];
    if (primitive === 'score') q.levels = ['', ''];
    return q;
  }

  function uniqueName(base) {
    const used = new Set(S.questions.map((q) => q.name));
    let i = 1; while (used.has(base + i)) i++;
    return base + i;
  }

  function questionsFromPreset(spec) {
    return Object.keys(spec).map((name) => {
      const p = spec[name];
      const q = newQuestion(p.primitive, name);
      q.instructions = p.instructions || '';
      if (p.primitive === 'choice') q.options = Object.keys(p.criteria).map((k) => ({ k, d: p.criteria[k] === null ? '' : String(p.criteria[k]) }));
      else if (p.primitive === 'score') q.levels = p.criteria.map(String);
      else if (p.criteria) { q.tTrue = p.criteria.true || ''; q.tFalse = p.criteria.false || ''; }
      return q;
    });
  }

  /** Compila el esquema de la interfaz al formato de la API y lo valida con los límites documentados. */
  function compile() {
    const errors = []; const wire = {}; const seen = new Set();
    if (!S.questions.length) errors.push('Defina al menos una pregunta.');
    if (S.questions.length > LIMITS.questions) errors.push('Máximo ' + LIMITS.questions + ' preguntas por petición.');
    S.questions.forEach((q, i) => {
      const tag = 'P' + (i + 1) + (q.name ? ' «' + q.name + '»' : '');
      const name = q.name.trim();
      if (!ID_RE.test(name)) errors.push(tag + ': el identificador debe tener 1–64 caracteres entre A-Z, a-z, 0-9, _ o -.');
      else if (seen.has(name)) errors.push(tag + ': identificador duplicado.');
      seen.add(name);
      const instr = q.instructions.trim();
      if (!instr) errors.push(tag + ': las instrucciones son obligatorias.');
      const out = { type: q.primitive, instructions: instr };
      if (q.primitive === 'choice') {
        const crit = {}; const keys = new Set();
        q.options.forEach((o, j) => {
          const k = o.k.trim();
          if (!k) { errors.push(tag + ': la opción ' + (j + 1) + ' no tiene nombre.'); return; }
          if (keys.has(k)) errors.push(tag + ': opción duplicada «' + k + '».');
          keys.add(k); crit[k] = o.d.trim();
        });
        if (keys.size < 2) errors.push(tag + ': Choice requiere al menos 2 opciones.');
        if (keys.size > LIMITS.options) errors.push(tag + ': máximo ' + LIMITS.options + ' opciones.');
        out.criteria = crit;
      } else if (q.primitive === 'score') {
        const lv = q.levels.map((l) => l.trim());
        if (lv.length < LIMITS.scoreMin || lv.length > LIMITS.scoreMax) errors.push(tag + ': Score admite entre ' + LIMITS.scoreMin + ' y ' + LIMITS.scoreMax + ' niveles (hay ' + lv.length + ').');
        lv.forEach((l, j) => { if (!l) errors.push(tag + ': el nivel ' + j + ' está vacío.'); });
        out.criteria = lv;
      } else {
        const c = {};
        if (q.tTrue.trim()) c.true = q.tTrue.trim();
        if (q.tFalse.trim()) c.false = q.tFalse.trim();
        if (Object.keys(c).length) out.criteria = c;
      }
      if (ID_RE.test(name) && !(name in wire)) wire[name] = out;
    });
    return { wire, errors };
  }

  const PRIM_LABEL = { choice: 'Choice · clasificación', score: 'Score · escala ordinal', noul: 'Noul · sí/no' };

  function renderQuestions() {
    const c = $('questions-container');
    c.innerHTML = S.questions.map((q, idx) => {
      let body = '';
      if (q.primitive === 'choice') {
        body = '<div class="space-y-1.5"><div class="flex justify-between items-center"><span class="text-[11px] font-mono uppercase font-bold">Opciones (' + q.options.length + ')</span><button data-act="add-option" data-q="' + q.uid + '" class="text-[11px] font-mono underline hover:text-swiss-red">+ opción</button></div>' +
          q.options.map((o, j) => '<div class="grid grid-cols-12 gap-1.5"><input data-q="' + q.uid + '" data-f="opt-k" data-i="' + j + '" value="' + esc(o.k) + '" placeholder="identificador" aria-label="Opción ' + (j + 1) + '" class="col-span-4 border border-swiss-border px-2 py-1.5 font-mono text-xs focus:border-swiss-black focus:outline-none">' +
            '<input data-q="' + q.uid + '" data-f="opt-d" data-i="' + j + '" value="' + esc(o.d) + '" placeholder="descripción: cuándo aplicar esta opción" aria-label="Descripción de la opción ' + (j + 1) + '" class="col-span-7 border border-swiss-border px-2 py-1.5 text-xs focus:border-swiss-black focus:outline-none">' +
            '<button data-act="remove-option" data-q="' + q.uid + '" data-i="' + j + '" aria-label="Eliminar opción" class="col-span-1 font-mono text-xs text-swiss-grayDark hover:text-swiss-red">✕</button></div>').join('') + '</div>';
      } else if (q.primitive === 'score') {
        body = '<div class="space-y-1.5"><div class="flex justify-between items-center"><span class="text-[11px] font-mono uppercase font-bold">Niveles ordenados (0 = más bajo · ' + q.levels.length + ' niveles)</span><button data-act="add-level" data-q="' + q.uid + '" class="text-[11px] font-mono underline hover:text-swiss-red">+ nivel</button></div>' +
          q.levels.map((l, j) => '<div class="flex items-center gap-1.5"><span class="w-6 text-center font-mono text-xs font-bold bg-swiss-grayBg border border-swiss-border py-1.5">' + j + '</span>' +
            '<input data-q="' + q.uid + '" data-f="level" data-i="' + j + '" value="' + esc(l) + '" placeholder="descripción del nivel ' + j + '" aria-label="Nivel ' + j + '" class="flex-1 border border-swiss-border px-2 py-1.5 text-xs focus:border-swiss-black focus:outline-none">' +
            '<button data-act="remove-level" data-q="' + q.uid + '" data-i="' + j + '" aria-label="Eliminar nivel" class="w-6 font-mono text-xs text-swiss-grayDark hover:text-swiss-red">✕</button></div>').join('') + '</div>';
      } else {
        body = '<div class="grid grid-cols-1 sm:grid-cols-2 gap-2"><div><label class="text-[11px] font-mono uppercase font-bold">Criterio «true» (opcional)</label><input data-q="' + q.uid + '" data-f="tTrue" value="' + esc(q.tTrue) + '" class="mt-1 w-full border border-swiss-border px-2 py-1.5 text-xs focus:border-swiss-black focus:outline-none"></div>' +
          '<div><label class="text-[11px] font-mono uppercase font-bold">Criterio «false» (opcional)</label><input data-q="' + q.uid + '" data-f="tFalse" value="' + esc(q.tFalse) + '" class="mt-1 w-full border border-swiss-border px-2 py-1.5 text-xs focus:border-swiss-black focus:outline-none"></div></div>' +
          '<p class="text-[11px] font-mono text-swiss-grayDark">Noul devuelve un único valor en [0, 1]; la API no entrega <code>confidence</code>.</p>';
      }
      return '<div class="bg-white border border-swiss-border p-4 space-y-3">' +
        '<div class="flex items-center justify-between"><div class="flex items-center gap-2"><span class="text-[10px] font-mono uppercase tracking-wider bg-swiss-black text-white px-1.5 py-0.5">' + PRIM_LABEL[q.primitive] + '</span><span class="text-[11px] font-mono text-swiss-grayDark">P' + (idx + 1) + '</span></div>' +
        '<button data-act="remove-question" data-q="' + q.uid + '" aria-label="Eliminar pregunta" class="font-mono text-xs text-swiss-grayDark hover:text-swiss-red">✕ eliminar</button></div>' +
        '<div class="grid grid-cols-1 sm:grid-cols-3 gap-2 items-start"><div><label class="text-[11px] font-mono uppercase font-bold">Identificador</label><input data-q="' + q.uid + '" data-f="name" value="' + esc(q.name) + '" maxlength="64" class="mt-1 w-full border border-swiss-border px-2 py-1.5 font-mono text-xs focus:border-swiss-black focus:outline-none"></div>' +
        '<div class="sm:col-span-2"><label class="text-[11px] font-mono uppercase font-bold">Instrucciones</label><textarea data-q="' + q.uid + '" data-f="instructions" rows="2" class="mt-1 w-full border border-swiss-border px-2 py-1.5 text-xs focus:border-swiss-black focus:outline-none resize-y">' + esc(q.instructions) + '</textarea></div></div>' +
        body + '</div>';
    }).join('') || '<div class="border border-dashed border-swiss-border p-6 text-center text-xs font-mono text-swiss-grayDark">Sin preguntas. Cargue una plantilla o añada una primitiva.</div>';
  }

  function onQuestionInput(el) {
    const q = S.questions.find((x) => String(x.uid) === el.dataset.q); if (!q) return;
    const i = Number(el.dataset.i);
    switch (el.dataset.f) {
      case 'name': q.name = el.value; break;
      case 'instructions': q.instructions = el.value; break;
      case 'opt-k': q.options[i].k = el.value; break;
      case 'opt-d': q.options[i].d = el.value; break;
      case 'level': q.levels[i] = el.value; break;
      case 'tTrue': q.tTrue = el.value; break;
      case 'tFalse': q.tFalse = el.value; break;
      default: return;
    }
    refreshDerived();
  }

  /* ───────────────────────── entrada ───────────────────────── */

  function detectDelimiter(text) {
    let inQ = false; const cnt = { ',': 0, ';': 0, '\t': 0 };
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '"') { if (inQ && text[i + 1] === '"') i++; else inQ = !inQ; } else if (!inQ) {
        if (ch === '\n' || ch === '\r') { if (cnt[','] + cnt[';'] + cnt['\t'] > 0) break; } else if (ch in cnt) cnt[ch]++;
      }
    }
    if (cnt['\t'] > 0 && cnt['\t'] >= cnt[';'] && cnt['\t'] >= cnt[',']) return '\t';
    if (cnt[';'] > cnt[',']) return ';';
    return ',';
  }

  /** Analizador CSV conforme a RFC 4180: comillas, comillas dobles escapadas, saltos de línea dentro de celdas, BOM y CRLF. */
  function parseCsv(text) {
    text = String(text).replace(/^\uFEFF/, '');
    const delimiter = detectDelimiter(text);
    const rows = []; let row = []; let cell = ''; let inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += c;
      } else if (c === '"' && cell === '') inQ = true;
      else if (c === delimiter) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; rows.push(row); row = []; }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    const warnings = [];
    if (inQ) warnings.push('Hay unas comillas sin cerrar: el último registro puede estar truncado.');
    return { rows: rows.filter((r) => r.some((x) => x.trim() !== '')), delimiter, warnings };
  }

  function reparseBatch() {
    const b = S.batch; const p = parseCsv(b.raw);
    let headers; let rows;
    if (b.header && p.rows.length) { headers = p.rows[0].map((h, i) => h.trim() || 'col' + (i + 1)); rows = p.rows.slice(1); } else {
      const w = p.rows.reduce((m, r) => Math.max(m, r.length), 0); headers = []; for (let i = 0; i < w; i++) headers.push('col' + (i + 1)); rows = p.rows;
    }
    const seen = {}; // cabeceras repetidas: se sufijan (_2, _3…) para que cada columna sea direccionable
    headers = headers.map((h) => { seen[h] = (seen[h] || 0) + 1; return seen[h] > 1 ? h + '_' + seen[h] : h; });
    b.parsed = { headers, rows, delimiter: p.delimiter, warnings: p.warnings };
    if (!headers.includes(b.col)) b.col = guessTextColumn(headers, rows);
    renderBatchControls(); refreshDerived();
  }

  function guessTextColumn(headers, rows) {
    const named = headers.find((h) => /^(text|texto|comentario|comment|review|opini[oó]n|mensaje|message|contenido|content|descripci[oó]n|resumen|abstract|state)$/i.test(h));
    if (named) return named;
    let best = 0; let bestLen = -1;
    headers.forEach((h, j) => { const avg = rows.slice(0, 50).reduce((a, r) => a + (r[j] ? r[j].length : 0), 0); if (avg > bestLen) { bestLen = avg; best = j; } });
    return headers[best] || '';
  }

  function renderBatchControls() {
    const sel = $('batch-col'); const b = S.batch;
    sel.innerHTML = b.parsed.headers.map((h) => '<option value="' + esc(h) + '"' + (h === b.col ? ' selected' : '') + '>' + esc(h) + '</option>').join('') || '<option value="">—</option>';
    sel.disabled = b.asObject;
    const delimName = { ',': 'coma', ';': 'punto y coma', '\t': 'tabulador' }[b.parsed.delimiter];
    const n = currentItems().items.length;
    $('batch-summary').textContent = b.parsed.rows.length + ' filas · ' + b.parsed.headers.length + ' columnas · delimitador: ' + delimName + ' · ' + n + ' registros con contenido' + (b.parsed.warnings.length ? ' · ⚠ ' + b.parsed.warnings.join(' ') : '');
  }

  /** Registros a procesar. Devuelve también cuántas filas vacías se omiten. */
  function currentItems() {
    if (S.inputMode === 'single') {
      const t = S.single.trim();
      return { items: t ? [{ n: 1, label: t, state: t }] : [], skipped: 0 };
    }
    const { headers, rows } = S.batch.parsed; const items = []; let skipped = 0;
    const ci = headers.indexOf(S.batch.col);
    rows.forEach((r, k) => {
      if (S.batch.asObject) {
        const o = {}; headers.forEach((h, j) => { if (r[j] !== undefined && String(r[j]).trim() !== '') o[h] = r[j]; });
        if (Object.keys(o).length) items.push({ n: k + 1, label: Object.keys(o).map((h) => h + ': ' + o[h]).join(' · '), state: o }); else skipped++;
      } else {
        const t = ci >= 0 && r[ci] !== undefined ? String(r[ci]).trim() : '';
        if (t) items.push({ n: k + 1, label: t, state: t }); else skipped++;
      }
    });
    return { items, skipped };
  }

  /* ───────────────────────── derivados (validación, vistas previas) ───────────────────────── */

  function refreshDerived() {
    const { wire, errors } = compile();
    const box = $('schema-errors');
    if (errors.length) { box.classList.remove('hidden'); box.innerHTML = errors.map((e) => '<div>⚠ ' + esc(e) + '</div>').join(''); } else box.classList.add('hidden');
    const { items } = currentItems();
    const first = items[0];
    $('single-count').textContent = S.single.length.toLocaleString('es-ES') + ' caracteres';
    $('state-preview').textContent = first ? JSON.stringify({ state: typeof first.state === 'string' ? clip(first.state, 1500) : first.state }, null, 2) : '(sin contenido)';
    $('questions-json').textContent = errors.length ? '// Corrija el esquema para ver la compilación:\n// ' + errors.join('\n// ') : JSON.stringify(wire, null, 2);
    $('payload-json').textContent = errors.length || !first ? '// Requiere un esquema válido y al menos un registro.' : JSON.stringify({ state: first.state, model: S.model, questions: wire }, null, 2);
    if (S.inputMode === 'batch') { const n = items.length; $('batch-summary').textContent = $('batch-summary').textContent.replace(/· \d+ registros con contenido/, '· ' + n + ' registros con contenido'); }
    const preset = getPreset(S.presetKey);
    $('sample-hint').textContent = preset ? 'Plantilla: ' + preset.label + ' · ' + preset.samples.length + ' ejemplos' : '';
  }

  /* ───────────────────────── ejecución ───────────────────────── */

  function verifyAll(wire, answers) {
    const checks = {};
    Object.keys(wire).forEach((id) => {
      const q = wire[id]; const a = answers ? answers[id] : undefined;
      if (a === undefined || a === null) { checks[id] = { ok: false, issues: ['sin respuesta para esta pregunta'] }; return; }
      if (q.type === 'choice') {
        const r = F.verifyChoiceAnswer(a); const issues = r.issues.slice();
        if (typeof a.choice !== 'string' || !(a.choice in q.criteria)) issues.push('choice «' + a.choice + '» no pertenece a las opciones');
        checks[id] = { ok: issues.length === 0, issues };
      } else if (q.type === 'score') checks[id] = F.verifyScoreAnswer(a, q.criteria.length);
      else checks[id] = F.verifyNoulAnswer(a);
    });
    return checks;
  }

  function apiErrorMessage(status, data, text) {
    let m = '';
    if (data && data.error) m = typeof data.error === 'string' ? data.error : (data.error.message || JSON.stringify(data.error));
    else if (data && data.message) m = String(data.message);
    if (!m) m = status === 404 ? 'La interfaz de servidor no responde (api/systemone): abra la aplicación con INICIAR (servidor Python), no como archivo.' : 'HTTP ' + status + (text && text.length < 160 ? ': ' + text : '');
    return m + ' [HTTP ' + status + ']';
  }

  async function postJev(state, wire, signal, context) {
    const headers = { 'Content-Type': 'application/json' };
    if (context.apiKey) headers['X-Jev-Api-Key'] = context.apiKey;
    const body = JSON.stringify({ state, model: context.model, questions: wire });
    for (let attempt = 1; ; attempt++) {
      if (signal.aborted) throw new DOMException('Abortado', 'AbortError');
      let res;
      S.runInfo.apiRequests++;
      try { res = await fetch('api/systemone', { method: 'POST', headers, body, signal, cache: 'no-store', credentials: 'same-origin' }); } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        if (attempt < LIMITS.retries) { await sleep(Math.min(8000, 700 * 2 ** (attempt - 1)) + Math.random() * 300, signal); continue; }
        throw new Error(location.protocol === 'file:' ? 'La página se abrió como archivo: el modo real necesita el servidor local de Python (INICIAR.bat / iniciar.sh).' : 'Sin conexión con el servidor local. ¿Sigue abierta la ventana de INICIAR?');
      }
      const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch (e) { /* no JSON */ }
      if (res.ok) {
        if (!data || typeof data.answers !== 'object' || data.answers === null) throw new Error('La respuesta no contiene «answers».');
        return { data: { model: data.model, answers: data.answers, usage: data.usage || null }, attempts: attempt };
      }
      if ((res.status === 429 || res.status === 503 || res.status === 529) && attempt < LIMITS.retries) {
        const ra = Number(res.headers.get('Retry-After'));
        await sleep(ra > 0 && ra <= 60 ? ra * 1000 : Math.min(15000, 1000 * 2 ** (attempt - 1)) + Math.random() * 400, signal); continue;
      }
      throw new Error(apiErrorMessage(res.status, data, text));
    }
  }

  function setRunUi(running) {
    S.running = running;
    paintCache();
    $('run-btn').disabled = running; $('cancel-btn').classList.toggle('hidden', !running);
    $('run-progress').classList.toggle('hidden', !running);
  }

  function setProgress(done, total) { $('run-progress').textContent = done + ' / ' + total; }

  async function runClassification() {
    if (S.running) return;
    banner(null);
    const { wire, errors } = compile();
    if (errors.length) { banner('error', 'Esquema no válido: ' + errors[0] + (errors.length > 1 ? ' (+' + (errors.length - 1) + ' más)' : '')); switchTab('workspace'); return; }
    const { items, skipped } = currentItems();
    if (!items.length) { banner('error', 'No hay contenido que clasificar.'); switchTab('workspace'); return; }
    const live = S.mode === 'live';
    const context = { model: S.model, apiKey: S.apiKey, useCache: S.cacheEnabled };
    if (items.length > (live ? LIMITS.liveRows : LIMITS.simRows)) { banner('error', 'Demasiados registros para este modo (' + items.length + '; máximo ' + (live ? LIMITS.liveRows : LIMITS.simRows) + ').'); return; }
    if (live) {
      const big = items.find((it) => JSON.stringify(it.state).length > LIMITS.liveStateChars);
      if (big) { banner('error', 'El registro ' + big.n + ' supera ' + LIMITS.liveStateChars.toLocaleString('es-ES') + ' caracteres.'); return; }
      if (S.apiKey && !KEY_RE.test(S.apiKey)) { banner('error', 'La clave de API tiene un formato inválido.'); return; }
      if (items.length > 25 && typeof window.confirm === 'function' && !window.confirm((context.useCache ? 'Se enviarán hasta ' : 'Se enviarán ') + items.length + ' peticiones a la API de TypeSafe (consumen cuota).' + (context.useCache ? ' Se reutilizarán las coincidencias guardadas y los duplicados.' : '') + ' ¿Continuar?')) return;
    }
    S.results = []; S.shown = LIMITS.page; S.controller = new AbortController();
    S.runInfo = { mode: S.mode, model: live ? context.model : SIM.SIM_MODEL_ID, total: items.length, skipped, started: Date.now(), finished: null, cancelled: false, wire, cacheHits: 0, apiRequests: 0 };
    setRunUi(true); setProgress(0, items.length);
    const out = new Array(items.length);
    let done = 0; let fatalMsg = null;
    const record = (idx, it, extra) => {
      out[idx] = Object.assign({ n: it.n, label: it.label, state: it.state }, extra);
      done++; setProgress(done, items.length);
    };
    try {
      if (!live) {
        for (let k = 0; k < items.length; k++) {
          if (S.controller.signal.aborted) break;
          const it = items[k];
          try {
            const r = SIM.simulate(it.state, wire);
            record(k, it, { ok: true, model: r.model, answers: r.answers, usage: r.usage, trace: r.trace, ms: r.simulated_latency_ms, simulated: true, checks: verifyAll(wire, r.answers) });
          } catch (e) { record(k, it, { ok: false, error: 'Error del simulador: ' + (e && e.message ? e.message : e), simulated: true }); }
          if (k % 20 === 19) await sleep(0);
        }
      } else {
        let next = 0; let fatal = null;
        const worker = async () => {
          while (!fatal && !S.controller.signal.aborted) {
            const k = next++; if (k >= items.length) return;
            const it = items[k]; const t0 = performance.now();
            try {
              const signal = S.controller.signal;
              const response = await jevCache.execute({ state: it.state, model: context.model, questions: wire }, context.apiKey || 'server-key',
                () => postJev(it.state, wire, signal, context),
                { enabled: context.useCache, canStore: value => !signal.aborted && Object.values(verifyAll(wire, value.data.answers)).every(check => check.ok) });
              if (signal.aborted) return;
              const { data, attempts } = response.value;
              if (response.cached) S.runInfo.cacheHits++;
              record(k, it, { ok: true, model: data.model || context.model, answers: data.answers, usage: data.usage || null, ms: Math.round(performance.now() - t0), simulated: false, attempts: response.cached ? 0 : attempts, cached: response.cached, cachedAt: response.savedAt, checks: verifyAll(wire, data.answers) });
              paintCache();
            } catch (e) {
              if (e && e.name === 'AbortError') return;
              const msg = e && e.message ? e.message : String(e);
              record(k, it, { ok: false, error: msg, ms: Math.round(performance.now() - t0), simulated: false });
              if (/\[HTTP (401|403)\]/.test(msg)) fatal = msg; // credenciales: seguir sería inútil
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(LIMITS.concurrency, items.length) }, worker));
        fatalMsg = fatal;
      }
    } finally {
      S.results = out.filter(Boolean);
      S.runInfo.finished = Date.now(); S.runInfo.cancelled = S.controller.signal.aborted;
      setRunUi(false); S.controller = null;
    }
    const failed = S.results.filter((r) => !r.ok).length;
    if (fatalMsg) banner('error', 'Ejecución detenida tras ' + S.results.length + ' de ' + items.length + ' registros: ' + fatalMsg);
    else if (S.runInfo.cancelled) banner('warn', 'Ejecución cancelada: se conservan ' + S.results.length + ' de ' + items.length + ' resultados.');
    else if (failed) banner('warn', failed + ' de ' + S.results.length + ' registros fallaron; consulte el detalle en la tabla.');
    renderResults(); switchTab('results');
  }

  /* ───────────────────────── resultados ───────────────────────── */

  function scoreProbArray(a, n) { const p = []; for (let i = 0; i < n; i++) { const v = a.probabilities ? (a.probabilities[String(i)] !== undefined ? a.probabilities[String(i)] : a.probabilities[i]) : undefined; p.push(Number(v)); } return p; }

  function bar(p, color) { return '<div class="h-1.5 bg-swiss-grayLight w-full"><div class="h-1.5 ' + color + '" style="width:' + Math.max(0, Math.min(100, p * 100)).toFixed(1) + '%"></div></div>'; }

  const DECISION = { yes: ['SÍ', 'bg-green-100 text-green-900 border-green-400'], no: ['NO', 'bg-gray-100 text-gray-800 border-gray-400'], review: ['REVISAR', 'bg-yellow-100 text-yellow-900 border-yellow-500'] };

  function noulDecisionOf(p) { return F.noulDecision(p, S.noulNo, S.noulYes); }

  function resultChips(r, wire) {
    return Object.keys(wire).map((id) => {
      const q = wire[id]; const a = r.answers ? r.answers[id] : undefined; const ck = r.checks ? r.checks[id] : null;
      const warn = ck && !ck.ok ? ' <span class="text-swiss-red" title="' + esc(ck.issues.join('; ')) + '">⚠</span>' : '';
      let main = '<span class="text-swiss-grayDark">sin respuesta</span>';
      if (a) {
        if (q.type === 'choice') main = '<span class="font-bold">' + esc(a.choice) + '</span> <span class="text-swiss-grayDark">· conf. ' + fmt(Number(a.confidence), 2) + '</span>';
        else if (q.type === 'score') { const n = q.criteria.length; const s = Number(a.score); main = '<span class="font-bold">' + fmt(s, 2) + '</span> <span class="text-swiss-grayDark">/ ' + (n - 1) + ' · nivel ' + F.nearestLevel(s, n) + ' · norm. ' + fmt(F.normalizedScore(s, n), 2) + ' · conf. ' + fmt(Number(a.confidence), 2) + '</span>'; }
        else { const v = Number(a.noul); const d = DECISION[noulDecisionOf(v)]; main = '<span class="font-bold">' + fmt(v, 3) + '</span> <span class="px-1.5 border ' + d[1] + '">' + d[0] + '</span>'; }
      }
      return '<div class="py-0.5"><span class="font-mono text-[11px] bg-swiss-grayBg border border-swiss-border px-1 mr-1.5">' + esc(id) + '</span>' + main + warn + '</div>';
    }).join('');
  }

  function resultDetail(r, wire) {
    let h = '';
    Object.keys(wire).forEach((id) => {
      const q = wire[id]; const a = r.answers ? r.answers[id] : undefined; if (!a) return;
      h += '<div class="mt-3"><div class="font-mono text-[11px] font-bold uppercase">' + esc(id) + ' · ' + q.type + '</div>';
      if (q.type === 'choice' && a.probabilities) {
        Object.keys(a.probabilities).sort((x, y) => a.probabilities[y] - a.probabilities[x]).forEach((k) => {
          h += '<div class="grid grid-cols-12 gap-2 items-center py-0.5"><span class="col-span-3 font-mono truncate' + (k === a.choice ? ' font-bold' : '') + '" title="' + esc(k) + '">' + esc(k) + '</span><div class="col-span-7">' + bar(a.probabilities[k], k === a.choice ? 'bg-swiss-red' : 'bg-swiss-grayMid') + '</div><span class="col-span-2 font-mono text-right">' + fmt(a.probabilities[k], 3) + '</span></div>';
        });
      } else if (q.type === 'score') {
        const p = scoreProbArray(a, q.criteria.length);
        p.forEach((v, i) => { h += '<div class="grid grid-cols-12 gap-2 items-center py-0.5"><span class="col-span-1 font-mono">' + i + '</span><span class="col-span-4 truncate" title="' + esc(q.criteria[i]) + '">' + esc(clip(q.criteria[i], 48)) + '</span><div class="col-span-5">' + bar(isFinite(v) ? v : 0, 'bg-swiss-red') + '</div><span class="col-span-2 font-mono text-right">' + fmt(v, 3) + '</span></div>'; });
      } else if (q.type === 'noul') {
        h += '<div class="font-mono">noul = ' + fmt(Number(a.noul), 4) + ' · confianza derivada |2p−1| = ' + fmt(F.noulConfidence(Number(a.noul)), 3) + '</div>';
      }
      const ck = r.checks && r.checks[id];
      h += ck ? '<div class="mt-1 font-mono ' + (ck.ok ? 'text-green-800' : 'text-swiss-red') + '">' + (ck.ok ? '✓ coherente con las fórmulas de la documentación' : '⚠ ' + esc(ck.issues.join(' · '))) + '</div>' : '';
      const tr = r.trace && r.trace[id];
      if (tr && tr.steps) h += '<details class="mt-1"><summary class="cursor-pointer font-mono underline text-[11px]">Traza del cálculo simulado</summary><pre class="mt-1 p-2 bg-swiss-grayBg border border-swiss-border font-mono text-[11px] whitespace-pre-wrap break-words">' + esc(tr.steps.join('\n')) + '</pre>' +
        (tr.activeConcepts && tr.activeConcepts.length ? '<div class="mt-1 text-[11px] font-mono text-swiss-grayDark">Conceptos detectados: ' + tr.activeConcepts.map((c) => esc(c.name) + ' (' + fmt(c.value, 2) + ')').join(', ') + '</div>' : '') + '</details>';
      h += '</div>';
    });
    if (r.cached) h += '<div class="mt-3 font-mono text-[11px]">Respuesta real de Jev reutilizada · guardada el ' + esc(new Date(r.cachedAt).toLocaleString('es-ES')) + '. Sin nueva consulta.</div>';
    if (r.usage) h += '<div class="mt-3 font-mono text-[11px] text-swiss-grayDark">tokens entrada/salida: ' + esc(r.usage.input_tokens) + ' / ' + esc(r.usage.output_tokens) + (r.cached ? ' (consulta original)' : r.simulated ? ' (estimados)' : '') + '</div>';
    return h;
  }

  function lastWire() { return S.runInfo && S.runInfo.wire ? S.runInfo.wire : compile().wire; }

  function resultMatches(r, needle) {
    if (!needle) return true;
    const hay = (r.label + ' ' + (r.error || '') + ' ' + JSON.stringify(r.answers || {})).toLowerCase();
    return hay.indexOf(needle) >= 0;
  }

  function renderResults() {
    const wire = lastWire();
    const R = S.results; $('results-count').textContent = String(R.length);
    const okR = R.filter((r) => r.ok); const bad = R.length - okR.length;
    let confSum = 0; let confN = 0; let noulReview = 0; let noulN = 0; let msSum = 0; let msN = 0; let tin = 0; let tout = 0; let tokN = 0; let warn = 0;
    okR.forEach((r) => {
      Object.keys(wire).forEach((id) => {
        const a = r.answers[id]; if (!a) return;
        if ((wire[id].type === 'choice' || wire[id].type === 'score') && F.isNum(Number(a.confidence))) { confSum += Number(a.confidence); confN++; }
        if (wire[id].type === 'noul' && F.isNum(Number(a.noul))) { noulN++; if (noulDecisionOf(Number(a.noul)) === 'review') noulReview++; }
      });
      if (typeof r.ms === 'number') { msSum += r.ms; msN++; }
      if (r.usage && !r.cached) { tin += Number(r.usage.input_tokens) || 0; tout += Number(r.usage.output_tokens) || 0; tokN++; }
      if (r.checks && Object.keys(r.checks).some((k) => !r.checks[k].ok)) warn++;
    });
    const sim = S.runInfo ? S.runInfo.mode === 'sim' : true;
    const card = (t, v, sub, cls) => '<div class="bg-white border border-swiss-border p-4"><div class="text-[11px] font-mono uppercase text-swiss-grayDark font-semibold">' + t + '</div><div class="text-2xl font-black mt-1 ' + (cls || '') + '">' + v + '</div><div class="text-[10px] font-mono text-swiss-grayDark mt-1">' + sub + '</div></div>';
    $('metrics').innerHTML =
      card('Evaluados', R.length, bad ? '<span class="text-swiss-red">' + bad + ' con error</span>' : 'sin errores') +
      card('Confianza media', confN ? pct(confSum / confN) : '—', 'Choice y Score (Noul no devuelve confianza)', 'text-swiss-red') +
      card(sim ? 'Latencia estimada' : 'Latencia medida', msN ? Math.round(msSum / msN) + ' ms' : '—', sim ? 'modelo determinista; no es una medición' : S.runInfo && S.runInfo.cacheHits ? 'por registro; incluye lecturas de caché' : 'por petición, incluye reintentos', 'font-mono') +
      card('Tokens', tokN ? (tin + tout).toLocaleString('es-ES') : !sim && S.runInfo && S.runInfo.cacheHits === R.length && R.length ? '0' : '—', tokN ? tin + ' entrada · ' + tout + ' salida' + (sim ? ' (estimados)' : '') : !sim && S.runInfo && S.runInfo.cacheHits ? 'sin nuevo consumo en resultados reutilizados' : 'no informados') +
      '<div class="bg-white border border-swiss-border p-4"><div class="text-[11px] font-mono uppercase text-swiss-grayDark font-semibold">Umbrales Noul</div><div class="flex items-center gap-1.5 mt-2 text-xs font-mono">NO ≤ <input type="number" id="noul-no" min="0" max="0.49" step="0.05" value="' + S.noulNo + '" class="w-14 border border-swiss-border px-1 py-0.5"> SÍ ≥ <input type="number" id="noul-yes" min="0.51" max="1" step="0.05" value="' + S.noulYes + '" class="w-14 border border-swiss-border px-1 py-0.5"></div><div class="text-[10px] font-mono text-swiss-grayDark mt-1">entre ambos: revisión humana</div></div>';
    const nb = $('noul-review');
    nb.classList.toggle('hidden', !noulN);
    if (noulN) nb.textContent = noulReview + ' de ' + noulN + ' respuestas Noul caen en la zona de revisión (' + S.noulNo + ' < p < ' + S.noulYes + '). Con estos umbrales no deben automatizarse.';
    const info = [];
    if (S.runInfo) {
      info.push((sim ? 'Simulación · ' + S.runInfo.model : 'API real · ' + S.runInfo.model));
      if (!sim) info.push(cacheRunSummary(S.runInfo));
      if (S.runInfo.skipped) info.push(S.runInfo.skipped + ' filas vacías omitidas');
      if (warn) info.push(warn + ' con discrepancias de fórmula');
    }
    const needle = S.filter.trim().toLowerCase();
    const filtered = R.filter((r) => resultMatches(r, needle));
    $('table-info').textContent = info.join(' · ') + (needle ? ' · ' + filtered.length + ' coincidencias' : '');
    const rows = filtered.slice(0, S.shown).map((r) => {
      const ver = !r.ok ? '<span class="text-swiss-red font-bold">ERROR</span>' : (Object.keys(r.checks || {}).every((k) => r.checks[k].ok) ? '<span class="text-green-800 font-bold">✓ coherente</span>' : '<span class="text-swiss-red font-bold">⚠ discrepancia</span>');
      return '<tr class="align-top"><td class="p-3 text-center font-mono text-swiss-grayDark">' + r.n + '</td>' +
        '<td class="p-3"><div class="whitespace-pre-wrap break-words" title="' + esc(clip(r.label, 600)) + '">' + esc(clip(r.label, 220)) + '</div><button data-act="to-entities" data-n="' + r.n + '" class="mt-1.5 text-[11px] font-mono underline hover:text-swiss-red">→ extraer entidades de este texto</button></td>' +
        '<td class="p-3">' + (r.ok ? resultChips(r, wire) + '<details class="mt-1.5"><summary class="cursor-pointer font-mono underline text-[11px]">Detalle</summary>' + resultDetail(r, wire) + '</details>' : '<div class="text-swiss-red font-mono break-words">' + esc(r.error) + '</div>') + '</td>' +
        '<td class="p-3 text-right font-mono text-[11px]">' + ver + (r.cached ? '<div class="mt-1 text-swiss-grayDark">caché · sin nueva consulta</div>' : '') + (r.attempts > 1 ? '<div class="text-swiss-grayDark">' + r.attempts + ' intentos</div>' : '') + '</td></tr>';
    }).join('');
    const more = filtered.length > S.shown ? '<tr><td colspan="4" class="p-3 text-center"><button data-act="more-rows" class="px-3 py-1 border border-swiss-black text-xs font-mono hover:bg-swiss-black hover:text-white">Mostrar más (' + (filtered.length - S.shown) + ' restantes)</button></td></tr>' : '';
    $('results-body').innerHTML = rows + more || '<tr><td colspan="4" class="p-8 text-center text-swiss-grayDark font-mono text-xs">' + (R.length ? 'Ningún resultado coincide con la búsqueda.' : 'Sin ejecuciones. Defina el esquema y pulse «Ejecutar clasificación».') + '</td></tr>';
  }

  /* ───────────────────────── exportación ───────────────────────── */

  function exportCsv() {
    if (!S.results.length) { toast('No hay resultados que exportar.'); return; }
    const wire = lastWire(); const d = $('export-delim').value || ';';
    const cols = ['fila', 'estado_texto', 'motor', 'modelo', 'error', 'reutilizado_cache', 'cache_guardado'];
    Object.keys(wire).forEach((id) => {
      const q = wire[id];
      if (q.type === 'choice') { cols.push(id + '__choice', id + '__confidence'); Object.keys(q.criteria).forEach((k) => cols.push(id + '__p__' + k)); } else if (q.type === 'score') { cols.push(id + '__score', id + '__normalizado', id + '__nivel_mas_cercano', id + '__confidence'); q.criteria.forEach((_, i) => cols.push(id + '__p__' + i)); } else cols.push(id + '__noul', id + '__confianza_derivada', id + '__decision');
    });
    cols.push('verificacion');
    const lines = [cols.map((c) => csvCell(c, d)).join(d)];
    S.results.forEach((r) => {
      const v = [r.n, typeof r.state === 'string' ? r.state : JSON.stringify(r.state), r.simulated ? 'simulación' : 'api', r.model || '', r.error || '', !!r.cached, r.cachedAt ? new Date(r.cachedAt).toISOString() : ''];
      Object.keys(wire).forEach((id) => {
        const q = wire[id]; const a = r.answers ? r.answers[id] : null;
        if (q.type === 'choice') { v.push(a ? a.choice : '', a ? Number(a.confidence) : ''); Object.keys(q.criteria).forEach((k) => v.push(a && a.probabilities ? Number(a.probabilities[k]) : '')); } else if (q.type === 'score') {
          const n = q.criteria.length; const s = a ? Number(a.score) : NaN;
          v.push(a ? s : '', a ? F.normalizedScore(s, n) : '', a ? F.nearestLevel(s, n) : '', a ? Number(a.confidence) : ''); const p = a ? scoreProbArray(a, n) : []; for (let i = 0; i < n; i++) v.push(a ? p[i] : '');
        } else { const x = a ? Number(a.noul) : NaN; v.push(a ? x : '', a ? F.noulConfidence(x) : '', a ? noulDecisionOf(x) : ''); }
      });
      v.push(!r.ok ? 'error' : (Object.keys(r.checks || {}).every((k) => r.checks[k].ok) ? 'coherente' : 'discrepancia'));
      lines.push(v.map((x) => csvCell(x, d)).join(d));
    });
    download('jev_resultados.csv', 'text/csv;charset=utf-8', '\uFEFF' + lines.join('\r\n') + '\r\n');
    toast('CSV exportado (' + S.results.length + ' filas)');
  }

  function exportJson() {
    if (!S.results.length) { toast('No hay resultados que exportar.'); return; }
    const payload = { exported_at: new Date().toISOString(), engine: S.runInfo ? S.runInfo.mode : null, model: S.runInfo ? S.runInfo.model : null, noul_thresholds: { no: S.noulNo, yes: S.noulYes }, questions: lastWire(), results: S.results.map((r) => ({ row: r.n, state: r.state, ok: r.ok, error: r.error || null, answers: r.answers || null, checks: r.checks || null, usage: r.usage || null, latency_ms: r.ms === undefined ? null : r.ms, latency_is_estimate: !!r.simulated, reused_from_cache: !!r.cached, original_response_at: r.cachedAt ? new Date(r.cachedAt).toISOString() : null, trace: r.trace || null })) };
    download('jev_resultados.json', 'application/json', JSON.stringify(payload, null, 2));
    toast('JSON exportado');
  }

  /* ───────────────────────── navegación y modales ───────────────────────── */

  const VIEWS = ['workspace', 'results', 'entities', 'lab', 'payload'];
  function switchTab(name) {
    S.tab = name;
    VIEWS.forEach((v) => {
      const on = v === name; const view = $('view-' + v); const btn = $('tab-btn-' + v);
      view.classList.toggle('hidden', !on);
      btn.className = 'tab-btn py-3.5 px-2 whitespace-nowrap border-b-2 ' + (on ? 'border-swiss-red text-swiss-black' : 'border-transparent text-swiss-grayDark hover:text-swiss-black');
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (tabHooks[name]) tabHooks[name]();
    if (name === 'results') renderResults();
  }

  let lastFocus = null;
  function openModal(id) {
    lastFocus = document.activeElement;
    if (id === 'config-modal') fillConfig();
    $(id).classList.remove('hidden');
    const f = $(id).querySelector('input:not([type=radio]),select,button'); if (f) f.focus();
  }
  function closeModals() { ['config-modal', 'help-modal'].forEach((m) => $(m).classList.add('hidden')); if (lastFocus && lastFocus.focus) lastFocus.focus(); }

  function paintModeLabels(mode) {
    $('label-mode-sim').className = 'border-2 p-3 cursor-pointer flex flex-col ' + (mode === 'sim' ? 'border-swiss-red bg-red-50' : 'border-swiss-border');
    $('label-mode-live').className = 'border-2 p-3 cursor-pointer flex flex-col ' + (mode === 'live' ? 'border-swiss-red bg-red-50' : 'border-swiss-border');
    $('live-fields').classList.toggle('opacity-50', mode !== 'live'); $('live-fields').classList.toggle('pointer-events-none', mode !== 'live');
  }

  function fillConfig() {
    document.querySelectorAll('input[name=exec-mode]').forEach((r) => { r.checked = r.value === S.mode; });
    $('api-key').value = S.apiKey; $('model-select').value = S.model; paintModeLabels(S.mode);
  }

  function saveConfig() {
    const mode = (document.querySelector('input[name=exec-mode]:checked') || {}).value === 'live' ? 'live' : 'sim';
    const key = $('api-key').value.trim(); const model = $('model-select').value;
    if (key && !KEY_RE.test(key)) { toast('La clave tiene un formato inválido (8–512 caracteres ASCII visibles).'); return; }
    if (!MODELS.includes(model)) { toast('Modelo no reconocido.'); return; }
    S.mode = mode; S.apiKey = key; S.model = model;
    store.set('localStorage', 'jev2_mode', mode); store.set('localStorage', 'jev2_model', model);
    if (key) store.set('sessionStorage', 'jev2_key', key); else store.del('sessionStorage', 'jev2_key');
    closeModals();
    try { paintMode(); refreshDerived(); } catch (err) { console.error('No se pudo repintar tras guardar la configuración:', err); }
    toast(mode === 'live' ? 'Configuración guardada · modo System One real' + (key ? ' · clave cargada en esta pestaña' : ' · sin clave en el navegador (se usará la del servidor)') : 'Configuración guardada · modo simulación');
  }

  function paintMode() {
    const live = S.mode === 'live';
    $('mode-badge').className = 'px-2.5 py-1 border text-xs font-mono flex items-center space-x-1.5 ' + (live ? 'bg-green-50 border-green-400 text-green-900' : 'bg-yellow-50 border-yellow-300 text-yellow-900');
    $('mode-dot').className = 'w-2 h-2 rounded-full ' + (live ? 'bg-green-600' : 'bg-yellow-500');
    $('mode-text').textContent = live ? 'API real · ' + S.model : 'Simulación';
    const sub = $('app-subtitle'); if (sub) sub.textContent = 'Clasificación con TypeSafe AI · ' + (live ? 'API real' : 'Simulación sin API') + ' · Extracción de entidades con GLiNER';
    paintCache();
  }

  function paintInputMode() {
    const single = S.inputMode === 'single';
    $('single-box').classList.toggle('hidden', !single); $('batch-box').classList.toggle('hidden', single);
    $('mode-single-btn').className = 'px-3 py-1 ' + (single ? 'bg-swiss-black text-white' : 'bg-white hover:bg-swiss-grayBg');
    $('mode-batch-btn').className = 'px-3 py-1 ' + (!single ? 'bg-swiss-black text-white' : 'bg-white hover:bg-swiss-grayBg');
    $('single-box').setAttribute('aria-hidden', String(!single));
  }

  /* ───────────────────────── plantillas ───────────────────────── */

  /* Plantillas propias de preguntas (localStorage + JSON). Mismo formato que PRE.PRESETS. */
  const DEF_KEY = 'jev2_def_custom';
  const DEF_SAMPLES_MAX = 20; const DEF_TEXT_MAX = 5000;
  let defCustom = {};

  function validDefTemplate(t) {
    if (!t || typeof t !== 'object' || typeof t.label !== 'string' || !t.label.trim() || t.label.length > 60) return null;
    if (!t.questions || typeof t.questions !== 'object' || Array.isArray(t.questions)) return null;
    const names = Object.keys(t.questions);
    if (!names.length || names.length > LIMITS.questions) return null;
    const questions = {};
    for (const n of names) {
      const q = t.questions[n];
      if (!ID_RE.test(n) || !q || typeof q !== 'object' || !['choice', 'score', 'noul'].includes(q.primitive)) return null;
      if (q.instructions !== undefined && (typeof q.instructions !== 'string' || q.instructions.length > 5000)) return null;
      const out = { primitive: q.primitive, instructions: q.instructions || '' };
      if (q.primitive === 'choice') {
        if (!q.criteria || typeof q.criteria !== 'object' || Array.isArray(q.criteria)) return null;
        const keys = Object.keys(q.criteria); if (!keys.length || keys.length > LIMITS.options) return null;
        out.criteria = {};
        for (const k of keys) { const d = q.criteria[k]; if (!(d === null || typeof d === 'string') || (d && d.length > 2000) || k.length > 200) return null; out.criteria[k] = d; }
      } else if (q.primitive === 'score') {
        if (!Array.isArray(q.criteria) || q.criteria.length < LIMITS.scoreMin || q.criteria.length > LIMITS.scoreMax || q.criteria.some((x) => typeof x !== 'string' || x.length > 2000)) return null;
        out.criteria = q.criteria.slice();
      } else if (q.criteria !== undefined && q.criteria !== null) {
        if (typeof q.criteria !== 'object' || Array.isArray(q.criteria)) return null;
        out.criteria = { true: String(q.criteria.true || '').slice(0, 2000), false: String(q.criteria.false || '').slice(0, 2000) };
      }
      questions[n] = out;
    }
    const samples = (Array.isArray(t.samples) ? t.samples : []).filter((x) => x && typeof x.text === 'string' && x.text.trim() && x.text.length <= DEF_TEXT_MAX).slice(0, DEF_SAMPLES_MAX).map((x) => ({ text: x.text }));
    return { label: t.label.trim(), questions, samples, custom: true };
  }
  function loadDefCustom() {
    defCustom = {};
    let raw = null; try { raw = JSON.parse(store.get('localStorage', DEF_KEY) || 'null'); } catch (e) { raw = null; }
    if (!raw || typeof raw !== 'object') return;
    Object.keys(raw).forEach((id) => { if (/^user_[a-z0-9_]{1,50}$/.test(id)) { const t = validDefTemplate(raw[id]); if (t) defCustom[id] = t; } });
  }
  function defPlain(t) { return { label: t.label, questions: t.questions, samples: t.samples }; }
  function persistDefCustom() { const o = {}; Object.keys(defCustom).forEach((id) => { o[id] = defPlain(defCustom[id]); }); store.set('localStorage', DEF_KEY, JSON.stringify(o)); }
  function getPreset(key) { return PRE.PRESETS[key] || defCustom[key] || null; }
  function defSlug(name) { return 'user_' + (name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'plantilla'); }
  function paintDefTplButtons() {
    const b = $('def-tpl-delete'); if (!b) return;
    b.disabled = !defCustom[$('preset-select').value]; b.classList.toggle('opacity-40', b.disabled);
  }
  function fillDefSelect(selected) {
    const opt = (k, p) => '<option value="' + esc(k) + '">' + esc(p.label) + '</option>';
    const mine = Object.keys(defCustom);
    $('preset-select').innerHTML = Object.keys(PRE.PRESETS).map((k) => opt(k, PRE.PRESETS[k])).join('') +
      (mine.length ? '<optgroup label="Mis plantillas">' + mine.map((k) => opt(k, defCustom[k])).join('') + '</optgroup>' : '');
    if (selected && getPreset(selected)) $('preset-select').value = selected;
    paintDefTplButtons();
  }
  function specFromQuestions() {
    const spec = {};
    S.questions.forEach((q) => {
      const n = q.name.trim();
      if (q.primitive === 'choice') { const c = {}; q.options.forEach((o) => { c[o.k.trim()] = o.d.trim() === '' ? null : o.d.trim(); }); spec[n] = { primitive: 'choice', instructions: q.instructions.trim(), criteria: c }; }
      else if (q.primitive === 'score') spec[n] = { primitive: 'score', instructions: q.instructions.trim(), criteria: q.levels.map((l) => l.trim()) };
      else { const o = { primitive: 'noul', instructions: q.instructions.trim() }; if (q.tTrue.trim() || q.tFalse.trim()) o.criteria = { true: q.tTrue.trim(), false: q.tFalse.trim() }; spec[n] = o; }
    });
    return spec;
  }
  function saveDefTemplate() {
    const name = $('def-tpl-name').value.trim();
    if (!name) { toast('Escriba un nombre para la plantilla.'); $('def-tpl-name').focus(); return; }
    const { errors } = compile();
    if (errors.length) { toast('Corrija el esquema antes de guardar: ' + errors[0]); return; }
    const samples = [];
    if (S.inputMode === 'batch') currentItems().items.slice(0, DEF_SAMPLES_MAX).forEach((it) => { if (typeof it.label === 'string' && it.label.trim() && it.label.length <= DEF_TEXT_MAX) samples.push({ text: it.label }); });
    else if (S.single.trim() && S.single.length <= DEF_TEXT_MAX) samples.push({ text: S.single });
    const t = validDefTemplate({ label: name, questions: specFromQuestions(), samples });
    if (!t) { toast('No se pudo guardar: el esquema excede los límites de tamaño.'); return; }
    const id = defSlug(name); const existed = !!defCustom[id];
    defCustom[id] = t; persistDefCustom(); S.presetKey = id; fillDefSelect(id); refreshDerived();
    toast((existed ? 'Plantilla «' + name + '» actualizada' : 'Plantilla «' + name + '» guardada') + ' · ' + Object.keys(t.questions).length + ' pregunta(s), ' + t.samples.length + ' texto(s) de ejemplo');
  }
  function deleteDefTemplate() {
    const id = $('preset-select').value; if (!defCustom[id]) return;
    const label = defCustom[id].label; delete defCustom[id]; persistDefCustom();
    if (S.presetKey === id) S.presetKey = Object.keys(PRE.PRESETS)[0];
    fillDefSelect(S.presetKey); refreshDerived(); toast('Plantilla «' + label + '» eliminada (las preguntas actuales no cambian)');
  }
  function exportDefTemplates() {
    if (!Object.keys(defCustom).length) { toast('Aún no hay plantillas propias que exportar.'); return; }
    const o = {}; Object.keys(defCustom).forEach((id) => { o[id] = defPlain(defCustom[id]); });
    download('plantillas_preguntas.json', 'application/json', JSON.stringify({ tipo: 'jev-preguntas-plantillas', version: 1, plantillas: o }, null, 2));
  }
  function importDefTemplates(file) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast('El archivo supera 2 MB.'); return; }
    const fr = new FileReader();
    fr.onerror = () => toast('No se pudo leer el archivo.');
    fr.onload = () => {
      let data; try { data = JSON.parse(String(fr.result).replace(/^\uFEFF/, '')); } catch (e) { toast('El archivo no es un JSON válido.'); return; }
      const src = data && data.plantillas && typeof data.plantillas === 'object' ? data.plantillas : null;
      if (!src) { toast('Formato no reconocido: falta el objeto «plantillas».'); return; }
      let ok = 0, bad = 0;
      Object.keys(src).forEach((k) => { const t = validDefTemplate(src[k]); if (!t) { bad++; return; } defCustom[/^user_[a-z0-9_]{1,50}$/.test(k) ? k : defSlug(t.label)] = t; ok++; });
      persistDefCustom(); fillDefSelect($('preset-select').value);
      toast(ok + ' plantilla(s) importada(s)' + (bad ? '; ' + bad + ' descartada(s) por no ser válidas' : ''));
    };
    fr.readAsText(file);
  }

  function loadPreset(key) {
    const p = getPreset(key); if (!p) return;
    S.presetKey = key; S.questions = questionsFromPreset(p.questions); S.sampleIdx = 0;
    S.single = p.samples.length ? p.samples[0].text : ''; $('single-text').value = S.single;
    $('preset-select').value = key; paintDefTplButtons();
    renderQuestions(); refreshDerived(); toast('Plantilla «' + p.label + '» cargada');
  }

  function loadSamplesAsBatch() {
    const p = getPreset(S.presetKey); if (!p) return;
    if (!p.samples.length) { toast('Esta plantilla no incluye textos de ejemplo.'); return; }
    const q = (t) => '"' + t.replace(/"/g, '""') + '"';
    S.batch.raw = 'id;texto\n' + p.samples.map((s, i) => (i + 1) + ';' + q(s.text)).join('\n');
    $('batch-raw').value = S.batch.raw; S.batch.col = 'texto'; reparseBatch(); toast(p.samples.length + ' ejemplos cargados');
  }

  function nextSample() {
    const p = getPreset(S.presetKey); if (!p || !p.samples.length) return;
    S.sampleIdx = (S.sampleIdx + 1) % p.samples.length; S.single = p.samples[S.sampleIdx].text; $('single-text').value = S.single; refreshDerived();
  }

  /* ───────────────────────── archivos ───────────────────────── */

  function decodeBuffer(buf) {
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), enc: 'UTF-8' }; } catch (e) { /* no es UTF-8 */ }
    try { return { text: new TextDecoder('windows-1252').decode(buf), enc: 'Windows-1252' }; } catch (e) { return { text: new TextDecoder('utf-8').decode(buf), enc: 'UTF-8 (con sustituciones)' }; }
  }

  function onFile(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { banner('error', 'El archivo supera 20 MB.'); return; }
    const fr = new FileReader();
    fr.onerror = () => banner('error', 'No se pudo leer el archivo.');
    fr.onload = () => {
      const d = decodeBuffer(fr.result);
      S.batch.raw = d.text; $('batch-raw').value = d.text; S.batch.col = ''; reparseBatch();
      toast('«' + clip(file.name, 40) + '» leído como ' + d.enc);
    };
    fr.readAsArrayBuffer(file);
  }

  /* ───────────────────────── ayuda ───────────────────────── */

  function helpHtml() {
    return '<p><strong>Dos motores.</strong> La <em>simulación</em> se ejecuta íntegramente en el navegador, sin conexión ni clave: genera primero una distribución de probabilidades determinista a partir del texto y deriva de ella <code>choice</code>, <code>score</code> y <code>confidence</code> con las fórmulas publicadas por TypeSafe. No es el modelo Jev ni reproduce su criterio: sirve para comprender el protocolo, ensayar esquemas y depurar la interfaz. El modo <em>real</em> envía cada texto a <code>api.typesafe.ai</code> mediante <code>jev_server.py</code>.</p>' +
      '<p><strong>Caché de Jev.</strong> En «Contenido a clasificar», «Reutilizar resultados anteriores» evita volver a enviar coincidencias exactas de contenido, preguntas y modelo. Las respuestas verificadas se guardan en este navegador durante 24 horas (hasta 500 entradas y aproximadamente 2 MB); también se comparten las consultas duplicadas de un mismo lote. Desactive el interruptor para volver a consultar Jev o pulse «Vaciar caché». Los resultados identifican las respuestas reutilizadas y no suman sus tokens como consumo nuevo. La caché no se utiliza para la simulación ni para GLiNER.</p>' +
      '<p><strong>Fórmulas (docs.typesafe.ai/confidence).</strong> Choice: <code>(p_max − 1/n)/(1 − 1/n)</code>. Score: <code>score = Σ i·p_i</code>; <code>confidence = max(0, 1 − Σ p_i·|i − m| / MAD_unif)</code> con <code>m</code> la moda y <code>MAD_unif = (1/n)·Σ|i − (n−1)/2|</code>; valor normalizado <code>score/(n−1)</code>. Noul devuelve solo <code>noul ∈ [0,1]</code>; la confianza derivada que se muestra es <code>|2p − 1|</code>. La pestaña «Laboratorio» permite comprobarlas con los ejemplos de la documentación.</p>' +
      '<p><strong>Límites documentados que se validan.</strong> Choice hasta 255 opciones; Score de 2 a 10 niveles; JSON con profundidad máxima 64; cuerpo hasta 32 MiB (este proxy limita a 1 MiB por registro). Los errores 429 y 529 se reintentan con espera exponencial y respeto de <code>Retry-After</code>.</p>' +
      '<p><strong>Seguridad.</strong> La clave de API nunca se escribe en disco desde el navegador; lo recomendable es definir <code>TYPESAFE_API_KEY</code> o <code>config.local.json</code> en el servidor. <code>jev_server.py</code> valida el esquema, comprueba <code>Host</code>, <code>Origin</code> y <code>Sec-Fetch-Site</code>, aplica un límite por IP, verifica siempre el certificado TLS y no concede CORS. El servidor (<code>jev_server.py</code>) solo publica la interfaz, los dos puntos de acceso y los recursos estáticos, con una política CSP estricta.</p>' +
      '<p><strong>Privacidad.</strong> En simulación ningún texto sale del navegador. En modo real el texto se envía a TypeSafe AI; no incluya datos personales sin base legal. El módulo GLiNER se ejecuta en su ordenador (<code>127.0.0.1</code>) y no transmite el texto a terceros.</p>' +
      '<p><strong>Entidades.</strong> Con GLiNER2 instalado (<code>INSTALAR_GLINER</code>) la pestaña 3 usa el modelo real; sin él, recurre a una simulación léxica que localiza solo patrones evidentes (fechas, cifras, correos, ejemplos citados en la descripción de la etiqueta).</p>';
  }

  /* ───────────────────────── arranque y eventos ───────────────────────── */

  function onClick(e) {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const act = el.dataset.act; const q = S.questions.find((x) => String(x.uid) === el.dataset.q);
    if (actions[act]) { actions[act](el, e); return; }
    switch (act) {
      case 'tab': switchTab(el.dataset.tab); break;
      case 'run': runClassification(); break;
      case 'cancel': if (S.controller) S.controller.abort(); break;
      case 'jev-cache-clear': jevCache.clear(); paintCache(); toast('Caché de Jev vaciada'); break;
      case 'open-modal': openModal(el.dataset.modal); break;
      case 'close-modal': closeModals(); break;
      case 'save-config': saveConfig(); break;
      case 'toggle-key': { const i = $('api-key'); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; el.textContent = show ? 'Ocultar' : 'Mostrar'; break; }
      case 'input-mode': S.inputMode = el.dataset.mode; paintInputMode(); if (S.inputMode === 'batch') reparseBatch(); else refreshDerived(); break;
      case 'def-tpl-save': saveDefTemplate(); break;
      case 'def-tpl-delete': deleteDefTemplate(); break;
      case 'def-tpl-export': exportDefTemplates(); break;
      case 'def-tpl-import': $('def-tpl-file').click(); break;
      case 'load-preset': loadPreset($('preset-select').value); break;
      case 'load-samples': loadSamplesAsBatch(); break;
      case 'next-sample': nextSample(); break;
      case 'add-question': { const nq = newQuestion(el.dataset.primitive, uniqueName(el.dataset.primitive === 'choice' ? 'clasificacion' : el.dataset.primitive === 'score' ? 'puntuacion' : 'criterio')); S.questions.push(nq); renderQuestions(); refreshDerived(); break; }
      case 'remove-question': S.questions = S.questions.filter((x) => x !== q); renderQuestions(); refreshDerived(); break;
      case 'add-option': if (q) { q.options.push({ k: '', d: '' }); renderQuestions(); refreshDerived(); } break;
      case 'remove-option': if (q) { q.options.splice(Number(el.dataset.i), 1); renderQuestions(); refreshDerived(); } break;
      case 'add-level': if (q) { q.levels.push(''); renderQuestions(); refreshDerived(); } break;
      case 'remove-level': if (q) { q.levels.splice(Number(el.dataset.i), 1); renderQuestions(); refreshDerived(); } break;
      case 'export-csv': exportCsv(); break;
      case 'export-json': exportJson(); break;
      case 'more-rows': S.shown += LIMITS.page; renderResults(); break;
      case 'copy': copyText($(el.dataset.target).textContent); break;
      default: break;
    }
  }

  function boot() {
    // Restaurar preferencias (la clave solo desde sessionStorage).
    const m = store.get('localStorage', 'jev2_mode'); S.mode = m === 'live' ? 'live' : 'sim';
    const md = store.get('localStorage', 'jev2_model'); S.model = MODELS.includes(md) ? md : 'jev-latest';
    S.apiKey = store.get('sessionStorage', 'jev2_key') || '';
    S.cacheEnabled = store.get('localStorage', 'jev_cache_enabled') !== '0';
    ['jev_api_key', 'jev_endpoint', 'jev_use_proxy'].forEach((k) => store.del('localStorage', k)); // restos de versiones anteriores

    loadDefCustom(); fillDefSelect(S.presetKey);
    $('preset-select').addEventListener('change', paintDefTplButtons);
    $('def-tpl-file').addEventListener('change', (e) => { importDefTemplates(e.target.files[0]); e.target.value = ''; });
    $('help-body').innerHTML = helpHtml();

    document.addEventListener('click', onClick);
    $('jev-cache-enabled').addEventListener('change', (e) => { S.cacheEnabled = e.target.checked; store.set('localStorage', 'jev_cache_enabled', S.cacheEnabled ? '1' : '0'); paintCache(); });
    document.addEventListener('input', (e) => { if (e.target.dataset && e.target.dataset.q && e.target.dataset.f) onQuestionInput(e.target); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModals(); });
    document.querySelectorAll('input[name=exec-mode]').forEach((r) => r.addEventListener('change', () => paintModeLabels(r.value)));
    $('single-text').addEventListener('input', (e) => { S.single = e.target.value; refreshDerived(); });
    $('batch-raw').addEventListener('input', (e) => { S.batch.raw = e.target.value; reparseBatch(); });
    $('batch-header').addEventListener('change', (e) => { S.batch.header = e.target.checked; reparseBatch(); });
    $('batch-object').addEventListener('change', (e) => { S.batch.asObject = e.target.checked; renderBatchControls(); refreshDerived(); });
    $('batch-col').addEventListener('change', (e) => { S.batch.col = e.target.value; renderBatchControls(); refreshDerived(); });
    $('csv-file').addEventListener('change', (e) => { onFile(e.target.files[0]); e.target.value = ''; });
    $('result-search').addEventListener('input', (e) => { S.filter = e.target.value; S.shown = LIMITS.page; renderResults(); });
    $('metrics').addEventListener('change', (e) => {
      if (e.target.id !== 'noul-no' && e.target.id !== 'noul-yes') return;
      const lo = Number($('noul-no').value); const hi = Number($('noul-yes').value);
      if (isFinite(lo) && isFinite(hi) && lo >= 0 && hi <= 1 && lo < hi) { S.noulNo = lo; S.noulYes = hi; } else toast('Umbrales inválidos: se requiere 0 ≤ NO < SÍ ≤ 1.');
      renderResults();
    });
    window.addEventListener('beforeunload', (e) => { if (S.running) { e.preventDefault(); e.returnValue = ''; } });

    paintMode(); paintInputMode(); loadPreset(S.presetKey); switchTab('workspace');
  }

  window.JEVApp = { S, currentItems, esc, fmt, pct, clip, toast, banner, download, copyText, csvCell, fmtNum, store, actions, tabHooks, sleep, switchTab, boot, parseCsv, compile, verifyAll, ID_RE, LIMITS };
})();
