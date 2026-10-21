/**
 * JEVSim — Simulador determinista de System One (Choice / Score / Noul).
 *
 * NO es Jev ni un modelo entrenado: es un motor léxico-conceptual transparente pensado para que quien no
 * dispone de API pueda estudiar cómo se comportan las primitivas. Garantías de diseño:
 *   1. Determinista: el mismo estado y las mismas preguntas producen siempre el mismo resultado (sin Math.random).
 *   2. Coherente con la documentación oficial: genera `probabilities` y de ellas deriva `choice`, `score` y
 *      `confidence` con las fórmulas de JEVF (docs.typesafe.ai/confidence), nunca valores inventados aparte.
 *   3. Forma de respuesta idéntica a la API ({model, answers, usage}), de modo que el resto de la aplicación
 *      trata igual simulación y modo en vivo.
 *   4. Trazable: cada respuesta incluye una traza (evidencias, puntuaciones brutas, temperatura, pasos de cálculo).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./formulas.js'), require('./lexicon.js'));
  else root.JEVSim = factory(root.JEVF, root.JEVLEX);
})(typeof self !== 'undefined' ? self : this, function (F, LEX) {
  'use strict';

  const SIM_MODEL_ID = 'simulation-1.0';
  const TEMPERATURE = 0.9;      // temperatura del softmax de Choice/Score
  const W_LITERAL = 1.2;        // peso de la coincidencia literal (raíces léxicas)
  const W_CONCEPT = 1.7;        // peso de la coincidencia conceptual
  const PRIOR_FALLBACK = 0.35;  // a priori de las opciones «otro / ninguna»
  const PRIOR_NEUTRAL = 0.30;   // a priori de la opción «neutral»
  const FLOOR = 0.015;          // mezcla uniforme mínima (evita probabilidades exactamente 0)
  const NOUL_BIAS = -1.7;       // sesgo a priori de Noul hacia «no»

  const STOP = new Set(LEX.STOPWORDS);
  const NEG = new Set(LEX.NEGATORS);

  /** Implicaciones débiles: ciertos conceptos sugieren un tono negativo aunque no haya palabras de queja. */
  const IMPLIES = {
    outage: { anger: 0.5 }, error: { anger: 0.35 }, urgency: { anger: 0.3 }, security: { anger: 0.4 },
    cancel: { anger: 0.5 }, crowding: { anger: 0.5 }, confusion: { anger: 0.25 }, workload: { anger: 0.3 },
    dispute: { anger: 0.4 }, legal: { anger: 0.5 },
    recommend: { gratitude: 0.6 }
  };

  /* ───────────────────────── Procesamiento de texto ───────────────────────── */

  function fold(s) {
    return String(s === null || s === undefined ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function expandContractions(s) {
    return s
      .replace(/\bcan['’]t\b/g, 'can not').replace(/\bwon['’]t\b/g, 'will not').replace(/\bcannot\b/g, 'can not')
      .replace(/n['’]t\b/g, ' not').replace(/['’](?:re|ve|ll|d|s|m)\b/g, '');
  }

  /** Texto plegado, sin puntuación (salvo $ € £ ? ¿), con espacios simples y rodeado de espacios. */
  function normText(s) {
    return ' ' + expandContractions(fold(s)).replace(/[^a-z0-9$€£?¿]+/g, ' ').replace(/([?¿$€£])/g, ' $1 ').replace(/\s+/g, ' ').trim() + ' ';
  }

  const SUFFIXES = ['aciones', 'amiento', 'amientos', 'imiento', 'imientos', 'amente', 'mente', 'iendo', 'ando', 'ation', 'ations', 'ingly', 'ments', 'ment', 'ings', 'ing', 'edly', 'ies', 'ed', 'es', 's', 'ly', 'ado', 'ada', 'ido', 'ida'];
  function stem(w) {
    for (let i = 0; i < SUFFIXES.length; i++) {
      const suf = SUFFIXES[i];
      if (w.length - suf.length >= 4 && w.endsWith(suf)) return w.slice(0, -suf.length);
    }
    return w;
  }

  function tokenize(s) {
    return normText(s).trim().split(' ').filter(Boolean);
  }

  /* ───────────────────────── Compilación del léxico ───────────────────────── */

  const COMPILED = Object.keys(LEX.CONCEPTS).map((name) => {
    const def = LEX.CONCEPTS[name];
    const single = new Set(); const phrases = []; const symbols = [];
    def.terms.forEach((t) => {
      const f = normText(t).trim();
      if (!f) return;
      if (/^[?¿$€£]$/.test(f)) symbols.push(f);
      else if (f.indexOf(' ') >= 0) phrases.push(' ' + f + ' ');
      else single.add(stem(f));
    });
    return { name, intensity: def.intensity, single, phrases, symbols };
  });

  /* ───────────────────────── Análisis de un texto ───────────────────────── */

  /**
   * Devuelve {tokens, stems: Map(raíz→n), concepts: Map(nombre→{count, negated, terms:Set})}.
   * Una aparición de una palabra de concepto cuenta como «negada» si alguno de los 3 tokens previos es un negador.
   */
  function analyze(text) {
    const norm = normText(text);
    const tokens = norm.trim().split(' ').filter(Boolean);
    const stems = new Map();
    const stemOf = tokens.map((t) => stem(t));
    tokens.forEach((t, i) => {
      if (t.length > 2 && !STOP.has(t) && /[a-z0-9]/.test(t)) stems.set(stemOf[i], (stems.get(stemOf[i]) || 0) + 1);
    });
    const concepts = new Map();
    const add = (name, term, negated) => {
      let c = concepts.get(name);
      if (!c) { c = { count: 0, negated: 0, terms: new Set() }; concepts.set(name, c); }
      if (negated) c.negated++; else c.count++;
      c.terms.add(term);
    };
    COMPILED.forEach((cc) => {
      tokens.forEach((t, i) => {
        if (cc.single.has(stemOf[i])) {
          let neg = false;
          for (let k = Math.max(0, i - 3); k < i; k++) if (NEG.has(tokens[k])) { neg = true; break; }
          add(cc.name, t, neg);
        }
      });
      cc.phrases.forEach((p) => {
        let from = 0; let idx;
        while ((idx = norm.indexOf(p, from)) >= 0) { add(cc.name, p.trim(), false); from = idx + p.length - 1; }
      });
      cc.symbols.forEach((sym) => {
        let from = 0; let idx;
        while ((idx = norm.indexOf(' ' + sym + ' ', from)) >= 0) { add(cc.name, sym, false); from = idx + 2; }
      });
    });
    return { text: String(text === null || text === undefined ? '' : text), tokens, stems, concepts };
  }

  /** Activación efectiva de conceptos del TEXTO evaluado: directa (negadas restan) + implicaciones débiles. */
  function activation(info) {
    const act = new Map();
    info.concepts.forEach((c, name) => {
      const direct = c.count > 0 ? 1 + 0.3 * Math.log(c.count) : 0;
      const neg = c.negated > 0 ? -0.6 : 0;
      const v = Math.max(0, direct) + (c.count === 0 ? neg : 0);
      if (v !== 0) act.set(name, { value: v, via: 'directo', terms: Array.from(c.terms) });
    });
    info.concepts.forEach((c, name) => {
      if (c.count > 0 && IMPLIES[name]) {
        Object.keys(IMPLIES[name]).forEach((tgt) => {
          const w = IMPLIES[name][tgt];
          const prev = act.get(tgt);
          if (!prev) act.set(tgt, { value: w, via: 'implícito desde «' + name + '»', terms: [] });
          else if (prev.via !== 'directo') prev.value = Math.max(prev.value, w);
        });
      }
    });
    return act;
  }

  /** Conceptos de una OPCIÓN o NIVEL: solo apariciones afirmativas; las negadas («sin impacto inmediato») se ignoran. */
  function optionConcepts(info) {
    const set = new Set();
    info.concepts.forEach((c, name) => { if (c.count > 0) set.add(name); });
    return set;
  }

  const idfOf = (df, N) => Math.log(1 + N / Math.max(1, df));
  const fmt = (x) => (Number.isFinite(x) ? x.toFixed(3) : String(x));
  const isFallbackName = (name) => LEX.FALLBACK_OPTION.test(fold(name).replace(/[^a-z0-9]+/g, '_'));
  const isNeutralName = (name) => /^(neutral|neutro|neutra|mixed|mixto)/.test(fold(name));

  /* ───────────────────────── Núcleo de similitud ───────────────────────── */

  /**
   * Puntúa N «documentos» (opciones o niveles) frente a un texto. Cada documento: {label, name, desc}.
   * Devuelve para cada uno {literal, concept, hits:[...], prior, raw}.
   */
  function scoreDocuments(textInfo, docs) {
    const N = docs.length;
    const dinfo = docs.map((d) => analyze((d.name ? String(d.name).replace(/[_\-]+/g, ' ') + ' . ' : '') + (d.desc || '')));
    const nameInfo = docs.map((d) => (d.name ? analyze(String(d.name).replace(/[_\-]+/g, ' ')) : null));
    const dfStem = new Map(); const dfConcept = new Map();
    dinfo.forEach((di) => {
      new Set(di.stems.keys()).forEach((s) => dfStem.set(s, (dfStem.get(s) || 0) + 1));
      optionConcepts(di).forEach((c) => dfConcept.set(c, (dfConcept.get(c) || 0) + 1));
    });
    const act = activation(textInfo);
    return docs.map((d, k) => {
      const di = dinfo[k];
      const hits = [];
      let litSum = 0; let norm = 0;
      di.stems.forEach((_, s) => {
        const idf = idfOf(dfStem.get(s) || 1, N);
        const inName = nameInfo[k] && nameInfo[k].stems.has(s);
        norm += idf;
        const cnt = textInfo.stems.get(s) || 0;
        if (cnt > 0) {
          const w = (inName ? 2 : 1) * idf * (1 + 0.5 * Math.log(cnt));
          litSum += w; hits.push({ kind: 'raíz', name: s, weight: w });
        }
      });
      const literal = norm > 0 ? litSum / Math.sqrt(norm) : 0;
      let conc = 0;
      const dc = optionConcepts(di);
      dc.forEach((c) => {
        const a = act.get(c);
        if (a && a.value > 0) {
          const inName = nameInfo[k] && nameInfo[k].concepts.has(c) && nameInfo[k].concepts.get(c).count > 0;
          const w = idfOf(dfConcept.get(c) || 1, N) * a.value * (inName ? 1.4 : 1);
          conc += w; hits.push({ kind: 'concepto', name: c, weight: w, via: a.via, terms: a.terms.slice(0, 4) });
        } else if (a && a.value < 0) {
          const w = idfOf(dfConcept.get(c) || 1, N) * a.value; conc += w;
          hits.push({ kind: 'concepto (negado)', name: c, weight: w, via: 'negación', terms: [] });
        }
      });
      conc = conc / Math.sqrt(Math.max(1, dc.size) / 2);
      return { literal, concept: conc, hits, raw: W_LITERAL * literal + W_CONCEPT * conc };
    });
  }

  /** Redondea a 3 decimales y corrige el residuo en el elemento mayor para que la suma sea exactamente 1. */
  function roundDistribution(p) {
    const r = p.map((x) => Math.round(x * 1000) / 1000);
    const diff = Math.round((1 - r.reduce((a, b) => a + b, 0)) * 1000) / 1000;
    if (diff !== 0) r[F.argmax(r)] = Math.round((r[F.argmax(r)] + diff) * 1000) / 1000;
    return r;
  }
  function withFloor(p) {
    const n = p.length; return p.map((x) => (1 - FLOOR) * x + FLOOR / n);
  }

  /* ───────────────────────── Choice ───────────────────────── */

  function simulateChoice(textInfo, q) {
    const options = Object.keys(q.criteria);
    const docs = options.map((o) => ({ label: o, name: o, desc: q.criteria[o] === null ? '' : String(q.criteria[o]) }));
    const sc = scoreDocuments(textInfo, docs);
    const act = activation(textInfo);
    const evidenceTotal = sc.reduce((a, s) => a + Math.max(0, s.raw), 0);
    const steps = [];
    sc.forEach((s, k) => {
      let prior = 0;
      if (isFallbackName(options[k])) prior = PRIOR_FALLBACK;
      else if (isNeutralName(options[k])) prior = PRIOR_NEUTRAL;
      // Una opción «neutral/otro» pierde su a priori cuando hay evidencia clara a favor de otra opción.
      s.prior = prior;
      s.total = s.raw + prior;
    });
    const raw = sc.map((s) => s.total);
    const pSoft = F.softmax(raw, TEMPERATURE);
    const p = roundDistribution(withFloor(pSoft));
    const probs = {}; options.forEach((o, k) => { probs[o] = p[k]; });
    const res = F.choiceFromProbabilities(probs);
    const n = options.length;
    steps.push('Puntuación bruta por opción = ' + W_LITERAL + '·literal + ' + W_CONCEPT + '·concepto + a priori.');
    options.forEach((o, k) => steps.push('  ' + o + ': ' + W_LITERAL + '·' + fmt(sc[k].literal) + ' + ' + W_CONCEPT + '·' + fmt(sc[k].concept) + ' + ' + fmt(sc[k].prior) + ' = ' + fmt(sc[k].total)));
    steps.push('Probabilidades = softmax(puntuación / T) con T = ' + TEMPERATURE + ', mezcladas con un suelo uniforme del ' + (FLOOR * 100) + ' %.');
    steps.push('confidence = (p_max − 1/n) / (1 − 1/n) = (' + fmt(res.pmax) + ' − 1/' + n + ') / (1 − 1/' + n + ') = ' + fmt(res.confidence));
    return {
      answer: { type: 'choice', choice: res.choice, confidence: Math.round(res.confidence * 1000) / 1000, probabilities: probs },
      trace: {
        type: 'choice', method: 'coincidencia literal + conceptual → softmax', temperature: TEMPERATURE,
        rawScores: options.map((o, k) => ({ option: o, literal: sc[k].literal, concept: sc[k].concept, prior: sc[k].prior, total: sc[k].total })),
        evidence: options.map((o, k) => ({ option: o, hits: sc[k].hits.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 8) })),
        activeConcepts: Array.from(act.entries()).map(([name, a]) => ({ name, value: a.value, via: a.via, terms: a.terms })),
        noEvidence: evidenceTotal < 0.05,
        steps
      }
    };
  }

  /* ───────────────────────── Score ───────────────────────── */

  /** Dimensión que mide una rúbrica Score, deducida del enunciado: urgency | technical | risk. */
  function detectDimension(instructions, levels) {
    const norm = normText(propositionText(instructions) + ' ' + (levels || []).join(' '));
    let best = 'urgency'; let bestN = 0;
    ['risk', 'technical', 'urgency'].forEach((dim) => {
      let n = 0;
      LEX.DIM_CUES[dim].forEach((cue) => { if (norm.indexOf(' ' + normText(cue).trim() + ' ') >= 0 || norm.indexOf(' ' + normText(cue).trim()) >= 0) n++; });
      if (n > bestN) { best = dim; bestN = n; }
    });
    return best;
  }

  function conceptIntensity(name, dim) {
    const d = LEX.DIMS[name];
    if (d && d[dim] !== undefined) return d[dim];
    const def = LEX.CONCEPTS[name];
    return dim === 'urgency' && def ? def.intensity : 0;
  }

  function severityEstimate(textInfo, dim) {
    const dimension = dim || 'urgency';
    const hits = [];
    textInfo.concepts.forEach((c, name) => {
      const it = conceptIntensity(name, dimension);
      if (c.count > 0 && it > 0) hits.push({ name, intensity: it });
    });
    const positive = textInfo.concepts.has('gratitude') && textInfo.concepts.get('gratitude').count > 0;
    const calm = textInfo.concepts.has('neutral_cue') && textInfo.concepts.get('neutral_cue').count > 0;
    if (hits.length === 0) return { sev: positive ? 0.03 : 0.12, hits, dimension, rule: positive ? 'solo tono positivo → 0,03' : 'sin señales en la dimensión «' + dimension + '» → 0,12' };
    hits.sort((a, b) => b.intensity - a.intensity);
    const strong = hits.filter((h) => h.intensity >= 0.6).length;
    let sev = hits[0].intensity + Math.min(0.1, 0.04 * Math.max(0, strong - 1));
    if (positive && hits[0].intensity < 0.4) sev = Math.min(sev, 0.15);
    if (calm) sev = Math.max(0.05, sev - 0.2);
    return { sev: F.clamp(sev, 0, 1), hits, dimension, rule: 'dimensión «' + dimension + '»: máx. «' + hits[0].name + '» (' + hits[0].intensity + ')' + (strong > 1 ? ' + ' + Math.min(0.1, 0.04 * (strong - 1)).toFixed(2) + ' por señales fuertes adicionales' : '') + (calm ? ' − 0,20 por indicio de normalidad' : '') };
  }

  const NEG_CONCEPTS = ['anger', 'confusion', 'workload', 'crowding', 'outage', 'error', 'security', 'legal', 'cancel', 'dispute'];
  const POS_CONCEPTS = ['gratitude', 'praise_cue'];

  /**
   * {pos: 0–1, neg: 0–1, posHits, negNames} de un texto ya analizado.
   * `allowed` restringe los conceptos negativos relevantes (los de la rúbrica); «anger» y sus implicaciones cuentan siempre.
   */
  function polarity(info, allowed) {
    let posHits = 0; let neg = 0; const negNames = [];
    POS_CONCEPTS.forEach((c) => { const x = info.concepts.get(c); if (x && x.count > 0) posHits += x.terms.size; if (x && x.count === 0 && x.negated > 0) neg = Math.max(neg, 0.5); });
    NEG_CONCEPTS.forEach((c) => {
      const x = info.concepts.get(c);
      if (!x || x.count === 0) return;
      if (allowed && c !== 'anger' && !allowed.has(c)) {
        const imp = IMPLIES[c] && IMPLIES[c].anger ? 0.8 * IMPLIES[c].anger : 0; // el concepto no mide esta dimensión, pero sugiere tono negativo
        if (imp > 0) { neg = Math.max(neg, imp); negNames.push(c + '→anger'); }
        return;
      }
      neg = Math.max(neg, LEX.CONCEPTS[c].intensity); negNames.push(c);
    });
    return { pos: posHits > 0 ? Math.min(1, 0.55 + 0.15 * posHits) : 0, neg, posHits, negNames };
  }

  /** v ∈ [0,1]: 0 = muy negativo, 1 = muy positivo. */
  function valenceEstimate(info, allowed) {
    const pol = polarity(info, allowed);
    return { v: F.clamp(0.5 + 0.40 * pol.pos - 0.45 * pol.neg, 0.03, 0.97), pol };
  }

  /**
   * ¿La rúbrica crece en positividad («satisfecho» arriba) o en gravedad («crítico» arriba)?
   * Compara la polaridad del primer y del último nivel.
   */
  function rubricOrientation(levels) {
    const first = polarity(analyze(levels[0])); const last = polarity(analyze(levels[levels.length - 1]));
    const o = (last.pos - first.pos) + 0.5 * (first.neg - last.neg);
    // Conceptos negativos que la propia rúbrica utiliza en su mitad baja (p. ej. «confusion» en una escala de claridad).
    const allowed = new Set();
    for (let i = 0; i < Math.max(1, Math.floor(levels.length / 2)); i++) {
      analyze(levels[i]).concepts.forEach((c, name) => { if (c.count > 0 && NEG_CONCEPTS.indexOf(name) >= 0) allowed.add(name); });
    }
    return { orientation: o > 0.25 ? 'valence' : 'severity', o, allowed };
  }
  function blur(p) {
    const n = p.length; const out = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      out[i] += 0.8 * p[i];
      if (i > 0) out[i - 1] += 0.1 * p[i]; else out[i] += 0.1 * p[i];
      if (i < n - 1) out[i + 1] += 0.1 * p[i]; else out[i] += 0.1 * p[i];
    }
    return out;
  }

  function simulateScore(textInfo, q) {
    const levels = q.criteria.map((c) => String(c));
    const n = levels.length;
    const docs = levels.map((l, i) => ({ label: 'L' + i, name: null, desc: l }));
    const sc = scoreDocuments(textInfo, docs);
    const E = Math.max.apply(null, sc.map((s) => s.raw).concat([0]));
    const qDist = F.softmax(sc.map((s) => s.raw), TEMPERATURE);
    const dimension = detectDimension(q.instructions, levels);
    const sevInfo = severityEstimate(textInfo, dimension);
    const orient = rubricOrientation(levels);
    const val = valenceEstimate(textInfo, orient.allowed);
    const mu = (orient.orientation === 'valence' ? val.v : sevInfo.sev) * (n - 1);
    const sigma = 0.55 + 0.25 * (n - 1) / 3;
    const g = []; for (let i = 0; i < n; i++) g.push(Math.exp(-((i - mu) * (i - mu)) / (2 * sigma * sigma)));
    const G = F.normalize(g);
    const lambda = E > 0.05 ? F.clamp(0.10 + 0.08 * E, 0.10, 0.35) : 0;
    const mix = G.map((gi, i) => lambda * qDist[i] + (1 - lambda) * gi);
    const p = roundDistribution(withFloor(blur(F.normalize(mix))));
    const res = F.scoreFromProbabilities(p);
    const probs = {}; const legend = {};
    p.forEach((x, i) => { probs[String(i)] = x; legend[String(i)] = levels[i]; });
    const score = Math.round(res.score * 1000) / 1000;
    const steps = [
      orient.orientation === 'valence'
        ? 'La rúbrica crece en positividad (último nivel más positivo que el primero) → valencia del texto v = ' + fmt(val.v) + ' → centro μ = v·(n−1) = ' + fmt(mu) + ', σ = ' + fmt(sigma) + '.'
        : 'La rúbrica crece en gravedad → estimación de gravedad s = ' + fmt(sevInfo.sev) + ' (' + sevInfo.rule + ') → centro μ = s·(n−1) = ' + fmt(mu) + ', σ = ' + fmt(sigma) + '.',
      'Similitud rúbrica↔texto: máx. puntuación bruta E = ' + fmt(E) + ' → peso de la rúbrica λ = ' + fmt(lambda) + ' (0 si no hay solapamiento).',
      'p = (1−λ)·Gauss(μ,σ) + λ·softmax(rúbrica/T), con suavizado ordinal [0,1 · 0,8 · 0,1] y suelo del ' + (FLOOR * 100) + ' %.',
      'score = Σ i·p_i = ' + p.map((x, i) => i + '×' + fmt(x)).join(' + ') + ' = ' + fmt(res.score),
      'confidence = 1 − Σ p_i·|i − m| / MAD_unif, con m = ' + res.mode + ' y MAD_unif = ' + fmt(F.madUniform(n)) + ' → ' + fmt(res.confidence)
    ];
    return {
      answer: { type: 'score', score, confidence: Math.round(res.confidence * 1000) / 1000, legend, probabilities: probs },
      trace: {
        type: 'score', method: 'gravedad léxica (gaussiana ordinal) + similitud con la rúbrica', temperature: TEMPERATURE,
        orientation: orient.orientation, severity: sevInfo.sev, valence: val.v, mu, sigma, lambda, E,
        rawScores: sc.map((s, i) => ({ level: i, literal: s.literal, concept: s.concept, total: s.raw })),
        evidence: sc.map((s, i) => ({ level: i, hits: s.hits.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 6) })),
        severityHits: sevInfo.hits, steps
      }
    };
  }

  /* ───────────────────────── Noul ───────────────────────── */

  function propositionText(instructions) {
    if (typeof instructions === 'string') return instructions;
    if (Array.isArray(instructions)) return instructions.map(propositionText).join(' . ');
    if (instructions && typeof instructions === 'object') {
      const keys = Object.keys(instructions);
      const pref = ['question', 'main_question', 'pregunta'].find((k) => keys.indexOf(k) >= 0);
      if (pref) return propositionText(instructions[pref]);
      return keys.map((k) => propositionText(instructions[k])).join(' . ');
    }
    return '';
  }

  const sigmoid = (z) => 1 / (1 + Math.exp(-z));

  /** Conceptos genéricos: matizan la proposición pero no la definen. */
  const GENERIC = new Set(['request', 'question', 'neutral_cue']);
  /** Conceptos «de postura» (qué hace o siente el autor) pesan más que los temáticos (de qué habla). */
  const STANCE = new Set(['cancel', 'human', 'security', 'legal', 'urgency', 'anger', 'gratitude', 'dispute', 'identity', 'crowding', 'confusion', 'workload', 'outage', 'recommend', 'change']);
  const TOPIC_WEIGHT = 0.35;

  function simulateNoul(textInfo, q) {
    const prop = analyze(propositionText(q.instructions) + (q.criteria && q.criteria.true ? ' . ' + q.criteria.true : ''));
    const act = activation(textInfo);
    let propConcepts = Array.from(prop.concepts.entries()).filter(([, c]) => c.count > 0).map(([name]) => name);
    const hasRequestCue = propConcepts.indexOf('request') >= 0;
    const core = propConcepts.filter((c) => !GENERIC.has(c));
    if (core.length > 0) propConcepts = core;
    const matched = []; let covNum = 0; let covDen = 0;
    propConcepts.forEach((c) => {
      const w = STANCE.has(c) ? 1 : TOPIC_WEIGHT;
      covDen += w;
      const a = textInfo.concepts.get(c);
      if (a && a.count > 0) { matched.push({ kind: 'concepto', name: c, terms: Array.from(a.terms).slice(0, 4), weight: w }); covNum += w; }
      else if (a && a.negated > 0) { matched.push({ kind: 'concepto (negado)', name: c, terms: Array.from(a.terms).slice(0, 4), weight: -0.8 * w }); covNum -= 0.8 * w; }
      else if (act.get(c) && act.get(c).via !== 'directo') { matched.push({ kind: 'concepto (implícito)', name: c, terms: [], weight: 0.4 * w }); covNum += 0.4 * w; }
    });
    const nC = propConcepts.length;
    let litMatched = 0; let litTotal = 0; const litHits = [];
    prop.stems.forEach((cnt, s) => {
      litTotal += 1;
      if (textInfo.stems.has(s)) { litMatched += 1; litHits.push(s); }
    });
    const covS = litTotal > 0 ? litMatched / litTotal : 0;
    const covCn = covDen > 0 ? covNum / covDen : 0;
    const reqCue = hasRequestCue && textInfo.concepts.has('request') && textInfo.concepts.get('request').count > 0;
    let z;
    if (nC > 0) z = NOUL_BIAS + 3.4 * covCn + 1.6 * covS + (reqCue ? 0.6 : 0);
    else z = -1.6 + 4.0 * covS;
    let falsePenalty = 0;
    if (q.criteria && q.criteria.false) {
      const fi = analyze(q.criteria.false); let fm = 0; let ft = 0;
      fi.stems.forEach((_, s) => { ft++; if (textInfo.stems.has(s)) fm++; });
      falsePenalty = ft > 0 ? 1.5 * (fm / ft) : 0; z -= falsePenalty;
    }
    const p = F.clamp(Math.round(sigmoid(z) * 1000) / 1000, 0.01, 0.99);
    const steps = [
      'Conceptos de la proposición: ' + (nC ? propConcepts.map((c) => c + (STANCE.has(c) ? '' : ' (temático, peso ' + TOPIC_WEIGHT + ')')).join(', ') : '(ninguno reconocido)') + '.',
      'Cobertura conceptual = ' + fmt(covNum) + '/' + fmt(covDen || 1) + ' = ' + fmt(covCn) + '; cobertura de raíces = ' + litMatched + '/' + (litTotal || 1) + ' = ' + fmt(covS) + (reqCue ? '; indicio de petición en el texto: +0,6' : '') + '.',
      nC > 0 ? 'z = ' + NOUL_BIAS + ' + 3,4·' + fmt(covCn) + ' + 1,6·' + fmt(covS) + (reqCue ? ' + 0,6' : '') + (falsePenalty ? ' − ' + fmt(falsePenalty) : '') + ' = ' + fmt(z) : 'z = −1,6 + 4,0·' + fmt(covS) + (falsePenalty ? ' − ' + fmt(falsePenalty) : '') + ' = ' + fmt(z),
      'noul = σ(z) = 1/(1+e^(−z)) = ' + fmt(p) + '  (probabilidad de «sí»; Noul no devuelve `confidence`).',
      'Confianza derivada |2p − 1| = ' + fmt(F.noulConfidence(p)) + '.'
    ];
    return {
      answer: { type: 'noul', noul: p },
      trace: { type: 'noul', method: 'cobertura conceptual y léxica de la proposición → sigmoide', z, covConcept: covCn, covStem: covS, matched, literalHits: litHits.slice(0, 8), propositionConcepts: propConcepts, steps }
    };
  }

  /* ───────────────────────── API pública ───────────────────────── */

  function estimateTokens(s) { return Math.max(1, Math.ceil(String(s).length / 4)); }

  /**
   * @param state     texto (string) o estructura; los objetos se serializan.
   * @param questions mapa en formato de red {id: {type, instructions, criteria}}
   * @returns {model, answers, usage, trace, simulated_latency_ms}
   */
  function simulate(state, questions) {
    const text = typeof state === 'string' ? state : JSON.stringify(state);
    const info = analyze(text);
    const answers = {}; const trace = {};
    Object.keys(questions).forEach((id) => {
      const q = questions[id]; let r;
      if (q.type === 'choice') r = simulateChoice(info, q);
      else if (q.type === 'score') r = simulateScore(info, q);
      else if (q.type === 'noul') r = simulateNoul(info, q);
      else return;
      answers[id] = r.answer; trace[id] = r.trace;
    });
    const qChars = JSON.stringify(questions).length;
    return {
      model: SIM_MODEL_ID,
      answers,
      usage: { input_tokens: estimateTokens(text) + estimateTokens(qChars ? JSON.stringify(questions) : ''), output_tokens: 12 * Object.keys(answers).length },
      trace,
      // Latencia ESTIMADA (no medida): base fija + coste lineal en los tokens de entrada; determinista.
      simulated_latency_ms: Math.round(140 + 0.35 * (estimateTokens(text) + estimateTokens(JSON.stringify(questions))))
    };
  }

  return { simulate, analyze, activation, stem, fold, tokenize, severityEstimate, SIM_MODEL_ID, TEMPERATURE };
});
