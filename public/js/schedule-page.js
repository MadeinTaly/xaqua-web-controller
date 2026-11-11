'use strict';
// Pagina Schedule: colla tra <day-rhythm> (libreria dayrhythm) e il server xaqua.
// Ogni slot ha un ASSET = colore fisso (tabelle dell'app originale), che non dipende dall'ora.
// Il bottone Applica e' della pagina: change -> dirty, click -> POST /api/schedule/compose.
(function () {
  var SM = window.__SM__ || {};
  var PROFILES = SM.profiles || {};
  var ASSETS = SM.models || [];
  var el = document.getElementById('sm-timeline');
  var $ = function (id) { return document.getElementById(id); };
  var state = { depth: 'SemiDeep', dirty: false, lastApply: null };

  var assetOf = function (id) { return ASSETS.filter(function (a) { return a.id === id; })[0]; };
  var toSlot = function (t, mid, id, label) { return { id: id, time: t, model: mid, label: label || undefined }; };

  // ---- colore anteprima: tabella della profondita' x cella fissa dell'asset ----
  function previewCss(_v, model) {
    var a = assetOf(model.id);
    if (!a || a.off) return '#1a1a1a';
    var prof = PROFILES[state.depth] || PROFILES.SemiDeep;
    var c = prof && prof.schedule[a.band] && prof.schedule[a.band][a.condition];
    if (!c) return '#1a1a1a';
    var P = c.P / 100, am = c.A / 100, b = c.B / 100, w = c.W / 100;
    var ch = function (v) { return Math.min(255, v * P) | 0; };
    return 'rgb(' + ch(am * 255 + w * 255) + ',' + ch(am * 150 + w * 255 + b * 60) + ',' + ch(b * 255 + w * 255) + ')';
  }

  var models = ASSETS.map(function (a) { return { id: a.id, label: a.label, icon: a.emoji, off: !!a.off, preview: previewCss }; });
  var json = function (url, init) { return fetch(url, init).then(function (r) { return r.json(); }); };
  var post = function (url, body) { return json(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); };

  // ---- conversioni fasce/selection <-> slot ----
  var fasciaLabel = {}; (SM.fasce || []).forEach(function (f) { fasciaLabel[f.key] = f.label; });
  function selToSlots(sel) { return sel.map(function (s, i) { return toSlot(s.time, s.modelId, s.fascia || 's' + i, fasciaLabel[s.fascia]); }); }
  var toSelection = function () { return el.getValue().map(function (s) { return { fascia: s.id, modelId: s.model, time: s.time }; }); };
  var presetSlots = function (p) { return function () { return (SM.fasce || []).filter(function (f) { return p.sel[f.key]; }).map(function (f) {
    return toSlot((p.times && p.times[f.key]) || f.defTime, p.sel[f.key], f.key, f.label); }); }; };
  var tropical = function (variant) { return function () { return json('/api/schedule/tropical/' + variant).then(function (d) {
    if (!d.ok || !Array.isArray(d.selection)) throw new Error(d.error || 'errore'); return selToSlots(d.selection); }); }; };
  var toDay = function (d) { return { id: d.id, name: d.name, slots: d.fasce.map(function (f, i) { return toSlot(f.time, f.modelId, 'd' + i, f.label); }) }; };
  var storage = {
    list: function () { return json('/api/schedule/daypresets').then(function (d) { return (d.presets || []).map(toDay); }); },
    save: function (day) {
      var fasce = day.slots.map(function (s) { return { label: s.label || '', time: s.time, modelId: s.model }; });
      return post('/api/schedule/daypresets', { name: day.name, fasce: fasce }).then(function (d) {
        if (!d.ok) throw new Error(d.error || 'Errore'); return { id: d.id, name: day.name, slots: day.slots }; });
    },
    remove: function (id) { return json('/api/schedule/daypresets/' + encodeURIComponent(id), { method: 'DELETE' }); }
  };

  el.config = {
    locale: 'it', theme: 'organic', timeFormat: '24h', minSlots: 2, snap: 5, minGap: 30, credits: 'minimal',
    messages: { nowLabel: 'Ora lampada', title: 'Il ritmo della luce', presetsLabel: 'Preset', daysLabel: 'Le mie giornate' },
    models: models, storage: storage,
    presets: (SM.presets || []).map(function (p) { return { id: p.id, label: p.name, icon: p.emoji, group: 'Preset', slots: presetSlots(p) }; })
      .concat([{ id: 'tropical-reef', label: 'Tropicale', icon: '🏝️', group: 'Preset', slots: tropical('reef') },
               { id: 'tropical-atoll', label: 'Atollo', icon: '🏖️', group: 'Preset', slots: tropical('atoll') }])
  };

  // Ogni preset porta la sua profondita' (come i 3 preset dell'app originale).
  el.addEventListener('dayselect', function (e) {
    if (e.detail.kind !== 'preset') return;
    var p = (SM.presets || []).filter(function (x) { return x.id === e.detail.id; })[0];
    if (p && p.depth) { state.depth = p.depth; el.setValue(el.getValue()); }
  });
  el.addEventListener('change', function () { setDirty(true); });
  el.addEventListener('error', function (e) { $('sm-status').textContent = '✕ ' + ((e.detail.error && e.detail.error.message) || e.detail.source); });

  // ---- apply bar ----
  var hhmmss = function (iso) { var d = new Date(iso); return [d.getHours(), d.getMinutes(), d.getSeconds()].map(function (n) { return (n < 10 ? '0' : '') + n; }).join(':'); };
  function updateApplyStatus() {
    var b = $('sm-apply-status'), la = state.lastApply, text = '';
    $('sm-dirty').classList.toggle('hidden', !state.dirty);
    if (la) {
      text = la.ok ? '✓ Ultimo invio: ' + hhmmss(la.at) + ' · ' + la.steps + ' step' : '✕ Ultimo invio FALLITO: ' + hhmmss(la.at);
      if (state.dirty) text += ' · modifiche non applicate';
      b.className = 'text-xs ' + (la.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400');
    }
    b.textContent = text;
  }
  function setDirty(v) { state.dirty = v; updateApplyStatus(); }
  $('sm-apply').onclick = function () {
    var btn = $('sm-apply'), st = $('sm-status'); btn.disabled = true; st.textContent = 'Invio...';
    post('/api/schedule/compose', { selection: toSelection(), depth: state.depth }).then(function (d) {
      btn.disabled = false;
      if (!d.ok) { st.textContent = '✕ ' + (d.error || 'errore'); return; }
      st.textContent = '✓ Applicato — ' + d.steps + ' step';
      state.lastApply = { at: new Date().toISOString(), source: 'compose', steps: d.steps, ok: true };
      setDirty(false);
    }).catch(function (e) { btn.disabled = false; st.textContent = '✕ ' + e.message; });
  };

  // ---- avvio ----
  var init = function () { return SM.presets && SM.presets[0] ? presetSlots(SM.presets[0])() : []; };
  el.value = init();
  json('/api/schedule/reels').then(function (d) {
    if (d && Array.isArray(d.selection) && d.selection.length) { if (d.depth && PROFILES[d.depth]) state.depth = d.depth; el.setValue(selToSlots(d.selection)); }
    state.lastApply = (d && d.lastApply) || null; updateApplyStatus();
  }).catch(function () {});
  // Orologio dalla cache del server (/api/home): nessuna chiamata al firmware all'apertura.
  json('/api/home').then(function (d) {
    var raw = d && d.time; if (raw) el.syncClock((String(raw).split(' - ')[1] || String(raw)).trim());
  }).catch(function () {});
})();
