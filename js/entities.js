/* Pestaña «Entidades»: extracción de entidades con GLiNER2 local (vía /api/gliner) o con la simulación léxica (JEVNER).
 * El texto nunca sale del equipo: el servicio escucha solo en 127.0.0.1. */
(function () {
  'use strict';

  const A = window.JEVApp; const PRE = window.JEVPRESETS; const NER = window.JEVNER;
  const $ = (id) => document.getElementById(id);
  const esc = A.esc;
  const LIM = { text: 100000, labels: 30, name: 80, desc: 600 };
  const PALETTE = ['bg-red-200', 'bg-blue-200', 'bg-green-200', 'bg-yellow-200', 'bg-purple-200', 'bg-pink-200', 'bg-orange-200', 'bg-teal-200'];
  const SWATCH = ['bg-red-400', 'bg-blue-400', 'bg-green-400', 'bg-yellow-400', 'bg-purple-400', 'bg-pink-400', 'bg-orange-400', 'bg-teal-400'];

  const N = { labels: [], uid: 0, health: null, last: null, inited: false, busy: false, dirty: false, followed: null, sample: '', userText: false };

  /* ───── plantillas propias (localStorage + exportación/importación JSON) ───── */
  const CUSTOM_KEY = 'jev2_ner_custom';
  const SAMPLE_MAX = 5000;
  let custom = {};

  const pick = (o, keys) => { for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k]; return undefined; };

  /* Normaliza las etiquetas: acepta {nombre: descripción}, {nombre: null}, ["nombre", …] y [{name|label|nombre, description|desc|descripcion}, …]. */
  function normLabels(raw) {
    if (Array.isArray(raw)) {
      return raw.map((it) => {
        if (typeof it === 'string') return [it, ''];
        if (it && typeof it === 'object') return [pick(it, ['name', 'label', 'nombre', 'etiqueta']), pick(it, ['description', 'desc', 'descripcion', 'descripción'])];
        return [undefined, ''];
      });
    }
    if (raw && typeof raw === 'object') return Object.keys(raw).map((n) => [n, raw[n]]);
    return null;
  }

  /* Valida una plantilla y devuelve { tpl, error, trimmed }. Es tolerante en lo que no cambia el significado (descripción ausente o nula,
     espacios, etiquetas dadas como lista, descripciones demasiado largas, que se recortan al límite del servicio) y explica el motivo cuando rechaza. */
  function checkTemplate(t, fallbackLabel) {
    if (!t || typeof t !== 'object' || Array.isArray(t)) return { error: 'no es un objeto' };
    let label = typeof t.label === 'string' ? t.label.trim() : '';
    if (!label && typeof t.nombre === 'string') label = t.nombre.trim();
    if (!label) label = fallbackLabel || '';
    if (!label) return { error: 'falta «label» (nombre de la plantilla)' };
    const rawLabels = pick(t, ['labels', 'entity_types', 'entities', 'etiquetas']);
    if (rawLabels === undefined) return { error: t.questions ? 'es una plantilla de preguntas («Definición»), no de etiquetas' : 'falta «labels»' };
    const list = normLabels(rawLabels);
    if (!list) return { error: '«labels» debe ser un objeto {etiqueta: descripción} o una lista' };
    if (!list.length) return { error: 'no tiene etiquetas' };
    if (list.length > LIM.labels) return { error: 'tiene ' + list.length + ' etiquetas (máximo ' + LIM.labels + ')' };
    const labels = {}; let trimmed = 0;
    for (const [rn, rd] of list) {
      if (typeof rn !== 'string' || !rn.trim() || rn.trim().length > LIM.name) return { error: 'etiqueta sin nombre o de más de ' + LIM.name + ' caracteres' + (typeof rn === 'string' ? ' («' + rn.slice(0, 20) + '…»)' : '') };
      const n = rn.trim();
      let d = rd === undefined || rd === null ? '' : (typeof rd === 'string' || typeof rd === 'number') ? String(rd).trim() : null;
      if (d === null) return { error: 'la descripción de «' + n + '» debe ser texto' };
      if (d.length > LIM.desc) { d = d.slice(0, LIM.desc); trimmed++; }
      if (n in labels) return { error: 'etiqueta repetida «' + n + '»' };
      labels[n] = d;
    }
    const sample = typeof t.sample === 'string' && t.sample.length <= SAMPLE_MAX ? t.sample : '';
    return { tpl: { label: label.slice(0, 60), labels, sample, custom: true }, trimmed };
  }
  function validTemplate(t) { return checkTemplate(t).tpl || null; }
  function loadCustom() {
    custom = {};
    let raw = null; try { raw = JSON.parse(A.store.get('localStorage', CUSTOM_KEY) || 'null'); } catch (e) { raw = null; }
    if (!raw || typeof raw !== 'object') return;
    Object.keys(raw).forEach((id) => { if (/^user_[a-z0-9_]{1,50}$/.test(id)) { const t = validTemplate(raw[id]); if (t) custom[id] = t; } });
  }
  function persistCustom() {
    const out = {}; Object.keys(custom).forEach((id) => { out[id] = { label: custom[id].label, labels: custom[id].labels, sample: custom[id].sample }; });
    A.store.set('localStorage', CUSTOM_KEY, JSON.stringify(out));
  }
  function getPreset(key) { return PRE.NER_PRESETS[key] || custom[key] || null; }
  function slug(name) {
    return 'user_' + (name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'plantilla');
  }
  function fillPresetSelect(selected) {
    const opt = (k, p) => '<option value="' + esc(k) + '">' + esc(p.label) + '</option>';
    const mine = Object.keys(custom);
    $('ner-preset').innerHTML = Object.keys(PRE.NER_PRESETS).map((k) => opt(k, PRE.NER_PRESETS[k])).join('') +
      (mine.length ? '<optgroup label="Mis plantillas">' + mine.map((k) => opt(k, custom[k])).join('') + '</optgroup>' : '');
    if (selected && getPreset(selected)) $('ner-preset').value = selected;
    $('ner-tpl-delete').disabled = !/^user_/.test($('ner-preset').value);
    $('ner-tpl-delete').classList.toggle('opacity-40', $('ner-tpl-delete').disabled);
  }
  function saveTemplate() {
    const name = $('ner-tpl-name').value.trim();
    if (!name) { A.toast('Escriba un nombre para la plantilla.'); $('ner-tpl-name').focus(); return; }
    const labels = {}; let dup = false;
    N.labels.forEach((l) => { const n = l.name.trim(); if (!n) return; if (n in labels) dup = true; labels[n] = l.desc.trim(); });
    if (dup) { A.toast('Hay etiquetas con el mismo nombre; corríjalas antes de guardar.'); return; }
    const text = $('ner-text').value;
    const t = validTemplate({ label: name, labels, sample: text.length <= SAMPLE_MAX ? text : '' });
    if (!t) { A.toast('Plantilla no válida: requiere 1–' + LIM.labels + ' etiquetas con nombre y descripción dentro de los límites.'); return; }
    const id = slug(name); const existed = !!custom[id];
    custom[id] = t; persistCustom(); fillPresetSelect(id);
    N.dirty = false; N.sample = t.sample;
    A.toast((existed ? 'Plantilla «' + name + '» actualizada' : 'Plantilla «' + name + '» guardada') + (text.length > SAMPLE_MAX ? ' (sin el texto: supera ' + SAMPLE_MAX + ' caracteres)' : ''));
  }
  function deleteTemplate() {
    const id = $('ner-preset').value; if (!custom[id]) return;
    const label = custom[id].label; delete custom[id]; persistCustom();
    fillPresetSelect(); loadPreset(Object.keys(PRE.NER_PRESETS)[0]); A.toast('Plantilla «' + label + '» eliminada');
  }
  function exportTemplates() {
    if (!Object.keys(custom).length) { A.toast('Aún no hay plantillas propias que exportar.'); return; }
    const out = {}; Object.keys(custom).forEach((id) => { out[id] = { label: custom[id].label, labels: custom[id].labels, sample: custom[id].sample }; });
    A.download('plantillas_entidades.json', 'application/json', JSON.stringify({ tipo: 'jev-ner-plantillas', version: 1, plantillas: out }, null, 2));
  }
  /* Extrae [clave, plantilla] de lo que contenga el archivo: {plantillas:{…}}, {plantillas:[…]}, una lista de plantillas o una sola plantilla. */
  function templatesIn(data) {
    if (Array.isArray(data)) return data.map((t) => [null, t]);
    if (!data || typeof data !== 'object') return null;
    const pl = data.plantillas;
    if (Array.isArray(pl)) return pl.map((t) => [null, t]);
    if (pl && typeof pl === 'object') return Object.keys(pl).map((k) => [k, pl[k]]);
    if (['labels', 'entity_types', 'entities', 'etiquetas', 'questions'].some((k) => data[k] !== undefined)) return [[null, data]];
    return null;
  }
  function importTemplates(file) {
    if (!file) return;
    if (file.size > 1024 * 1024) { A.toast('El archivo supera 1 MB.'); return; }
    const fr = new FileReader();
    fr.onerror = () => A.toast('No se pudo leer el archivo.');
    fr.onload = () => {
      let data; try { data = JSON.parse(A.decodeJson(fr.result)); } catch (e) { A.toast('El archivo no es un JSON válido (' + (e && e.message ? e.message : e) + ').'); return; }
      const entries = templatesIn(data);
      if (!entries || !entries.length) { A.toast('Formato no reconocido: se espera {"plantillas": {…}} o una plantilla con «label» y «labels».'); return; }
      let ok = 0, replaced = 0, cut = 0; const bad = []; let first = null;
      entries.forEach(([k, raw]) => {
        const fb = k ? String(k).replace(/^user_/, '').replace(/_+/g, ' ').trim() : '';
        const r = checkTemplate(raw, fb);
        if (!r.tpl) { bad.push('«' + (k || (raw && raw.label) || '?') + '»: ' + r.error); return; }
        const id = k && /^user_[a-z0-9_]{1,50}$/.test(k) ? k : slug(r.tpl.label);
        if (custom[id]) replaced++;
        custom[id] = r.tpl; ok++; cut += r.trimmed; if (!first) first = id;
      });
      if (ok) persistCustom();
      fillPresetSelect(first || $('ner-preset').value);
      if (first && !N.dirty) loadPreset(first);
      A.toast((ok ? ok + ' plantilla(s) importada(s)' + (replaced ? ' (' + replaced + ' sustituye(n) a una existente)' : '') + (cut ? '; ' + cut + ' descripción(es) recortada(s) a ' + LIM.desc + ' caracteres' : '') + (first && N.dirty ? '; elija «' + custom[first].label + '» y pulse «Cargar»' : '') : 'No se importó ninguna plantilla') +
        (bad.length ? '; descartada(s) ' + bad.length + ' → ' + bad.slice(0, 2).join(' · ') + (bad.length > 2 ? ' …' : '') : ''));
    };
    fr.readAsArrayBuffer(file);
  }

  /* Carga las etiquetas de una plantilla. El texto se sustituye por el ejemplo de la plantilla salvo que lo haya escrito o pegado el usuario (el traído desde «Definición» sí se sustituye). */
  function loadPreset(key) {
    const p = getPreset(key); if (!p) return;
    N.labels = Object.keys(p.labels).map((name) => ({ uid: ++N.uid, name, desc: p.labels[name] }));
    N.dirty = false;
    const cur = $('ner-text').value;
    let kept = false;
    if (!cur.trim() || cur === N.sample || !N.userText) { $('ner-text').value = p.sample; N.userText = false; N.last = null; $('ner-result').classList.add('hidden'); }
    else kept = !!p.sample && cur !== p.sample;
    N.sample = p.sample;
    if (kept) A.toast('Se conserva el texto que usted escribió; use «Ejemplo de la plantilla» para sustituirlo por el de «' + p.label + '».');
    $('ner-preset').value = key;
    $('ner-tpl-delete').disabled = !/^user_/.test(key); $('ner-tpl-delete').classList.toggle('opacity-40', $('ner-tpl-delete').disabled);
    renderLabels(); updateCount();
  }

  /* Mantiene las etiquetas acordes con la plantilla elegida en «Definición». */
  function syncWithDefinition() {
    const want = PRE.NER_FOR && PRE.NER_FOR[A.S.presetKey];
    if (!want || want === N.followed) return;
    N.followed = want;
    if (!N.dirty) { loadPreset(want); A.toast('Etiquetas ajustadas a la plantilla de «Definición»: ' + PRE.NER_PRESETS[want].label); }
    else A.toast('La plantilla de «Definición» cambió; para usar sus etiquetas (' + PRE.NER_PRESETS[want].label + ') elíjala en «Plantilla» de esta pestaña.');
  }

  function renderLabels() {
    $('ner-labels').innerHTML = N.labels.map((l, i) =>
      '<div class="border border-swiss-border p-2 space-y-1.5"><div class="flex items-center gap-2"><span class="w-2.5 h-2.5 shrink-0 ' + SWATCH[i % SWATCH.length] + '"></span>' +
      '<input data-nl="' + l.uid + '" data-f="name" value="' + esc(l.name) + '" maxlength="' + LIM.name + '" aria-label="Nombre de la etiqueta ' + (i + 1) + '" class="flex-1 border border-swiss-border px-2 py-1 font-mono text-xs focus:border-swiss-black focus:outline-none">' +
      '<button data-act="ner-remove-label" data-nl="' + l.uid + '" aria-label="Eliminar etiqueta" class="font-mono text-xs text-swiss-grayDark hover:text-swiss-red">✕</button></div>' +
      '<textarea data-nl="' + l.uid + '" data-f="desc" rows="2" maxlength="' + LIM.desc + '" aria-label="Descripción de la etiqueta ' + (i + 1) + '" class="w-full border border-swiss-border px-2 py-1 text-xs focus:border-swiss-black focus:outline-none resize-y">' + esc(l.desc) + '</textarea></div>'
    ).join('') || '<div class="text-xs font-mono text-swiss-grayDark">Sin etiquetas.</div>';
  }

  function updateCount() {
    const n = $('ner-text').value.length;
    $('ner-count').textContent = n.toLocaleString('es-ES') + ' / ' + LIM.text.toLocaleString('es-ES') + ' caracteres';
    $('ner-count').className = 'text-[11px] font-mono ' + (n > LIM.text ? 'text-swiss-red font-bold' : 'text-swiss-grayDark');
  }

  /* ───── estado del servicio ───── */

  let healthRequest = null; let healthTimer = null; let healthDeadline = 0;

  function checkHealth(options = {}) {
    if (healthRequest) return healthRequest;
    clearTimeout(healthTimer);
    if (!options.retry) healthDeadline = Date.now() + 120000;
    healthRequest = probeHealth().finally(() => { healthRequest = null; });
    return healthRequest;
  }

  async function probeHealth() {
    const pill = $('ner-status'); pill.textContent = 'comprobando…';
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 7000);
    let h;
    try {
      const r = await fetch('api/gliner?health=1', { cache: 'no-store', credentials: 'same-origin', signal: ctl.signal });
      let data = null; try { data = await r.json(); } catch (e) { /* sin JSON */ }
      if (r.status === 200 && data && data.service === 'jev-gliner' && data.runtime_ready === false && data.load_error) h = { state: 'error', message: data.load_error };
      else if (r.status === 200 && data && data.service === 'jev-gliner') h = { state: !data.gliner2_installed ? 'noinstall' : data.runtime_ready === false ? 'starting' : 'ready', data, retry: data.gliner2_installed && data.runtime_ready === false };
      else if (r.status === 503) h = { state: 'down', retry: true };
      else if (data && typeof data.error === 'string' && [500, 502, 504].includes(r.status)) h = { state: 'error', message: data.error, retry: true };
      else h = { state: 'noserver' };
    } catch (e) { h = e && e.name === 'AbortError' ? { state: 'error', message: 'La comprobación de GLiNER agotó el tiempo de espera.', retry: true } : { state: 'noserver', retry: /^https?:$/.test(window.location.protocol) }; } finally { clearTimeout(t); }
    if (h.retry && Date.now() < healthDeadline) {
      h = { ...h, state: 'starting' };
      healthTimer = setTimeout(() => checkHealth({ retry: true }), 3000);
    } else if (h.state === 'starting') {
      h = { ...h, state: 'error', message: 'GLiNER no ha terminado de arrancar tras dos minutos.' };
    }
    N.health = h; paintStatus();
    return h;
  }

  function paintStatus() {
    const h = N.health || { state: 'noserver' }; const pill = $('ner-status'); const box = $('ner-setup');
    const map = {
      starting: [h.data ? 'Iniciando GLiNER…' : 'Sin respuesta de GLiNER · reintentando…', 'bg-yellow-100 border-yellow-500 text-yellow-900'],
      ready: ['GLiNER disponible', 'bg-green-100 border-green-500 text-green-900'],
      noinstall: ['servicio activo · gliner2 sin instalar', 'bg-yellow-100 border-yellow-500 text-yellow-900'],
      down: ['servicio GLiNER apagado', 'bg-yellow-100 border-yellow-500 text-yellow-900'],
      error: ['servicio GLiNER sin respuesta', 'bg-yellow-100 border-yellow-500 text-yellow-900'],
      noserver: ['sin servidor local · solo simulación', 'bg-gray-100 border-gray-400 text-gray-800']
    };
    const m = map[h.state];
    pill.className = 'px-2 py-0.5 border ' + m[1]; pill.textContent = m[0];
    const msg = {
      starting: 'Esperando al servicio local. El estado se actualizará automáticamente cuando GLiNER esté disponible.',
      noserver: 'Esta página no se está sirviendo desde el servidor local (o <code>/api/gliner</code> no responde). Abra la aplicación con <code>INICIAR.bat</code> (Windows) o <code>sh iniciar.sh</code>. Mientras tanto funciona la simulación.',
      down: 'El servicio local todavía no responde. Si acaba de abrir INICIAR, espere unos segundos mientras inicializa las dependencias y pulse «Comprobar». Si persiste, cierre y vuelva a abrir <code>INICIAR.bat</code> (Windows) o <code>sh iniciar.sh</code>. Si aún no instaló GLiNER, ejecute antes <code>INSTALAR_GLINER</code>.',
      noinstall: 'El servicio responde pero falta el paquete <code>gliner2</code>. Ejecute <code>INSTALAR_GLINER.bat</code> / <code>sh instalar_gliner.sh</code> y reinicie el servicio.',
      error: esc(h.message || 'El servicio GLiNER no responde.') + ' El servidor de la aplicación respondió, pero no pudo verificar el motor. Consulte <code>gliner_service.log</code>; reinicie INICIAR tras terminar la instalación.',
      ready: ''
    }[h.state];
    if (h.state === 'ready' && h.data) {
      const d = h.data;
      box.classList.remove('hidden');
      const mi = modelInfo(d); const mName = mi ? mi.model : d.model; const mErr = mi ? mi.load_error : d.load_error;
      box.innerHTML = 'Modelo (' + (modelKey() === 'multi' ? 'multilingüe' : 'inglés') + '): <code>' + esc(mName) + '</code> · ' + (modelLoaded(d) ? 'cargado en memoria' : 'se cargará en la primera extracción (puede tardar 1–2 minutos)') + (mErr ? ' · <strong>error de carga: ' + esc(mErr) + '</strong>' : '') + ' · <button data-act="ner-check" class="underline">Comprobar</button>';
    } else {
      box.classList.remove('hidden'); box.innerHTML = msg + ' <button data-act="ner-check" class="underline">Comprobar</button>';
    }
  }

  /* ───── extracción ───── */

  function readLabels() {
    const out = {}; const errors = [];
    if (!N.labels.length) errors.push('Defina al menos una etiqueta.');
    if (N.labels.length > LIM.labels) errors.push('Máximo ' + LIM.labels + ' etiquetas.');
    N.labels.forEach((l, i) => {
      const n = l.name.trim();
      if (!n) errors.push('La etiqueta ' + (i + 1) + ' no tiene nombre.'); else if (n.length > LIM.name) errors.push('«' + n.slice(0, 20) + '…» supera ' + LIM.name + ' caracteres.');
      else if (n in out) errors.push('Etiqueta duplicada «' + n + '».'); else out[n] = l.desc.trim();
      if (l.desc.length > LIM.desc) errors.push('La descripción de «' + n + '» supera ' + LIM.desc + ' caracteres.');
    });
    return { labels: out, errors };
  }

  function modelInfo(d) { return d && d.models && d.models[modelKey()] ? d.models[modelKey()] : null; }
  function modelLoaded(d) { const m = modelInfo(d); return m ? !!m.loaded : !!(d && d.model_loaded); }

  function modelKey() { const el = $('ner-model'); return el && el.value === 'multi' ? 'multi' : 'en'; }

  async function callGliner(text, labels, threshold, timeoutMs) {
    const limit = timeoutMs || 190000;
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), limit);
    try {
      const r = await fetch('api/gliner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, labels, threshold, model: modelKey() }), signal: ctl.signal, cache: 'no-store', credentials: 'same-origin' });
      const data = await r.json().catch(() => null);
      if (!r.ok || !data) throw new Error((data && (data.hint || data.error)) ? (data.error || '') + (data.hint ? ' ' + data.hint : '') : 'HTTP ' + r.status);
      return data;
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('Tiempo de espera agotado (' + Math.round(limit / 1000) + ' s).');
      throw e;
    } finally { clearTimeout(t); }
  }

  /* Normaliza la respuesta de GLiNER: reconcilia posiciones y descarta lo que no es literal del texto. */
  function entitiesFromData(text, data) {
    let ents = Array.isArray(data.entities) ? data.entities : []; let dropped = data.dropped || 0;
    if (data.offsets === 'codepoints') { const rec = NER.reconcileOffsets(text, ents); ents = rec.entities; dropped += rec.dropped.length; }
    else { const ok = ents.filter((e) => Number.isInteger(e.start) && Number.isInteger(e.end) && text.slice(e.start, e.end) === e.text); dropped += ents.length - ok.length; ents = ok; }
    return { ents: ents.map((e) => ({ label: e.label, text: e.text, start: e.start, end: e.end, confidence: Number(e.confidence), source: 'GLiNER2' })), dropped };
  }

  async function run() {
    if (N.busy) return;
    A.banner(null);
    const text = $('ner-text').value; const threshold = Number($('ner-threshold').value);
    if (!text.trim()) { A.banner('error', 'Introduzca un texto.'); return; }
    if (text.length > LIM.text) { A.banner('error', 'El texto supera ' + LIM.text.toLocaleString('es-ES') + ' caracteres.'); return; }
    const { labels, errors } = readLabels();
    if (errors.length) { A.banner('error', errors[0] + (errors.length > 1 ? ' (+' + (errors.length - 1) + ' más)' : '')); return; }
    const pref = (document.querySelector('input[name=ner-engine]:checked') || {}).value || 'auto';
    N.busy = true; $('ner-run').disabled = true; $('ner-run').textContent = 'Procesando…';
    try {
      let health = N.health; if (pref !== 'sim' && (!health || health.state !== 'ready')) health = await checkHealth();
      const useModel = pref === 'gliner' || (pref === 'auto' && health && health.state === 'ready');
      if (pref === 'gliner' && !(health && health.state === 'ready')) { A.banner('error', 'GLiNER local no está disponible (ver el estado del motor). Use «Automático» o «Simulación».'); return; }
      let result = null; let fallbackNote = '';
      if (useModel) {
        const t0 = performance.now();
        // En «Automático», si el modelo aún no está en memoria la primera extracción puede tardar minutos (descarga y carga): se espera solo unos segundos.
        const waitMs = pref === 'auto' && !modelLoaded(health && health.data) ? 15000 : 190000;
        try {
          const data = await callGliner(text, labels, threshold, waitMs);
          const { ents, dropped } = entitiesFromData(text, data);
          result = { engine: 'gliner', model: data.model || 'gliner2', entities: ents, notes: dropped ? [dropped + ' entidades descartadas por no ser literales del texto o por tener posiciones inválidas.'] : [], threshold, ms: Math.round(performance.now() - t0), serverMs: data.elapsed_ms };
        } catch (e) {
          if (pref !== 'auto') throw e;
          const timedOut = e && /Tiempo de espera/.test(e.message || '');
          fallbackNote = timedOut ? 'GLiNER aún está cargando el modelo (la primera vez puede tardar varios minutos): se usó la simulación léxica. Reintente más tarde con «Automático» o «GLiNER local».' : 'GLiNER falló (' + (e && e.message ? e.message : e) + '): se usó la simulación léxica.';
          checkHealth();
        }
      }
      if (!result) {
        const t0 = performance.now(); const r = NER.extract(text, labels, { threshold });
        result = Object.assign({}, r, { ms: Math.round(performance.now() - t0) });
        if (pref === 'auto') result.notes.unshift(fallbackNote || 'GLiNER local no disponible: se usó la simulación léxica (' + (N.health ? N.health.state : '—') + ').');
      }
      N.last = { text, labels, result }; render();
    } catch (e) { A.banner('error', 'Extracción fallida: ' + (e && e.message ? e.message : e)); } finally { N.busy = false; $('ner-run').disabled = false; $('ner-run').textContent = 'Extraer entidades'; }
  }


  /* ───── lote: todos los registros del CSV cargado en «Definición» ───── */

  const BATCH_MAX = { gliner: 500, sim: 2000 };
  const B = { running: false, cancel: false, records: [], meta: null };

  function paintBatchInfo() {
    const n = A.currentItems().items.length; const el = $('ner-batch-info'); if (!el) return;
    el.textContent = n > 1 ? n.toLocaleString('es-ES') + ' registros en «Definición»' : n === 1 ? '1 registro (cargue un CSV en «Definición» → Lote CSV para varios)' : 'sin registros en «Definición»';
  }

  async function runBatch() {
    if (B.running || N.busy) return;
    A.banner(null);
    const { items } = A.currentItems();
    if (!items.length) { A.banner('error', 'No hay registros: cargue un CSV en «Definición» (Lote CSV) y elija la columna de texto.'); return; }
    const { labels, errors } = readLabels();
    if (errors.length) { A.banner('error', errors[0] + (errors.length > 1 ? ' (+' + (errors.length - 1) + ' más)' : '')); return; }
    const threshold = Number($('ner-threshold').value);
    const pref = (document.querySelector('input[name=ner-engine]:checked') || {}).value || 'auto';
    B.running = true; B.cancel = false; $('ner-batch-run').disabled = true; $('ner-batch-cancel').classList.remove('hidden');
    const notes = [];
    try {
      let health = N.health; if (pref !== 'sim' && (!health || health.state !== 'ready')) health = await checkHealth();
      const ready = !!(health && health.state === 'ready');
      // El motor se fija una vez para todo el lote: no se mezclan GLiNER y simulación entre registros.
      let engine;
      if (pref === 'sim') engine = 'sim';
      else if (pref === 'gliner') { if (!ready) { A.banner('error', 'GLiNER local no está disponible (ver el estado del motor). Use «Automático» o «Simulación».'); return; } engine = 'gliner'; }
      else if (ready && modelLoaded(health.data)) engine = 'gliner';
      else { engine = 'sim'; notes.push(ready ? 'GLiNER aún no tiene el modelo en memoria: todo el lote se procesó con la simulación léxica. Para usar el modelo elija «GLiNER local» y espere a su carga.' : 'GLiNER local no disponible: todo el lote se procesó con la simulación léxica.'); }
      if (items.length > BATCH_MAX[engine]) { A.banner('error', 'El lote tiene ' + items.length.toLocaleString('es-ES') + ' registros; el máximo con ' + (engine === 'gliner' ? 'GLiNER' : 'la simulación') + ' es ' + BATCH_MAX[engine].toLocaleString('es-ES') + '. Divídalo en varios archivos.'); return; }
      const records = []; let consecutiveErrors = 0; let model = engine === 'gliner' ? (health.data && health.data.model) || 'gliner2' : 'jevner-sim';
      const t0 = performance.now();
      for (let i = 0; i < items.length; i++) {
        if (B.cancel) { notes.push('Lote cancelado tras ' + i + ' de ' + items.length + ' registros.'); break; }
        const it = items[i]; const text = String(it.label);
        $('ner-batch-progress').textContent = (i + 1) + ' / ' + items.length;
        const rec = { n: it.n, chars: text.length, entities: [], error: null };
        if (text.length > LIM.text) rec.error = 'el texto supera ' + LIM.text.toLocaleString('es-ES') + ' caracteres';
        else if (engine === 'gliner') {
          try { const data = await callGliner(text, labels, threshold); rec.entities = entitiesFromData(text, data).ents; model = data.model || model; consecutiveErrors = 0; }
          catch (e) { rec.error = e && e.message ? e.message : String(e); consecutiveErrors++; }
          if (consecutiveErrors >= 3) { records.push(rec); notes.push('Lote detenido: tres errores consecutivos de GLiNER (' + rec.error + ').'); break; }
        } else {
          rec.entities = NER.extract(text, labels, { threshold }).entities.map((e) => ({ label: e.label, text: e.text, start: e.start, end: e.end, confidence: Number(e.confidence), source: e.via || e.source || 'simulación' }));
          if (i % 25 === 24) await new Promise((r) => setTimeout(r, 0));
        }
        records.push(rec);
      }
      B.records = records; B.meta = { engine, model, threshold, labels, ms: Math.round(performance.now() - t0), notes };
      renderBatch();
    } catch (e) { A.banner('error', 'Lote fallido: ' + (e && e.message ? e.message : e)); } finally {
      B.running = false; $('ner-batch-run').disabled = false; $('ner-batch-cancel').classList.add('hidden'); $('ner-batch-progress').textContent = '';
    }
  }

  function renderBatch() {
    const box = $('ner-batch-out'); const m = B.meta; const recs = B.records;
    const total = recs.reduce((a, r) => a + r.entities.length, 0); const withE = recs.filter((r) => r.entities.length).length; const errs = recs.filter((r) => r.error).length;
    const names = Object.keys(m.labels);
    const perLabel = names.map((n) => '<tr><td class="p-1.5 font-mono">' + esc(n) + '</td><td class="p-1.5 text-right font-mono">' + recs.reduce((a, r) => a + r.entities.filter((e) => e.label === n).length, 0) + '</td><td class="p-1.5 text-right font-mono">' + recs.filter((r) => r.entities.some((e) => e.label === n)).length + '</td></tr>').join('');
    const rows = []; recs.forEach((r) => r.entities.forEach((e) => { if (rows.length < 300) rows.push('<tr><td class="p-1.5 font-mono">' + r.n + '</td><td class="p-1.5 font-mono">' + esc(e.label) + '</td><td class="p-1.5">' + esc(e.text) + '</td><td class="p-1.5 text-right font-mono">' + e.start + '–' + e.end + '</td><td class="p-1.5 text-right font-mono">' + (isFinite(e.confidence) ? e.confidence.toFixed(3) : '—') + '</td></tr>'); }));
    box.classList.remove('hidden');
    box.innerHTML = '<div class="border-l-4 ' + (m.engine === 'gliner' ? 'border-green-500 bg-green-50' : 'border-yellow-500 bg-yellow-50') + ' p-2 leading-relaxed">Motor: <strong>' + (m.engine === 'gliner' ? 'GLiNER2 · ' + esc(m.model) : 'simulación léxica (no es el modelo)') + '</strong> · umbral ' + m.threshold.toFixed(2) + ' · ' + recs.length + ' registro(s) en ' + (m.ms / 1000).toFixed(1) + ' s · ' + total + ' entidades en ' + withE + ' registro(s)' + (errs ? ' · <strong>' + errs + ' con error</strong>' : '') + '</div>' +
      (m.notes.length ? '<div class="text-swiss-grayDark space-y-1">' + m.notes.map((n) => '<div>• ' + esc(n) + '</div>').join('') + '</div>' : '') +
      '<div class="flex gap-2"><button data-act="ner-batch-csv" class="px-2.5 py-1 border border-swiss-black hover:bg-swiss-black hover:text-white">CSV</button><button data-act="ner-batch-json" class="px-2.5 py-1 bg-swiss-black text-white hover:bg-swiss-charcoal">JSON</button></div>' +
      '<table class="w-full text-left text-xs"><thead><tr class="bg-swiss-grayBg font-mono text-[11px] uppercase"><th class="p-1.5">Etiqueta</th><th class="p-1.5 text-right">Entidades</th><th class="p-1.5 text-right">Registros</th></tr></thead><tbody class="divide-y divide-swiss-border">' + perLabel + '</tbody></table>' +
      '<div class="overflow-x-auto max-h-96 overflow-y-auto"><table class="w-full text-left text-xs"><thead><tr class="bg-swiss-grayBg font-mono text-[11px] uppercase sticky top-0"><th class="p-1.5">Reg.</th><th class="p-1.5">Etiqueta</th><th class="p-1.5">Texto</th><th class="p-1.5 text-right">Inicio–fin</th><th class="p-1.5 text-right">Confianza</th></tr></thead><tbody class="divide-y divide-swiss-border">' + (rows.join('') || '<tr><td colspan="5" class="p-3 text-center text-swiss-grayDark">Sin entidades por encima del umbral.</td></tr>') + '</tbody></table></div>' +
      (total > 300 ? '<div class="text-swiss-grayDark">Se muestran las primeras 300 de ' + total + ' entidades; el CSV y el JSON las incluyen todas.</div>' : '');
  }

  function batchCsv() {
    if (!B.meta) return; const d = ';'; const m = B.meta;
    const motor = m.engine === 'gliner' ? 'GLiNER2' : 'simulación';
    const lines = [['registro', 'estado', 'etiqueta', 'texto', 'inicio', 'fin', 'confianza', 'motor'].join(d)];
    B.records.forEach((r) => {
      if (r.error) lines.push([r.n, 'error: ' + r.error, '', '', '', '', '', motor].map((x) => A.csvCell(x, d)).join(d));
      else if (!r.entities.length) lines.push([r.n, 'sin entidades', '', '', '', '', '', motor].map((x) => A.csvCell(x, d)).join(d));
      else r.entities.slice().sort((a, b) => a.start - b.start).forEach((e) => lines.push([r.n, 'ok', e.label, e.text, e.start, e.end, e.confidence, motor].map((x) => A.csvCell(x, d)).join(d)));
    });
    A.download(m.engine === 'gliner' ? 'jev_entidades_lote.csv' : 'jev_entidades_lote_SIMULACION.csv', 'text/csv;charset=utf-8', '﻿' + lines.join('\r\n') + '\r\n');
  }
  function batchJson() {
    if (!B.meta) return; const m = B.meta;
    A.download(m.engine === 'gliner' ? 'jev_entidades_lote.json' : 'jev_entidades_lote_SIMULACION.json', 'application/json', JSON.stringify({ exported_at: new Date().toISOString(), engine: m.engine, model: m.model, threshold: m.threshold, offsets: 'UTF-16 (índices de String de JavaScript)', labels: m.labels, notes: m.notes, records: B.records.map((r) => ({ row: r.n, chars: r.chars, error: r.error, entities: r.entities })) }, null, 2));
  }

  /* ───── presentación ───── */

  function render() {
    const { text, labels, result } = N.last; const names = Object.keys(labels);
    const ents = result.entities.slice().sort((a, b) => a.start - b.start || b.end - a.end);
    const box = $('ner-result'); box.classList.remove('hidden');
    box.innerHTML = '<div class="bg-white border border-swiss-border p-4 space-y-2"><div class="flex flex-wrap items-center justify-between gap-2"><h3 class="text-xs font-mono uppercase font-bold tracking-wider">Texto anotado</h3><span class="text-[11px] font-mono text-swiss-grayDark" id="ner-meta"></span></div><div id="ner-legend" class="flex flex-wrap gap-2 text-[11px] font-mono"></div><div id="ner-marked" class="text-sm leading-7 whitespace-pre-wrap break-words border border-swiss-border p-3 bg-[#FCFCFD]"></div></div>' +
      '<div class="bg-white border border-swiss-border overflow-hidden"><div class="p-3 border-b border-swiss-border flex flex-wrap items-center justify-between gap-2"><h3 class="text-xs font-mono uppercase font-bold tracking-wider">Entidades (<span id="ner-n"></span>)</h3><div class="flex gap-2 text-xs font-mono"><button data-act="ner-export-csv" class="px-2.5 py-1 border border-swiss-black hover:bg-swiss-black hover:text-white">CSV</button><button data-act="ner-export-json" class="px-2.5 py-1 bg-swiss-black text-white hover:bg-swiss-charcoal">JSON</button></div></div><div class="overflow-x-auto"><table class="w-full text-left text-xs"><thead><tr class="bg-swiss-grayBg font-mono text-[11px] uppercase"><th class="p-2">Etiqueta</th><th class="p-2">Texto</th><th class="p-2 text-right">Inicio–fin</th><th class="p-2 text-right">Confianza</th><th class="p-2">Origen</th></tr></thead><tbody id="ner-rows" class="divide-y divide-swiss-border"></tbody></table></div></div><div id="ner-notes" class="text-[11px] font-mono text-swiss-grayDark space-y-1"></div>';
    $('ner-meta').textContent = (result.engine === 'gliner' ? 'GLiNER2 · ' + result.model : 'simulación · ' + result.model) + ' · umbral ' + result.threshold.toFixed(2) + ' · ' + result.ms + ' ms' + (result.engine === 'sim' || result.engine === 'simulation' ? ' (medido en el navegador)' : '');
    $('ner-legend').innerHTML = names.map((n, i) => '<span class="px-1.5 py-0.5 ' + PALETTE[i % PALETTE.length] + '">' + esc(n) + ' · ' + ents.filter((e) => e.label === n).length + '</span>').join('');
    // Anotación: se construye con nodos DOM (textContent), sin innerHTML con el texto del usuario.
    const marked = $('ner-marked'); let pos = 0; const overlapped = new Set();
    ents.forEach((e, k) => {
      if (e.start < pos) { overlapped.add(k); return; }
      if (e.start > pos) marked.appendChild(document.createTextNode(text.slice(pos, e.start)));
      const m = document.createElement('mark'); m.className = PALETTE[Math.max(0, names.indexOf(e.label)) % PALETTE.length] + ' px-0.5 rounded-sm';
      m.title = e.label + ' · ' + (isFinite(e.confidence) ? e.confidence.toFixed(2) : '—'); m.textContent = text.slice(e.start, e.end);
      const tag = document.createElement('sup'); tag.className = 'font-mono text-[9px] ml-0.5 text-swiss-grayDark'; tag.textContent = e.label;
      marked.appendChild(m); marked.appendChild(tag); pos = e.end;
    });
    if (pos < text.length) marked.appendChild(document.createTextNode(text.slice(pos)));
    $('ner-n').textContent = String(ents.length);
    $('ner-rows').innerHTML = ents.map((e, k) => '<tr><td class="p-2 font-mono">' + esc(e.label) + '</td><td class="p-2">' + esc(e.text) + (overlapped.has(k) ? ' <span class="text-swiss-grayDark" title="Se solapa con otra entidad y no se resalta">(solapada)</span>' : '') + '</td><td class="p-2 text-right font-mono">' + e.start + '–' + e.end + '</td><td class="p-2 text-right font-mono">' + (isFinite(e.confidence) ? e.confidence.toFixed(3) : '—') + '</td><td class="p-2 font-mono text-swiss-grayDark">' + esc(e.via || e.source || '') + '</td></tr>').join('') || '<tr><td colspan="5" class="p-4 text-center font-mono text-swiss-grayDark">Sin entidades por encima del umbral. Pruebe a bajarlo o a ampliar las descripciones.</td></tr>';
    $('ner-notes').innerHTML = (result.notes || []).map((n) => '<div>• ' + esc(n) + '</div>').join('');
  }

  function exportCsv() {
    if (!N.last) return; const d = ';';
    const rows = [['etiqueta', 'texto', 'inicio', 'fin', 'confianza', 'motor'].join(d)].concat(N.last.result.entities.slice().sort((a, b) => a.start - b.start).map((e) => [e.label, e.text, e.start, e.end, e.confidence, N.last.result.engine].map((x) => A.csvCell(x, d)).join(d)));
    A.download('jev_entidades.csv', 'text/csv;charset=utf-8', '﻿' + rows.join('\r\n') + '\r\n');
  }
  function exportJson() {
    if (!N.last) return; const r = N.last.result;
    A.download('jev_entidades.json', 'application/json', JSON.stringify({ exported_at: new Date().toISOString(), engine: r.engine, model: r.model, threshold: r.threshold, offsets: 'UTF-16 (índices de String de JavaScript)', labels: N.last.labels, text: N.last.text, entities: r.entities }, null, 2));
  }

  /* ───── registro en la aplicación ───── */

  A.tabHooks.entities = function () {
    paintBatchInfo();
    if (N.inited) { syncWithDefinition(); return; }
    N.inited = true;
    loadCustom(); fillPresetSelect();
    $('ner-preset').addEventListener('change', () => loadPreset($('ner-preset').value));
    $('ner-tpl-file').addEventListener('change', (e) => { importTemplates(e.target.files[0]); e.target.value = ''; });
    loadPreset(Object.keys(PRE.NER_PRESETS)[0]);
    syncWithDefinition();
    $('ner-text').addEventListener('input', () => { N.userText = true; updateCount(); });
    if ($('ner-model')) $('ner-model').addEventListener('change', () => paintStatus());
    $('ner-threshold').addEventListener('input', (e) => { $('ner-threshold-out').textContent = Number(e.target.value).toFixed(2); });
    $('ner-labels').addEventListener('input', (e) => {
      const el = e.target; const l = N.labels.find((x) => String(x.uid) === el.dataset.nl); if (!l) return;
      if (el.dataset.f === 'name') l.name = el.value; else if (el.dataset.f === 'desc') l.desc = el.value;
      N.dirty = true;
    });
    checkHealth();
  };
  A.actions['ner-tpl-save'] = saveTemplate;
  A.actions['ner-tpl-delete'] = deleteTemplate;
  A.actions['ner-tpl-export'] = exportTemplates;
  A.actions['ner-tpl-import'] = () => $('ner-tpl-file').click();
  A.actions['ner-new'] = () => { N.labels = []; N.dirty = true; $('ner-tpl-name').value = ''; renderLabels(); A.toast('Etiquetas vacías: añada las suyas con «+ Etiqueta» y guárdelas con «Mi plantilla»'); };
  A.actions['ner-sample'] = () => {
    const p = getPreset($('ner-preset').value);
    if (!p || !p.sample) { A.toast('Esta plantilla no incluye texto de ejemplo.'); return; }
    $('ner-text').value = p.sample; N.sample = p.sample; N.userText = false; N.last = null; $('ner-result').classList.add('hidden'); updateCount();
  };
  A.actions['ner-load-preset'] = () => loadPreset($('ner-preset').value);
  A.actions['ner-add-label'] = () => { if (N.labels.length >= LIM.labels) { A.toast('Máximo ' + LIM.labels + ' etiquetas.'); return; } N.labels.push({ uid: ++N.uid, name: '', desc: '' }); N.dirty = true; renderLabels(); };
  A.actions['ner-remove-label'] = (el) => { N.labels = N.labels.filter((l) => String(l.uid) !== el.dataset.nl); N.dirty = true; renderLabels(); };
  function setText(text) {
    if (!text || !text.trim()) { A.toast('El registro no tiene texto.'); return false; }
    $('ner-text').value = text; N.userText = false; N.last = null; $('ner-result').classList.add('hidden'); updateCount(); return true;
  }
  /* Puente con la pestaña «Definición»: el mismo texto que se clasifica con Jev se puede pasar a la extracción de entidades. */
  A.actions['ner-from-workspace'] = () => {
    const items = A.currentItems().items;
    if (!items.length) { A.toast('No hay texto en «Definición».'); return; }
    const k = Math.max(1, Math.min(items.length, Math.floor(Number($('ner-rec').value) || 1)));
    $('ner-rec').value = String(k);
    if (setText(items[k - 1].label)) A.toast('Texto del registro ' + k + ' de ' + items.length + ' cargado');
  };
  A.actions['to-entities'] = (el) => {
    const r = A.S.results.find((x) => String(x.n) === el.dataset.n); if (!r) return;
    A.switchTab('entities');
    if (setText(r.label)) A.toast('Texto del registro ' + r.n + ' cargado; pulse «Extraer entidades»');
  };
  A.actions['ner-run'] = run;
  A.actions['ner-batch-run'] = runBatch;
  A.actions['ner-batch-cancel'] = () => { B.cancel = true; };
  A.actions['ner-batch-csv'] = batchCsv;
  A.actions['ner-batch-json'] = batchJson;
  A.actions['ner-check'] = checkHealth;
  A.actions['ner-export-csv'] = exportCsv;
  A.actions['ner-export-json'] = exportJson;
})();
