/**
 * JEVNER — Simulación de GLiNER2 (extracción de entidades zero-shot) para quien no puede instalar el modelo.
 *
 * NO es GLiNER: combina reconocedores deterministas (expresiones regulares, gazetteers bilingües EN/ES y heurísticas de
 * mayúsculas) y los asigna a las etiquetas del usuario según el nombre y la descripción de cada etiqueta. Mantiene el mismo
 * contrato que el servicio real (gliner_service.py) y la misma regla de integridad que Atlas: cada entidad se
 * comprueba contra la cadena original (text.slice(start, end) === text de la entidad); no se fabrican desplazamientos.
 *
 *   extract(text, labels, {threshold}) → { engine, model, entities:[{label,text,start,end,confidence,source}], notes:[…] }
 *   labels: { nombre_etiqueta: "descripción en lenguaje natural" }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JEVNER = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /* ───────── Gazetteers (términos sin tildes; la coincidencia ignora mayúsculas salvo acrónimos) ───────── */
  const G = {
    theory: ['TAM', 'TAM2', 'TAM3', 'UTAUT', 'UTAUT2', 'TPB', 'TRA', 'TTF', 'DOI', 'ECM', 'ELM', 'SOR', 'SDT', 'SCT', 'RBV', 'TOE', 'AIDA',
      'Technology Acceptance Model', 'Theory of Planned Behavior', 'Theory of Planned Behaviour', 'Theory of Reasoned Action',
      'Unified Theory of Acceptance and Use of Technology', 'Task-Technology Fit', 'Diffusion of Innovations', 'Innovation Diffusion Theory',
      'Expectation Confirmation Model', 'Expectation-Confirmation Model', 'Information Systems Success Model', 'Elaboration Likelihood Model',
      'Stimulus-Organism-Response', 'Self-Determination Theory', 'Social Cognitive Theory', 'Uses and Gratifications', 'Hierarchy of Effects',
      'Resource-Based View', 'Institutional Theory', 'Social Exchange Theory', 'Technology-Organization-Environment', 'Prospect Theory', 'Flow Theory',
      'Modelo de Aceptacion Tecnologica', 'Teoria de la Conducta Planificada', 'Teoria de la Accion Razonada', 'Teoria de la Difusion de Innovaciones',
      'Teoria de la Autodeterminacion', 'Teoria del Intercambio Social', 'Modelo de Confirmacion de Expectativas'],
    method: ['PLS-SEM', 'CB-SEM', 'SEM', 'CFA', 'EFA', 'ANOVA', 'MANOVA', 'NCA', 'fsQCA', 'QCA', 'LDA', 'BERTopic', 'MICOM', 'IPMA', 'MGA', 'PCA', 'OLS',
      'structural equation modeling', 'structural equation modelling', 'confirmatory factor analysis', 'exploratory factor analysis', 'linear regression',
      'logistic regression', 'multiple regression', 'regression analysis', 'regression', 'cluster analysis', 'thematic analysis', 'content analysis',
      'discourse analysis', 'text mining', 'topic modeling', 'topic modelling', 'sentiment analysis', 'necessary condition analysis', 'bibliometric analysis',
      'meta-analysis', 'systematic review', 'machine learning', 'random forest', 'neural network', 'neural networks', 'bootstrapping', 'multigroup analysis',
      'mediation analysis', 'moderation analysis', 'moderated mediation', 'importance-performance map analysis', 'factor analysis', 't-test', 'chi-square',
      'regresion lineal', 'regresion logistica', 'regresion', 'analisis factorial', 'analisis factorial confirmatorio', 'analisis de contenido',
      'analisis tematico', 'analisis del discurso', 'analisis de sentimiento', 'analisis de sentimientos', 'ecuaciones estructurales', 'modelo de ecuaciones estructurales',
      'analisis bibliometrico', 'metaanalisis', 'revision sistematica', 'aprendizaje automatico', 'analisis de conglomerados', 'minería de textos', 'mineria de textos'],
    collection: ['questionnaire', 'questionnaires', 'survey', 'surveys', 'interview', 'interviews', 'semi-structured interviews', 'focus group', 'focus groups',
      'experiment', 'experiments', 'platform log', 'platform logs', 'observation', 'participant observation', 'diary study', 'web scraping', 'scraping', 'online reviews',
      'Web of Science', 'Scopus', 'PubMed', 'TripAdvisor', 'Booking.com', 'Airbnb', 'Google Maps', 'database', 'dataset', 'panel data', 'secondary data',
      'cuestionario', 'cuestionarios', 'encuesta', 'encuestas', 'entrevista', 'entrevistas', 'entrevistas semiestructuradas', 'grupo focal', 'grupos focales',
      'grupo de discusion', 'experimento', 'experimentos', 'observacion', 'observacion participante', 'resenas online', 'base de datos', 'datos secundarios'],
    technology: ['ChatGPT', 'Claude', 'Gemini', 'Copilot', 'generative AI', 'artificial intelligence', 'AI', 'LLM', 'LLMs', 'large language model', 'large language models',
      'blockchain', 'virtual reality', 'augmented reality', 'mixed reality', 'metaverse', 'IoT', 'Internet of Things', '5G', 'chatbot', 'chatbots', 'voice assistant',
      'smart speaker', 'Alexa', 'Siri', 'mobile app', 'mobile apps', 'e-commerce', 'social media', 'recommender system', 'recommender systems', 'robot', 'robots', 'drone', 'drones',
      'inteligencia artificial', 'IA generativa', 'realidad virtual', 'realidad aumentada', 'realidad mixta', 'metaverso', 'internet de las cosas', 'asistente de voz',
      'aplicacion movil', 'aplicaciones moviles', 'comercio electronico', 'redes sociales', 'sistema de recomendacion', 'sistemas de recomendacion', 'plataforma digital'],
    construct: ['perceived usefulness', 'perceived ease of use', 'behavioral intention', 'behavioural intention', 'social influence', 'facilitating conditions',
      'performance expectancy', 'effort expectancy', 'hedonic motivation', 'price value', 'habit', 'trust', 'satisfaction', 'loyalty', 'customer engagement',
      'brand attitude', 'purchase intention', 'perceived risk', 'attitude', 'word of mouth', 'eWOM', 'e-WOM', 'place attachment', 'perceived value', 'self-efficacy',
      'utilidad percibida', 'facilidad de uso percibida', 'intencion de uso', 'intencion conductual', 'influencia social', 'condiciones facilitadoras',
      'expectativa de rendimiento', 'expectativa de esfuerzo', 'motivacion hedonica', 'habito', 'confianza', 'satisfaccion', 'lealtad', 'compromiso del cliente',
      'actitud hacia la marca', 'intencion de compra', 'riesgo percibido', 'actitud', 'boca a boca', 'apego al lugar', 'valor percibido', 'autoeficacia'],
    context: ['university teachers', 'university lecturers', 'hospitals', 'logistics firms', 'tourists', 'SMEs', 'students', 'hotels', 'hotel guests', 'consumers', 'managers',
      'employees', 'residents', 'travellers', 'travelers', 'healthcare workers', 'farmers', 'older adults', 'millennials', 'Generation Z',
      'profesores universitarios', 'docentes universitarios', 'hospitales', 'empresas logisticas', 'turistas', 'pymes', 'estudiantes', 'hoteles', 'huespedes',
      'consumidores', 'directivos', 'empleados', 'residentes', 'viajeros', 'trabajadores sanitarios', 'agricultores', 'personas mayores', 'generacion z'],
    org: ['Google', 'Microsoft', 'Amazon', 'Apple', 'Meta', 'OpenAI', 'Anthropic', 'TypeSafe', 'Fastino', 'Booking', 'Airbnb', 'TripAdvisor', 'Expedia', 'UNWTO', 'OMT', 'OCDE', 'OECD',
      'ONU', 'UN', 'UE', 'EU', 'WHO', 'OMS', 'Iberia', 'Ryanair', 'Vueling', 'Melia', 'Meliá', 'NH Hotels', 'Telefonica', 'Telefónica', 'Santander', 'BBVA', 'CaixaBank', 'Inditex', 'Zara',
      'Nike', 'Adidas', 'Tesla', 'Netflix', 'Spotify', 'Uber', 'Apple Inc', 'IBM', 'Oracle', 'Samsung', 'Huawei', 'Junta de Andalucia', 'Junta de Andalucía', 'Gobierno de España'],
    place: ['España', 'Spain', 'Francia', 'France', 'Italia', 'Italy', 'Portugal', 'Alemania', 'Germany', 'Reino Unido', 'United Kingdom', 'UK', 'Estados Unidos', 'United States', 'USA', 'EEUU', 'EE.UU.',
      'México', 'Mexico', 'Argentina', 'Chile', 'Colombia', 'Perú', 'Peru', 'Japón', 'Japan', 'China', 'India', 'Brasil', 'Brazil', 'Canadá', 'Canada', 'Marruecos', 'Morocco', 'Grecia', 'Greece', 'Turquía', 'Turkey',
      'Sevilla', 'Seville', 'Madrid', 'Barcelona', 'Valencia', 'Málaga', 'Malaga', 'Granada', 'Córdoba', 'Cordoba', 'Cádiz', 'Cadiz', 'Huelva', 'Almería', 'Almeria', 'Jaén', 'Jaen', 'Bilbao', 'Zaragoza',
      'Palma', 'Mallorca', 'Ibiza', 'Menorca', 'Tenerife', 'Canarias', 'Lanzarote', 'Andalucía', 'Andalucia', 'Cataluña', 'Catalonia', 'Galicia', 'Benidorm', 'Marbella', 'San Sebastián', 'Santander',
      'Toledo', 'Salamanca', 'Costa del Sol', 'Costa Brava', 'Ronda', 'Jerez', 'Paris', 'París', 'London', 'Londres', 'Rome', 'Roma', 'Berlin', 'Berlín', 'Lisbon', 'Lisboa', 'Amsterdam', 'Venice', 'Venecia',
      'Florence', 'Florencia', 'Prague', 'Praga', 'Vienna', 'Viena', 'New York', 'Nueva York', 'Tokyo', 'Tokio', 'Kyoto', 'Bangkok', 'Dubai', 'Singapore', 'Singapur', 'Sydney', 'Cancún', 'Cancun',
      'Lima', 'Cusco', 'Buenos Aires', 'Santiago', 'Bogotá', 'Bogota', 'Cartagena', 'Oakland', 'San Francisco', 'Los Angeles', 'Cupertino', 'Europa', 'Europe', 'Asia', 'África', 'Africa', 'eu-central']
  };

  const FIRST_NAMES = new Set(('john jon james robert michael william david richard joseph thomas charles mary patricia jennifer linda elizabeth barbara susan jessica sarah karen anna emma tim jon jack ' +
    'manuel jose juan antonio francisco luis carlos javier miguel angel pedro pablo jesus alejandro fernando sergio rafael daniel alberto ramon enrique diego ' +
    'maria carmen ana isabel laura cristina marta lucia elena paula sara rosa pilar teresa dolores raquel beatriz irene silvia nuria patricia concepcion mercedes ' +
    'sanchez garcia lopez martinez').split(' '));

  const ORG_SUFFIX = /\b(?:Inc\.?|Corp\.?|Corporation|Ltd\.?|LLC|GmbH|S\.A\.U?\.?|S\.L\.U?\.?|S\.L\.|SL|SA|PLC|Group|Grupo|Holdings?|Foundation|Fundaci[oó]n|Council|Consejo|Agency|Agencia|Association|Asociaci[oó]n|Institute|Instituto|Bank|Banco|Hospital|Ministry|Ministerio|Consultores|Consulting)\b/;
  const ORG_PREFIX = /^(?:Universidad|University|Universitat|Universit[eé]|Ministerio|Ministry|Instituto|Institute|Hospital|Banco|Bank|Fundaci[oó]n|Foundation|Ayuntamiento|Diputaci[oó]n|Junta|Consejer[ií]a|Cámara|Camara|Hotel|Hoteles|Grupo|Group)$/;

  const MONTHS = '(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)';

  /* ───────── Reconocedores ───────── */

  /** Gazetteer tolerante a tildes: compara texto y término plegados; un mapa de índices devuelve los desplazamientos sobre el texto original. Los acrónimos exigen mayúsculas exactas. */
  function foldedGazetteer(text, terms, conf) {
    const map = []; let folded = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i].normalize('NFD').replace(/[̀-ͯ]/g, '');
      for (let k = 0; k < ch.length; k++) { folded += ch[k]; map.push(i); }
    }
    const out = [];
    const sorted = terms.slice().sort((a, b) => b.length - a.length);
    sorted.forEach((term) => {
      const strict = /^[A-Z0-9][A-Z0-9.\-]{1,7}$/.test(term) && term === term.toUpperCase();
      const ftTerm = fold(term).replace(/[̀-ͯ]/g, '');
      const pat = new RegExp('(?<![\\p{L}\\p{N}])' + escRe(strict ? term : ftTerm).replace(/\\ /g, '\\s+') + '(?![\\p{L}\\p{N}])', strict ? 'gu' : 'giu');
      const hay = strict ? text : folded;
      let m;
      while ((m = pat.exec(hay)) !== null) {
        const s = strict ? m.index : map[m.index];
        const e = strict ? m.index + m[0].length : map[m.index + m[0].length - 1] + 1;
        out.push({ start: s, end: e, confidence: conf });
      }
    });
    return out;
  }

  function regexMatches(text, re, conf, filter) {
    const out = []; let m;
    const r = new RegExp(re.source, re.flags.indexOf('g') >= 0 ? re.flags : re.flags + 'g');
    while ((m = r.exec(text)) !== null) {
      if (m[0].length === 0) { r.lastIndex++; continue; }
      if (filter && !filter(m[0], m)) continue;
      out.push({ start: m.index, end: m.index + m[0].length, confidence: conf });
    }
    return out;
  }

  const RECOGNIZERS = {
    email: (t) => regexMatches(t, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/, 0.99),
    url: (t) => regexMatches(t, /\bhttps?:\/\/[^\s)<>"']+|\bwww\.[^\s)<>"']+/i, 0.98, null).map((x) => { while (/[.,;:]$/.test(t.slice(x.start, x.end))) x.end--; return x; }),
    phone: (t) => regexMatches(t, /(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?){2,4}\d{2,4}/, 0.78, (s) => (s.replace(/\D/g, '').length >= 9 && s.replace(/\D/g, '').length <= 14 && !/^\d{4}-\d{2}-\d{2}$/.test(s.trim()))),
    date: (t) => [].concat(
      regexMatches(t, /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|\s?UTC)?)?\b/, 0.97),
      regexMatches(t, /\b\d{1,2}[/.-]\d{1,2}[/.-](?:\d{4}|\d{2})\b/, 0.9),
      regexMatches(t, new RegExp('\\b\\d{1,2}(?:\\s+de)?\\s+' + MONTHS + '(?:\\s+de)?(?:\\s+\\d{4})?\\b', 'i'), 0.93),
      regexMatches(t, new RegExp('\\b' + MONTHS + '\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b', 'i'), 0.92),
      regexMatches(t, new RegExp('\\b' + MONTHS + '(?:\\s+de)?\\s+\\d{4}\\b', 'i'), 0.9),
      regexMatches(t, /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?(?:UTC|GMT|[ap]\.?m\.?|h))?\b/i, 0.82),
      regexMatches(t, /\b(?:19|20)\d{2}\b/, 0.62),
      regexMatches(t, /\b(?:ayer|hoy|ma[nñ]ana|anteayer|yesterday|today|tomorrow|last (?:week|month|year)|el pasado (?:mes|a[nñ]o)|la semana pasada)\b/i, 0.58)
    ),
    money: (t) => regexMatches(t, /(?:[$€£]\s?\d[\d.,]*(?:\s?(?:k|m|mil|millones))?|\d[\d.,]*\s?(?:€|\$|£|euros?|d[oó]lares|dollars|usd|eur|gbp)\b)/i, 0.91),
    percent: (t) => regexMatches(t, /\d+(?:[.,]\d+)?\s?%|\d+(?:[.,]\d+)?\s?(?:por ciento|percent|per cent)\b/i, 0.94),
    sample: (t) => [].concat(
      regexMatches(t, /\b\d[\d.,]*\s+(?:respondents|participants|students|estudiantes|encuestad[oa]s|participantes|reviews|rese[nñ]as|studies|estudios|articles|art[ií]culos|users|usuarios|employees|empleados|customers|clientes|observations|observaciones|cases|casos|firms|empresas|tourists|turistas|teachers|profesores|docentes|hotels|hoteles|interviewees|entrevistad[oa]s|papers|documents|documentos|records|registros)\b/i, 0.9),
      regexMatches(t, /\bn\s?=\s?\d[\d.,]*/i, 0.88)
    ),
    theory: (t) => foldedGazetteer(t, G.theory, 0.92),
    method: (t) => foldedGazetteer(t, G.method, 0.9),
    collection: (t) => foldedGazetteer(t, G.collection, 0.86),
    technology: (t) => foldedGazetteer(t, G.technology, 0.84),
    construct: (t) => foldedGazetteer(t, G.construct, 0.78),
    context: (t) => foldedGazetteer(t, G.context, 0.72),
    place: (t) => foldedGazetteer(t, G.place, 0.9),
    org: (t) => {
      const out = foldedGazetteer(t, G.org, 0.9);
      // «Universidad de Sevilla», «Ministerio de Turismo», «Acme Corp», «Hotel Alfonso XIII»
      const re = /(?:[A-ZÁÉÍÓÚÑ][\p{L}\p{N}&'’.-]*)(?:\s+(?:de|del|de la|de los|de las|of|the|y|and|&)\s+|\s+)(?:[A-ZÁÉÍÓÚÑ][\p{L}\p{N}&'’.-]*)(?:\s+(?:(?:de|del|of|the|y|and)\s+)?[A-ZÁÉÍÓÚÑ][\p{L}\p{N}&'’.-]*){0,3}/gu;
      let m;
      while ((m = re.exec(t)) !== null) {
        const s = m[0]; const first = s.split(/\s+/)[0].replace(/[.,]$/, '');
        if (ORG_PREFIX.test(first) || ORG_SUFFIX.test(s)) out.push({ start: m.index, end: m.index + s.length, confidence: 0.82 });
      }
      regexMatches(t, /\b[A-ZÁÉÍÓÚÑ][\p{L}\p{N}&]*(?:\s+[A-ZÁÉÍÓÚÑ][\p{L}\p{N}&]*)*,?\s+(?:Inc\.?|Corp\.?|Ltd\.?|LLC|GmbH|S\.A\.|S\.L\.|SL|SA|PLC)\b/u, 0.85).forEach((x) => out.push(x));
      return out;
    },
    person: (t) => {
      const out = [];
      const hon = /\b(?:Dr\.?|Dra\.?|Prof\.?|Profa\.?|Sr\.?|Sra\.?|Mr\.?|Mrs\.?|Ms\.?|D\.|Dña\.?|Don|Doña)\s+[A-ZÁÉÍÓÚÑ][\p{L}'’-]+(?:\s+(?:de|del|de la|van|von|da|di)?\s*[A-ZÁÉÍÓÚÑ][\p{L}'’-]+){0,3}/gu;
      let m;
      while ((m = hon.exec(t)) !== null) out.push({ start: m.index, end: m.index + m[0].length, confidence: 0.9 });
      const seq = /\b[A-ZÁÉÍÓÚÑ][\p{L}'’-]+(?:\s+(?:de|del|de la|van|von|da|di)\s+|\s+)[A-ZÁÉÍÓÚÑ][\p{L}'’-]+(?:\s+[A-ZÁÉÍÓÚÑ][\p{L}'’-]+){0,2}/gu;
      while ((m = seq.exec(t)) !== null) {
        const toks = m[0].split(/\s+/); const f = fold(toks[0]);
        if (FIRST_NAMES.has(f)) out.push({ start: m.index, end: m.index + m[0].length, confidence: 0.86 });
      }
      return out;
    }
  };

  /** Palabras clave (plegadas) de nombre/descripción de etiqueta → reconocedores. */
  const KIND_KEYWORDS = [
    ['email', /\b(email|e-mail|correo)\b/], ['url', /\b(url|link|enlace|website|sitio web|pagina web)\b/], ['phone', /\b(phone|telefono|movil|tel\b)\b/],
    ['date', /\b(date|fecha|time|hora|period|periodo|when|cuando|deadline|plazo)\b/], ['money', /\b(money|monetary|price|precio|amount|importe|currency|moneda|salary|salario|cost|coste|euros?|dollars?)\b/],
    ['percent', /\b(percent|percentage|porcentaje|ratio|rate|tasa)\b/], ['sample', /\b(sample|muestra|respondents|participants|encuestados|participantes|sample size|tamano)\b/],
    ['theory', /\b(theory|theories|teoria|teorias|model|modelo|framework|marco teorico)\b/], ['method', /\b(method|methods|metodo|analysis|analisis|technique|tecnica|statistical|estadistic|algorithm|algoritmo)\b/],
    ['collection', /\b(questionnaire|cuestionario|survey|encuesta|interview|entrevista|instrument|instrumento|data collection|recogida|data source|fuente de datos|collected)\b/],
    ['technology', /\b(technology|technologies|tecnologia|tecnologias|software|app|tool|herramienta|platform|plataforma|system|sistema|product|producto|digital service|servicio digital)\b/],
    ['construct', /\b(construct|constructo|variable|concept|concepto|factor|dimension)\b/], ['context', /\b(setting|context|contexto|population|poblacion|sector|industry|industria|sample unit|unidad)\b/],
    ['org', /\b(organi[sz]ation|organizacion|company|empresa|institution|institucion|university|universidad|brand|marca|firm|agency|agencia|business|negocio|corporation)\b/],
    ['place', /\b(location|ubicacion|place|lugar|city|ciudad|country|pais|region|destination|destino|geograph|address|direccion|territory|territorio)\b/],
    ['person', /\b(person|persona|people|personas|name of|nombre de|author|autor|speaker|ponente|customer name|full name|nombre completo|individual|individuo)\b/]
  ];

  function kindsForLabel(name, desc) {
    const f = fold(name.replace(/[_\-]+/g, ' ') + ' . ' + (desc || ''));
    const kinds = [];
    KIND_KEYWORDS.forEach(([k, re]) => { if (re.test(f)) kinds.push(k); });
    // La descripción manda: si el NOMBRE de la etiqueta ya indica un tipo, ese tipo va primero y los demás son secundarios.
    const nameOnly = fold(name.replace(/[_\-]+/g, ' '));
    const primary = KIND_KEYWORDS.filter(([, re]) => re.test(nameOnly)).map(([k]) => k);
    const ordered = primary.concat(kinds.filter((k) => primary.indexOf(k) < 0));
    return { kinds: ordered, primary };
  }

  /** Ejemplos entre «such as … / como … / e.g. … / p. ej. … / (…)» en la descripción → gazetteer propio de la etiqueta. */
  function examplesFromDescription(desc) {
    const out = [];
    const d = String(desc || '');
    const pats = [/(?:such as|for example|e\.g\.?|including|tales como|como|por ejemplo|p\. ?ej\.?|incluyendo)\s+(.+?)(?=\.(?:\s|$)|;|:|$)/gis, /\(([^()]{2,120})\)/g];
    pats.forEach((re) => {
      let m;
      while ((m = re.exec(d)) !== null) {
        m[1].split(/,|;|\bor\b|\band\b|\by\b|\bo\b|\//i).forEach((raw) => {
          const t = raw.replace(/^[\s"'“”‘’«»]+|[\s"'“”‘’«».]+$/g, '').trim();
          if (t.length >= 2 && t.length <= 60 && !/^\d+$/.test(t)) out.push(t);
        });
      }
    });
    return Array.from(new Set(out));
  }

  /* ───────── Núcleo ───────── */

  function resolveOverlaps(cands) {
    const sorted = cands.slice().sort((a, b) => (a.start - b.start) || ((b.end - b.start) - (a.end - a.start)) || (b.confidence - a.confidence));
    const kept = [];
    sorted.forEach((c) => {
      const clash = kept.findIndex((k) => c.start < k.end && c.end > k.start);
      if (clash < 0) { kept.push(c); return; }
      const k = kept[clash];
      const lenC = c.end - c.start; const lenK = k.end - k.start;
      const sameSpan = c.start === k.start && c.end === k.end;
      if (sameSpan) { if (c.confidence > k.confidence) kept[clash] = c; return; }
      if (lenC > lenK || (lenC === lenK && c.confidence > k.confidence)) {
        // sustituye solo si no solapa con otro ya conservado
        kept.splice(clash, 1);
        if (!kept.some((x) => c.start < x.end && c.end > x.start)) kept.push(c);
        else kept.splice(clash, 0, k);
      }
    });
    return kept.sort((a, b) => a.start - b.start);
  }

  /**
   * @param text    texto a analizar
   * @param labels  {etiqueta: descripción}
   * @param opts    {threshold: 0–1 (por defecto 0.5)}
   */
  function extract(text, labels, opts) {
    const threshold = opts && Number.isFinite(opts.threshold) ? opts.threshold : 0.5;
    const names = Object.keys(labels);
    const notes = [];
    const cands = [];
    names.forEach((label) => {
      const desc = labels[label] || '';
      const { kinds, primary } = kindsForLabel(label, desc);
      const examples = examplesFromDescription(desc);
      let used = false;
      // 1) Ejemplos citados en la descripción: son la señal más específica (confianza alta).
      if (examples.length) {
        foldedGazetteer(text, examples, 0.93).forEach((m) => { cands.push({ label, start: m.start, end: m.end, confidence: m.confidence, via: 'ejemplo de la descripción' }); used = true; });
      }
      // 2) Reconocedores por tipo: los primarios (nombre de la etiqueta) puntúan completo; los secundarios (solo descripción) algo menos.
      const kindList = kinds.length ? kinds : [];
      kindList.forEach((k) => {
        const rec = RECOGNIZERS[k]; if (!rec) return;
        const secondary = primary.length > 0 && primary.indexOf(k) < 0;
        rec(text).forEach((m) => {
          cands.push({ label, start: m.start, end: m.end, confidence: Math.max(0.05, +(m.confidence * (secondary ? 0.85 : 1)).toFixed(3)), via: 'reconocedor «' + k + '»' });
          used = true;
        });
      });
      if (!kindList.length && !examples.length) notes.push('Etiqueta «' + label + '»: la simulación no reconoce su tipo ni encuentra ejemplos en la descripción; incluya ejemplos («como X, Y, Z») para que pueda localizarlos. El modelo GLiNER real sí generaliza.');
      else if (!used) notes.push('Etiqueta «' + label + '»: sin coincidencias.');
    });
    // Fuera las entidades bajo el umbral y las que no son literales del texto; luego resolver solapamientos.
    const valid = cands.filter((c) => c.confidence >= threshold && c.start >= 0 && c.end > c.start && c.end <= text.length);
    const entities = resolveOverlaps(valid).map((c) => ({ label: c.label, text: text.slice(c.start, c.end), start: c.start, end: c.end, confidence: c.confidence, source: 'simulación', via: c.via }))
      .filter((e) => e.text.trim().length > 0);
    return { engine: 'simulation', model: 'jevner-sim-1.0', entities, notes, threshold };
  }

  /**
   * Convierte desplazamientos en puntos de código (Python) a unidades UTF-16 (JavaScript) y verifica la literalidad.
   * Descarta cualquier entidad cuyo texto no coincida con text.slice(start, end).
   */
  function reconcileOffsets(text, entities) {
    const hasAstral = /[\uD800-\uDFFF]/.test(text);
    let cpToUnit = null;
    if (hasAstral) {
      cpToUnit = []; let u = 0;
      for (const ch of text) { cpToUnit.push(u); u += ch.length; }
      cpToUnit.push(u);
    }
    const kept = []; const dropped = [];
    entities.forEach((e) => {
      let s = e.start; let en = e.end;
      if (cpToUnit && s >= 0 && en < cpToUnit.length && s < cpToUnit.length) { s = cpToUnit[e.start]; en = cpToUnit[e.end]; }
      if (Number.isInteger(s) && Number.isInteger(en) && s >= 0 && s < en && en <= text.length && (e.text === undefined || text.slice(s, en) === e.text)) kept.push(Object.assign({}, e, { start: s, end: en, text: text.slice(s, en) }));
      else dropped.push(e);
    });
    return { entities: kept, dropped };
  }

  return { extract, reconcileOffsets, kindsForLabel, examplesFromDescription, G };
});
