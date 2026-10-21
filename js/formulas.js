/**
 * JEVF — Fórmulas de cálculo de System One (TypeSafe / Jev).
 *
 * Fuente normativa: https://docs.typesafe.ai/confidence  y  https://docs.typesafe.ai/primitives/{choice,score,noul}
 *
 *   Choice : confidence = (p_max − 1/n) / (1 − 1/n)
 *   Score  : score      = Σ_i i · p_i                         (i = 0 … n−1)
 *            confidence = max(0, 1 − Σ_i p_i·|i − m| / MAD_unif),  m = nivel más probable
 *            MAD_unif   = (1/n) · Σ_i |i − (n−1)/2|
 *            normalizado = score / (n − 1)
 *   Noul   : noul = P(sí) ∈ [0,1]; no existe `confidence` nativo; derivado: |2p − 1|
 *
 * Módulo sin dependencias, utilizable en navegador (window.JEVF) y en Node (require).
 * Todas las funciones son puras y deterministas.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JEVF = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

  /** Índice del primer máximo (empates → menor índice, como numpy.argmax). */
  function argmax(arr) {
    let best = 0;
    for (let i = 1; i < arr.length; i++) if (arr[i] > arr[best]) best = i;
    return best;
  }

  /** Valida un vector de probabilidades. Devuelve {ok, sum, reason}. */
  function checkDistribution(p, tolerance) {
    const tol = tolerance === undefined ? 0.02 : tolerance;
    if (!Array.isArray(p) || p.length < 1) return { ok: false, sum: NaN, reason: 'vector vacío' };
    if (!p.every((x) => isNum(x) && x >= 0 && x <= 1 + 1e-9)) return { ok: false, sum: NaN, reason: 'valores fuera de [0,1] o no finitos' };
    const sum = p.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > tol) return { ok: false, sum, reason: 'la suma no es 1 (±' + tol + ')' };
    return { ok: true, sum, reason: '' };
  }

  /** Normaliza pesos no negativos a una distribución de suma 1 (uniforme si la suma es 0). */
  function normalize(w) {
    const clean = w.map((x) => (isNum(x) && x > 0 ? x : 0));
    const s = clean.reduce((a, b) => a + b, 0);
    if (s <= 0) return clean.map(() => 1 / clean.length);
    return clean.map((x) => x / s);
  }

  /** Softmax numéricamente estable con temperatura T > 0. */
  function softmax(scores, temperature) {
    const T = temperature > 0 ? temperature : 1;
    const m = Math.max.apply(null, scores);
    const e = scores.map((s) => Math.exp((s - m) / T));
    const z = e.reduce((a, b) => a + b, 0);
    return e.map((x) => x / z);
  }

  /* ───────────────────────────── CHOICE ───────────────────────────── */

  /** confidence = (p_max − 1/n)/(1 − 1/n). Con n < 2 la fórmula no está definida: devuelve 1. */
  function choiceConfidence(p) {
    const n = p.length;
    if (n < 2) return 1;
    const pmax = Math.max.apply(null, p);
    return clamp((pmax - 1 / n) / (1 - 1 / n), 0, 1);
  }

  /** Resuelve una respuesta Choice a partir de {opción: probabilidad}. */
  function choiceFromProbabilities(probMap) {
    const keys = Object.keys(probMap);
    const p = keys.map((k) => Number(probMap[k]));
    const i = argmax(p);
    return { choice: keys[i], confidence: choiceConfidence(p), pmax: p[i], n: keys.length };
  }

  /* ───────────────────────────── SCORE ────────────────────────────── */

  /** score = Σ i·p_i */
  function scoreValue(p) {
    let s = 0;
    for (let i = 0; i < p.length; i++) s += i * p[i];
    return s;
  }

  /** MAD_unif = (1/n) Σ |i − (n−1)/2| */
  function madUniform(n) {
    let s = 0;
    for (let i = 0; i < n; i++) s += Math.abs(i - (n - 1) / 2);
    return s / n;
  }

  /** confidence = max(0, 1 − Σ p_i·|i − m| / MAD_unif); m = nivel más probable (empate → menor índice). */
  function scoreConfidence(p) {
    const n = p.length;
    if (n < 2) return 1;
    const m = argmax(p);
    let spread = 0;
    for (let i = 0; i < n; i++) spread += p[i] * Math.abs(i - m);
    return clamp(1 - spread / madUniform(n), 0, 1);
  }

  /** score / (n − 1) ∈ [0,1], para comparar o combinar escalas distintas. */
  function normalizedScore(score, nLevels) {
    return nLevels > 1 ? clamp(score / (nLevels - 1), 0, 1) : 0;
  }

  /** Nivel entero más cercano (para etiquetar un score fraccionario). Empate x.5 → nivel superior. */
  function nearestLevel(score, nLevels) {
    return clamp(Math.round(score), 0, nLevels - 1);
  }

  /** Puntuación compuesta (patrón «Composite scoring»): Σ w_k · normalizado_k con Σ w_k = 1. */
  function compositeScore(items) {
    const wsum = items.reduce((a, it) => a + it.weight, 0);
    if (!(wsum > 0)) return NaN;
    return items.reduce((a, it) => a + (it.weight / wsum) * normalizedScore(it.score, it.levels), 0);
  }

  function scoreFromProbabilities(p) {
    return { score: scoreValue(p), confidence: scoreConfidence(p), mode: argmax(p), n: p.length };
  }

  /* ───────────────────────────── NOUL ─────────────────────────────── */

  /** Confianza derivada para Noul: |2p − 1| (la API no la devuelve). */
  function noulConfidence(p) {
    return clamp(Math.abs(2 * p - 1), 0, 1);
  }

  /**
   * Decisión de Noul con zona de revisión humana (patrón de la documentación: YES=0.8, NO=0.2).
   * Devuelve 'yes' | 'no' | 'review'.
   */
  function noulDecision(p, no, yes) {
    const lo = no === undefined ? 0.2 : no;
    const hi = yes === undefined ? 0.8 : yes;
    if (p >= hi) return 'yes';
    if (p <= lo) return 'no';
    return 'review';
  }

  /* ─────────────────── Verificación de respuestas reales ─────────────────── */

  /**
   * Compara lo que devuelve la API con lo recalculado a partir de `probabilities`.
   * Detecta respuestas incoherentes (p. ej. confidence que no corresponde a la fórmula publicada).
   * tol = 0.03 por defecto, porque la API puede redondear probabilidades a 2 decimales.
   */
  function verifyChoiceAnswer(answer, tol) {
    const t = tol === undefined ? 0.03 : tol;
    const issues = [];
    if (!answer || typeof answer.probabilities !== 'object' || answer.probabilities === null) return { ok: false, issues: ['sin probabilities'] };
    const keys = Object.keys(answer.probabilities);
    const p = keys.map((k) => Number(answer.probabilities[k]));
    const d = checkDistribution(p, 0.02);
    if (!d.ok) issues.push('probabilities: ' + d.reason);
    else {
      const r = choiceFromProbabilities(answer.probabilities);
      if (answer.choice !== r.choice && Math.abs(answer.probabilities[answer.choice] - r.pmax) > 1e-9) issues.push('choice no es el argmax (' + r.choice + ')');
      if (isNum(answer.confidence) && Math.abs(answer.confidence - r.confidence) > t) issues.push('confidence ' + answer.confidence + ' ≠ recalculado ' + r.confidence.toFixed(3));
    }
    return { ok: issues.length === 0, issues };
  }

  function verifyScoreAnswer(answer, nLevels, tol) {
    const t = tol === undefined ? 0.03 : tol;
    const issues = [];
    if (!answer || typeof answer.probabilities !== 'object' || answer.probabilities === null) return { ok: false, issues: ['sin probabilities'] };
    const p = [];
    for (let i = 0; i < nLevels; i++) p.push(Number(answer.probabilities[String(i)]));
    const d = checkDistribution(p, 0.02);
    if (!d.ok) issues.push('probabilities: ' + d.reason);
    else {
      const r = scoreFromProbabilities(p);
      if (isNum(answer.score) && Math.abs(answer.score - r.score) > t) issues.push('score ' + answer.score + ' ≠ Σ i·p_i = ' + r.score.toFixed(3));
      if (isNum(answer.confidence) && Math.abs(answer.confidence - r.confidence) > t) issues.push('confidence ' + answer.confidence + ' ≠ recalculado ' + r.confidence.toFixed(3));
    }
    if (isNum(answer.score) && (answer.score < -1e-9 || answer.score > nLevels - 1 + 1e-9)) issues.push('score fuera de [0, n−1]');
    return { ok: issues.length === 0, issues };
  }

  function verifyNoulAnswer(answer) {
    if (!answer || !isNum(Number(answer.noul)) || answer.noul === null || answer.noul === '') return { ok: false, issues: ['noul ausente o no numérico'] };
    const v = Number(answer.noul);
    return v >= 0 && v <= 1 ? { ok: true, issues: [] } : { ok: false, issues: ['noul fuera de [0,1]'] };
  }

  return {
    clamp, isNum, argmax, normalize, softmax, checkDistribution,
    choiceConfidence, choiceFromProbabilities,
    scoreValue, madUniform, scoreConfidence, scoreFromProbabilities, normalizedScore, nearestLevel, compositeScore,
    noulConfidence, noulDecision,
    verifyChoiceAnswer, verifyScoreAnswer, verifyNoulAnswer
  };
});
