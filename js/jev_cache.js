/* Caché de respuestas Jev: solo respuestas verificadas, nunca claves ni textos de entrada.
 * Las peticiones se identifican mediante SHA-256; las coincidencias son exactas. */
(function (root) {
  'use strict';
  const STORAGE_KEY = 'jev_classifications_v1';
  const TTL = 24 * 60 * 60 * 1000;
  const MAX_BYTES = 2 * 1024 * 1024;
  const MAX_ENTRIES = 500;
  const clone = value => JSON.parse(JSON.stringify(value));

  function create(options = {}) {
    const storage = options.storage;
    const crypto = options.crypto;
    const now = options.now || Date.now;
    const pending = new Map();
    let entries = new Map(); let persistent = !!storage; let generation = 0;
    try {
      const saved = JSON.parse(storage.getItem(STORAGE_KEY) || '[]');
      if (Array.isArray(saved)) {
        saved.slice(-MAX_ENTRIES).forEach(entry => {
          if (entry && /^[a-f0-9]{64}$/.test(entry.key) && Number.isFinite(entry.savedAt) && entry.savedAt <= now() && now() - entry.savedAt < TTL && entry.value && entry.value.data && entry.value.data.answers) entries.set(entry.key, entry);
        });
      }
    } catch (e) { persistent = false; }

    function prune() {
      for (const [key, entry] of entries) if (now() - entry.savedAt >= TTL) entries.delete(key);
    }
    function save() {
      prune();
      let encoded = JSON.stringify([...entries.values()]);
      while (entries.size > MAX_ENTRIES || encoded.length > MAX_BYTES / 2) {
        entries.delete(entries.keys().next().value);
        encoded = JSON.stringify([...entries.values()]);
      }
      try {
        storage.setItem(STORAGE_KEY, encoded);
        persistent = true;
      } catch (e) { persistent = false; }
    }
    async function keyFor(request, scope) {
      if (!crypto || !crypto.subtle) return null;
      const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, scope, request }));
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    }
    async function execute(request, scope, load, settings = {}) {
      let key;
      try { key = await keyFor(request, scope); } catch (e) { key = null; }
      if (!key) return { value: await load(), cached: false, savedAt: null };
      prune();
      const valid = settings.canStore || (() => true);
      const existing = entries.get(key);
      if (settings.enabled && existing && valid(existing.value)) return { value: clone(existing.value), cached: true, savedAt: existing.savedAt };
      if (settings.enabled && pending.has(key)) {
        const result = await pending.get(key);
        if (result.savedAt === null) return execute(request, scope, load, { ...settings, enabled: false });
        return { ...result, value: clone(result.value), cached: true };
      }
      const currentGeneration = generation;
      const task = (async () => {
        const value = await load();
        let savedAt = null;
        if (valid(value) && generation === currentGeneration) {
          savedAt = now();
          entries.delete(key);
          entries.set(key, { key, savedAt, value: clone(value) });
          save();
        }
        return { value, cached: false, savedAt };
      })();
      if (settings.enabled) pending.set(key, task);
      try { return await task; } finally { if (settings.enabled) pending.delete(key); }
    }
    return {
      execute,
      clear() {
        generation++; entries.clear();
        try { storage.removeItem(STORAGE_KEY); } catch (e) { /* Session memory is still cleared. */ }
      },
      status() { prune(); return { count: entries.size, persistent, available: !!(crypto && crypto.subtle) }; }
    };
  }
  root.JEVCache = { create };
})(typeof window === 'undefined' ? globalThis : window);
