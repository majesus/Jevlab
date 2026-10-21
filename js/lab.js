/* Pestaña «Laboratorio de fórmulas»: calculadoras interactivas de las fórmulas de confianza de TypeSafe (docs.typesafe.ai/confidence)
 * con los pasos numéricos a la vista, y una autoprueba con los ejemplos numéricos de la documentación. */
(function () {
  'use strict';

  const A = window.JEVApp; const F = window.JEVF; const esc = A.esc;
  const $ = (id) => document.getElementById(id);
  const f3 = (x) => (isFinite(x) ? (Math.round(x * 1e4) / 1e4).toString() : '—');
  let inited = false;

  /** Admite «0.61, 0.35», «0,61 0,35», «0.61;0.35» y «0.61,0.35,0.04». */
  function parseNums(s) {
    s = String(s).trim(); if (!s) return [];
    const toks = /[\s;]/.test(s) ? s.split(/[\s;]+/).filter(Boolean).map((t) => t.replace(/,$/, '')) : s.split(',');
    const dotted = s.indexOf('.') >= 0;
    return toks.map((t) => (/^\d*,\d+$/.test(t) && !dotted ? Number(t.replace(',', '.')) : Number(t)));
  }

  function prepare(raw, minLen) {
    const p = parseNums(raw); const notes = [];
    if (p.length < minLen) return { error: 'Se requieren al menos ' + minLen + ' probabilidades.' };
    if (p.some((x) => !isFinite(x) || x < 0)) return { error: 'Todos los valores deben ser números no negativos.' };
    const sum = p.reduce((a, b) => a + b, 0);
    if (!(sum > 0)) return { error: 'La suma debe ser positiva.' };
    let q = p;
    if (Math.abs(sum - 1) > 1e-6) { q = F.normalize(p); notes.push('Σp = ' + f3(sum) + ' ≠ 1: se normaliza (p_i / Σp) antes de calcular.'); }
    return { p: q, notes };
  }

  function calcChoice(raw) {
    const r = prepare(raw, 2); if (r.error) return '<div class="text-swiss-red">' + esc(r.error) + '</div>';
    const p = r.p; const n = p.length; const k = F.argmax(p); const pm = p[k]; const c = F.choiceConfidence(p);
    return r.notes.map((x) => '<div class="text-yellow-800">' + esc(x) + '</div>').join('') +
      '<div>n = ' + n + ' · p_max = p[' + k + '] = ' + f3(pm) + ' · 1/n = ' + f3(1 / n) + '</div>' +
      '<div>confidence = (p_max − 1/n) / (1 − 1/n) = (' + f3(pm) + ' − ' + f3(1 / n) + ') / (1 − ' + f3(1 / n) + ') = <strong>' + f3(c) + '</strong></div>' +
      '<div class="text-swiss-grayDark">0 = distribución uniforme (el modelo duda entre todas) · 1 = toda la masa en una opción.</div>';
  }

  function calcScore(raw) {
    const r = prepare(raw, 2); if (r.error) return '<div class="text-swiss-red">' + esc(r.error) + '</div>';
    const p = r.p; const n = p.length; const s = F.scoreValue(p); const m = F.argmax(p); const mad = F.madUniform(n);
    const spread = p.reduce((a, x, i) => a + x * Math.abs(i - m), 0); const c = F.scoreConfidence(p);
    return r.notes.map((x) => '<div class="text-yellow-800">' + esc(x) + '</div>').join('') +
      '<div>score = Σ i·p_i = ' + p.map((x, i) => i + '×' + f3(x)).join(' + ') + ' = <strong>' + f3(s) + '</strong></div>' +
      '<div>moda m = ' + m + ' (en empate, el menor índice) · Σ p_i·|i − m| = ' + f3(spread) + '</div>' +
      '<div>MAD_unif = (1/n)·Σ|i − (n−1)/2| = ' + f3(mad) + ' (dispersión de una distribución uniforme con n = ' + n + ')</div>' +
      '<div>confidence = max(0, 1 − ' + f3(spread) + ' / ' + f3(mad) + ') = <strong>' + f3(c) + '</strong></div>' +
      '<div>normalizado = score / (n − 1) = ' + f3(s) + ' / ' + (n - 1) + ' = <strong>' + f3(F.normalizedScore(s, n)) + '</strong> · nivel más cercano: ' + F.nearestLevel(s, n) + '</div>' +
      '<div class="text-swiss-grayDark">Para esta misma distribución, la confianza «tipo Choice» sería ' + f3(F.choiceConfidence(p)) + ': Score penaliza la distancia ordinal, Choice no.</div>';
  }

  function calcNoul(pv, no, yes) {
    const p = Number(pv); const lo = Number(no); const hi = Number(yes);
    if (!(p >= 0 && p <= 1)) return '<div class="text-swiss-red">p debe estar en [0, 1].</div>';
    if (!(lo >= 0 && hi <= 1 && lo < hi)) return '<div class="text-swiss-red">Se requiere 0 ≤ NO < SÍ ≤ 1.</div>';
    const d = F.noulDecision(p, lo, hi);
    return '<div>noul = ' + f3(p) + ' · confianza derivada |2p − 1| = ' + f3(F.noulConfidence(p)) + ' <span class="text-swiss-grayDark">(la API no devuelve confidence para Noul)</span></div>' +
      '<div>Decisión con NO ≤ ' + lo + ' y SÍ ≥ ' + hi + ': <strong>' + { yes: 'SÍ', no: 'NO', review: 'REVISIÓN HUMANA' }[d] + '</strong></div>';
  }

  function calcComposite(rows) {
    const items = rows.filter((r) => isFinite(r.score) && r.levels >= 2 && r.weight > 0);
    if (!items.length) return '<div class="text-swiss-red">Introduzca al menos un componente válido (score, niveles ≥ 2, peso > 0).</div>';
    const wsum = items.reduce((a, b) => a + b.weight, 0); const v = F.compositeScore(items);
    return items.map((it, i) => '<div>componente ' + (i + 1) + ': (' + f3(it.weight / wsum) + ') × (' + f3(it.score) + ' / ' + (it.levels - 1) + ') = ' + f3((it.weight / wsum) * F.normalizedScore(it.score, it.levels)) + '</div>').join('') +
      '<div>Σ w_k · normalizado_k = <strong>' + f3(v) + '</strong> <span class="text-swiss-grayDark">(pesos normalizados a Σw = 1; Σw original = ' + f3(wsum) + ')</span></div>';
  }

  /* ───── autoprueba con los ejemplos numéricos de la documentación ───── */

  const DOC_CASES = [
    { name: 'Choice 0.61 / 0.35 / 0.04', fn: () => F.choiceConfidence([0.61, 0.35, 0.04]), exp: 0.42, tol: 0.006, ref: 'confidence → 0.42' },
    { name: 'Choice 0.40 / 0.34 / 0.24 / 0.02', fn: () => F.choiceConfidence([0.40, 0.34, 0.24, 0.02]), exp: 0.20, tol: 1e-9, ref: 'confidence → 0.20' },
    { name: 'Score 0 / 0.57 / 0.43 · score', fn: () => F.scoreValue([0, 0.57, 0.43]), exp: 1.43, tol: 1e-9, ref: 'score → 1.43' },
    { name: 'Score 0 / 0.57 / 0.43 · confidence', fn: () => F.scoreConfidence([0, 0.57, 0.43]), exp: 0.35, tol: 0.006, ref: 'confidence ≈ 0.35' },
    { name: 'Score 0 / 0.5 / 0.5 · confidence', fn: () => F.scoreConfidence([0, 0.5, 0.5]), exp: 0.25, tol: 1e-9, ref: 'confidence → 0.25' },
    { name: 'Score 0.5 / 0 / 0.5 · confidence', fn: () => F.scoreConfidence([0.5, 0, 0.5]), exp: 0, tol: 1e-9, ref: 'confidence → 0 (extremos opuestos)' },
    { name: 'Choice 0 / 0.5 / 0.5 (contraste)', fn: () => F.choiceConfidence([0, 0.5, 0.5]), exp: 0.25, tol: 1e-9, ref: 'misma confianza Choice que el caso anterior' },
    { name: 'Choice 0.5 / 0 / 0.5 (contraste)', fn: () => F.choiceConfidence([0.5, 0, 0.5]), exp: 0.25, tol: 1e-9, ref: 'ídem: Choice no ve la distancia ordinal' }
  ];

  function selfTest() {
    const rows = DOC_CASES.map((c) => { const v = c.fn(); const ok = Math.abs(v - c.exp) <= c.tol; return { c, v, ok }; });
    const all = rows.every((r) => r.ok);
    return '<div class="mb-2 font-mono text-xs ' + (all ? 'text-green-800' : 'text-swiss-red') + ' font-bold">' + (all ? '✓ ' + rows.length + ' de ' + rows.length + ' ejemplos reproducidos' : '⚠ fallan ' + rows.filter((r) => !r.ok).length + ' ejemplos') + '</div>' +
      '<div class="overflow-x-auto"><table class="w-full text-xs"><thead><tr class="bg-swiss-grayBg font-mono text-[11px] uppercase"><th class="p-2 text-left">Caso</th><th class="p-2 text-left">Documentación</th><th class="p-2 text-right">Esperado</th><th class="p-2 text-right">Calculado</th><th class="p-2 text-center">Resultado</th></tr></thead><tbody class="divide-y divide-swiss-border">' +
      rows.map((r) => '<tr><td class="p-2 font-mono">' + esc(r.c.name) + '</td><td class="p-2 text-swiss-grayDark">' + esc(r.c.ref) + '</td><td class="p-2 text-right font-mono">' + r.c.exp + '</td><td class="p-2 text-right font-mono">' + f3(r.v) + '</td><td class="p-2 text-center">' + (r.ok ? '<span class="text-green-800 font-bold">✓</span>' : '<span class="text-swiss-red font-bold">✗</span>') + '</td></tr>').join('') +
      '</tbody></table></div><p class="mt-2 text-[11px] font-mono text-swiss-grayDark">Tolerancia ±0.006 donde la documentación redondea a dos decimales. La suite completa (30 pruebas) está en <code>tests/formulas.test.js</code> (<code>node tests/formulas.test.js</code>).</p>';
  }

  /* ───── interfaz ───── */

  function panel(title, sub, body) {
    return '<section class="bg-white border border-swiss-border p-5 space-y-3"><div class="border-b border-swiss-border pb-2"><h3 class="text-sm font-extrabold uppercase tracking-tight">' + title + '</h3><p class="text-[11px] font-mono text-swiss-grayDark">' + sub + '</p></div>' + body + '</section>';
  }

  function render() {
    const inp = 'class="w-full border border-swiss-border px-2 py-1.5 font-mono text-xs focus:border-swiss-black focus:outline-none"';
    $('view-lab').innerHTML =
      '<div class="border-b-2 border-swiss-black pb-2"><h2 class="text-xl font-extrabold uppercase tracking-tight">Laboratorio de fórmulas</h2><p class="text-xs text-swiss-grayDark font-mono mt-0.5">Compruebe, con números propios, cómo se obtienen <code>confidence</code>, <code>score</code> y la decisión de Noul</p></div>' +
      '<div class="grid grid-cols-1 xl:grid-cols-2 gap-6">' +
      panel('Autoprueba con la documentación', 'Ejemplos numéricos publicados en docs.typesafe.ai/confidence', '<div id="lab-self">' + selfTest() + '</div>') +
      panel('Choice', 'confidence = (p_max − 1/n) / (1 − 1/n)', '<label class="text-[11px] font-mono font-bold uppercase" for="lab-choice">Probabilidades (una por opción)</label><input id="lab-choice" data-lab="choice" value="0.61, 0.35, 0.04" ' + inp + '><div id="lab-choice-out" class="text-xs font-mono space-y-1"></div>') +
      panel('Score', 'score = Σ i·p_i · confidence = max(0, 1 − Σ p_i·|i − m| / MAD_unif)', '<label class="text-[11px] font-mono font-bold uppercase" for="lab-score">Probabilidades por nivel (0, 1, 2, …)</label><input id="lab-score" data-lab="score" value="0, 0.57, 0.43" ' + inp + '><div id="lab-score-out" class="text-xs font-mono space-y-1"></div>') +
      panel('Noul', 'La API devuelve solo p ∈ [0,1]; la decisión y su zona de revisión son responsabilidad de la aplicación', '<div class="grid grid-cols-3 gap-2 text-xs font-mono"><label>p<input id="lab-noul-p" data-lab="noul" type="number" min="0" max="1" step="0.01" value="0.65" ' + inp + '></label><label>NO ≤<input id="lab-noul-no" data-lab="noul" type="number" min="0" max="0.99" step="0.05" value="0.2" ' + inp + '></label><label>SÍ ≥<input id="lab-noul-yes" data-lab="noul" type="number" min="0.01" max="1" step="0.05" value="0.8" ' + inp + '></label></div><input id="lab-noul-range" data-lab="noul-range" type="range" min="0" max="1" step="0.01" value="0.65" class="w-full" aria-label="Valor de p"><div id="lab-noul-out" class="text-xs font-mono space-y-1"></div>') +
      panel('Puntuación compuesta', 'Σ w_k · score_k / (n_k − 1), con Σ w_k = 1 (patrón «composite scoring»)', '<div class="grid grid-cols-3 gap-2 text-[11px] font-mono font-bold uppercase"><span>score</span><span>niveles</span><span>peso</span></div>' +
        [[2, 3, 0.6], [1, 3, 0.3], [0, 2, 0.1]].map((r, i) => '<div class="grid grid-cols-3 gap-2"><input data-lab="comp" data-k="' + i + '" data-c="score" type="number" step="0.01" value="' + r[0] + '" ' + inp + ' aria-label="score ' + (i + 1) + '"><input data-lab="comp" data-k="' + i + '" data-c="levels" type="number" min="2" max="10" step="1" value="' + r[1] + '" ' + inp + ' aria-label="niveles ' + (i + 1) + '"><input data-lab="comp" data-k="' + i + '" data-c="weight" type="number" min="0" step="0.05" value="' + r[2] + '" ' + inp + ' aria-label="peso ' + (i + 1) + '"></div>').join('') + '<div id="lab-comp-out" class="text-xs font-mono space-y-1"></div>') +
      '</div>';
    update();
  }

  function update() {
    $('lab-choice-out').innerHTML = calcChoice($('lab-choice').value);
    $('lab-score-out').innerHTML = calcScore($('lab-score').value);
    $('lab-noul-out').innerHTML = calcNoul($('lab-noul-p').value, $('lab-noul-no').value, $('lab-noul-yes').value);
    const rows = [0, 1, 2].map((k) => { const g = (c) => Number(document.querySelector('[data-lab=comp][data-k="' + k + '"][data-c="' + c + '"]').value); return { score: g('score'), levels: g('levels'), weight: g('weight') }; });
    $('lab-comp-out').innerHTML = calcComposite(rows);
  }

  A.tabHooks.lab = function () {
    if (inited) return; inited = true; render();
    $('view-lab').addEventListener('input', (e) => {
      if (!e.target.dataset.lab) return;
      if (e.target.dataset.lab === 'noul-range') { $('lab-noul-p').value = e.target.value; } else if (e.target.id === 'lab-noul-p') { $('lab-noul-range').value = e.target.value; }
      update();
    });
  };

  window.JEVLab = { parseNums, calcChoice, calcScore, calcNoul, calcComposite, DOC_CASES };
})();
