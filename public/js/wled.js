'use strict';
/* WLED page — modello CCT bianco/blu (0-100). Niente RGB.
 * showToast() globale (main.js). Event delegation, niente onclick inline.
 */
(function () {
  var devices = [];
  var discovered = [];
  var schedDeviceId = null;
  var schedSlots = [];
  var applyTimers = {};

  function $(id) { return document.getElementById(id); }
  function toast(m, t) { if (typeof showToast === 'function') showToast(m, t || 'info'); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function timeToMin(t) { var p = (t || '0:0').split(':'); return parseInt(p[0], 10) * 60 + parseInt(p[1], 10); }

  // ---- Lista dispositivi ----
  async function loadDevices() {
    try {
      var d = await fetch('/api/wled/devices').then(function (r) { return r.json(); });
      devices = d.devices || [];
      await attachNext();
      renderDevices();
    } catch (e) { toast('Errore caricamento', 'error'); }
  }
  async function attachNext() {
    await Promise.all(devices.map(async function (dev) {
      try {
        var n = await fetch('/api/wled/' + dev.id + '/next').then(function (r) { return r.json(); });
        dev._next = n.next || null;
      } catch (e) { dev._next = null; }
    }));
  }

  function renderDevices() {
    var c = $('wled-devices');
    if (!devices.length) {
      c.innerHTML = '<div class="card text-center text-gray-400 py-10">'
        + '<svg class="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>'
        + '<p class="text-sm">Nessun dispositivo WLED configurato</p>'
        + '<p class="text-xs mt-1 opacity-70">Aggiungi un dispositivo col pulsante in alto</p></div>';
      return;
    }
    c.innerHTML = devices.map(function (d) {
      var online = !!d.online;
      var badge = online
        ? '<span class="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>Online</span>'
        : '<span class="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"><span class="w-1.5 h-1.5 rounded-full bg-red-500"></span>Offline</span>';
      var nextTxt = d._next ? (d._next.time + ' · ' + (d._next.on ? ('B' + (d._next.white || 0) + ' / Blu' + (d._next.blue || 0)) : 'spento')) : 'nessuno';
      var details;
      if (online) {
        var w = d.white || 0, b = d.blue || 0;
        details = ''
          + '<div class="flex items-center justify-between mb-3">'
          + '  <span class="text-xs text-gray-400">Prossimo: ' + esc(nextTxt) + '</span>'
          + '  <label class="relative inline-flex items-center cursor-pointer"><input type="checkbox" class="sr-only peer wl-power" data-id="' + d.id + '"' + (d.on ? ' checked' : '') + '>'
          + '    <div class="w-11 h-6 bg-gray-300 dark:bg-ocean-700 rounded-full peer peer-checked:after:translate-x-full after:content-[\'\'] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div></label>'
          + '</div>'
          + sliderRow('Bianco', 'wl-white', d.id, w, 'amber')
          + sliderRow('Blu', 'wl-blue', d.id, b, 'blue')
          + sliderRow('Potenza', 'wl-brightness', d.id, 100, 'gray')
          + '<div class="grid grid-cols-2 gap-2 mt-3">'
          + '  <button class="wl-apply btn-primary text-sm" data-id="' + d.id + '">Applica</button>'
          + '  <button class="wl-sched btn-secondary text-sm" data-id="' + d.id + '">Schedule</button>'
          + '</div>'
          + '<div class="text-xs text-gray-400 mt-3">v' + esc(d.version || '?') + ' · ' + (d.ledCount || '?') + ' LED · ' + esc(d.ip) + '</div>';
      } else {
        details = '<p class="text-sm text-red-500 my-3">' + esc(d.error || 'Non raggiungibile') + '</p><p class="text-xs text-gray-400">Prossimo: ' + esc(nextTxt) + ' · ' + esc(d.ip || '') + '</p>';
      }
      return '<div class="card"><div class="flex items-start justify-between mb-4"><div>'
        + '<h3 class="font-bold text-base">' + esc(d.name || d.deviceName || 'WLED') + '</h3>'
        + '<p class="text-xs text-gray-400 mt-0.5">CCT Bianco/Blu</p></div>'
        + '<div class="flex items-center gap-2">' + badge
        + '<button class="wl-del text-xs px-2 py-1 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600" data-id="' + d.id + '">🗑</button></div></div>'
        + details + '</div>';
    }).join('');
  }

  function sliderRow(label, cls, id, val, color) {
    var tint = color === 'blue' ? 'text-blue-400' : 'text-amber-500';
    return '<div class="mb-2"><div class="flex justify-between text-xs mb-1"><span class="' + tint + ' font-medium">' + label + '</span>'
      + '<span class="wl-val text-gray-500">' + val + '%</span></div>'
      + '<input type="range" min="0" max="100" value="' + val + '" class="' + cls + ' w-full" data-id="' + id + '"></div>';
  }

  function deviceWB(id) {
    var wEl = document.querySelector('input.wl-white[data-id="' + id + '"]');
    var bEl = document.querySelector('input.wl-blue[data-id="' + id + '"]');
    var brEl = document.querySelector('input.wl-brightness[data-id="' + id + '"]');
    return { white: wEl ? parseInt(wEl.value, 10) : 0, blue: bEl ? parseInt(bEl.value, 10) : 0, brightness: brEl ? parseInt(brEl.value, 10) : 100 };
  }

  async function applyDevice(id, on) {
    var wb = deviceWB(id);
    var body = { white: wb.white, blue: wb.blue };
    if (on !== undefined) body.on = on;
    try {
      var d = await fetch('/api/wled/' + id + '/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); });
      if (!d.ok) toast(d.error || 'Errore', 'error');
    } catch (e) { toast('Errore', 'error'); }
  }
  async function togglePower(id, on) {
    try {
      await fetch('/api/wled/' + id + '/power', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: on }) });
      toast(on ? 'Acceso' : 'Spento', 'success');
    } catch (e) { toast('Errore', 'error'); }
  }
  async function deleteDevice(id) {
    if (!confirm('Eliminare questo dispositivo?')) return;
    try {
      var d = await fetch('/api/wled/devices/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) }).then(function (r) { return r.json(); });
      if (d.ok) { toast('Eliminato', 'success'); loadDevices(); } else toast(d.error || 'Errore', 'error');
    } catch (e) { toast('Errore', 'error'); }
  }

  // ---- Add modal + discovery ----
  function openAdd() {
    $('add-name').value = ''; $('add-ip').value = '';
    $('add-status').classList.add('hidden');
    $('discover-results').innerHTML = '';
    $('discover-status').textContent = 'Scansiona la rete per WLED non ancora configurati.';
    $('add-modal').classList.remove('hidden');
  }
  function closeAdd() { $('add-modal').classList.add('hidden'); }
  async function runDiscovery() {
    var btn = $('discover-btn'), st = $('discover-status'), res = $('discover-results');
    btn.disabled = true; btn.textContent = 'Scansione...';
    st.textContent = 'Scansione in corso (10-30s)...'; st.className = 'text-xs text-blue-600 dark:text-blue-300'; res.innerHTML = '';
    try {
      var d = await fetch('/api/wled/discover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }).then(function (r) { return r.json(); });
      if (!d.ok) { st.textContent = d.error || 'Discovery fallita'; st.className = 'text-xs text-red-500'; return; }
      discovered = d.found || [];
      var skipped = d.skippedExisting || 0;
      if (!discovered.length) { st.textContent = skipped ? ('Nessun nuovo (' + skipped + ' già configurati)') : 'Nessun WLED trovato'; st.className = 'text-xs text-gray-500'; return; }
      st.textContent = 'Trovati ' + discovered.length + (skipped ? ' (' + skipped + ' già configurati)' : ''); st.className = 'text-xs text-emerald-600';
      res.innerHTML = discovered.map(function (dev, i) {
        return '<button class="disc-pick w-full text-left p-2 rounded-lg bg-white dark:bg-ocean-800 hover:ring-2 hover:ring-blue-400 text-sm" data-i="' + i + '">'
          + '<div class="flex justify-between items-center"><div><div class="font-medium">' + esc(dev.name) + '</div>'
          + '<div class="text-xs text-gray-400">' + esc(dev.ip) + ' · v' + esc(dev.version || '?') + (dev.ledCount ? ' · ' + dev.ledCount + ' LED' : '') + '</div></div>'
          + '<span class="text-xs text-blue-500">Aggiungi →</span></div></button>';
      }).join('');
    } catch (e) { st.textContent = 'Errore: ' + e.message; st.className = 'text-xs text-red-500'; }
    finally { btn.disabled = false; btn.textContent = 'Cerca in rete'; }
  }
  function pickDiscovered(i) {
    var dev = discovered[i]; if (!dev) return;
    $('add-name').value = dev.name || 'WLED';
    $('add-ip').value = dev.ip;
    var s = $('add-status'); s.classList.remove('hidden'); s.className = 'text-xs mt-3 text-emerald-500';
    s.textContent = 'Selezionato ' + dev.name + ' (' + dev.ip + ') — premi Salva';
  }
  async function testNew() {
    var ip = $('add-ip').value.trim(); var s = $('add-status');
    s.classList.remove('hidden'); s.className = 'text-xs mt-3 text-gray-400'; s.textContent = 'Verifico ' + ip + '...';
    try {
      var d = await fetch('/api/wled/devices/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ip: ip }) }).then(function (r) { return r.json(); });
      if (d.ok) { s.className = 'text-xs mt-3 text-emerald-500'; s.textContent = 'OK — ' + (d.name || 'WLED') + ' v' + (d.version || '?') + ' (' + (d.ledCount || 0) + ' LED)'; }
      else { s.className = 'text-xs mt-3 text-red-500'; s.textContent = d.error || 'Connessione fallita'; }
    } catch (e) { s.className = 'text-xs mt-3 text-red-500'; s.textContent = 'Errore: ' + e.message; }
  }
  async function saveNew() {
    var name = $('add-name').value.trim(), ip = $('add-ip').value.trim();
    if (!name || !ip) { toast('Compila nome e IP', 'error'); return; }
    try {
      var d = await fetch('/api/wled/devices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, ip: ip, type: 'cct' }) }).then(function (r) { return r.json(); });
      if (d.ok) { toast('Dispositivo aggiunto', 'success'); closeAdd(); loadDevices(); } else toast(d.error || 'Errore', 'error');
    } catch (e) { toast('Errore', 'error'); }
  }

  // ---- Schedule editor ----
  async function openSched(id) {
    schedDeviceId = id;
    try {
      var d = await fetch('/api/wled/' + id + '/schedule').then(function (r) { return r.json(); });
      schedSlots = (d.slots || []).slice();
      if (!schedSlots.length) {
        schedSlots = [
          { time: '08:00', on: true, white: 90, blue: 30, brightness: 100 },
          { time: '14:00', on: true, white: 60, blue: 60, brightness: 100 },
          { time: '20:00', on: true, white: 20, blue: 50, brightness: 100 },
          { time: '23:00', on: false, white: 0, blue: 0, brightness: 100 }
        ];
      } else {
        schedSlots = schedSlots.map(function (s) {
          return { time: s.time, on: s.on, white: s.white, blue: s.blue, brightness: s.brightness !== undefined ? s.brightness : 100 };
        });
      }
      renderSched();
      $('schedule-modal').classList.remove('hidden');
    } catch (e) { toast('Errore caricamento schedule', 'error'); }
  }
  function closeSched() { $('schedule-modal').classList.add('hidden'); schedDeviceId = null; schedSlots = []; }
  function renderSched() {
    schedSlots.sort(function (a, b) { return timeToMin(a.time) - timeToMin(b.time); });
    $('schedule-slots').innerHTML = schedSlots.map(function (s, i) {
      return '<div class="border border-gray-200 dark:border-ocean-700 rounded-xl p-3 mb-2 bg-white dark:bg-ocean-900">'
        + '<div class="flex items-center gap-2 mb-2">'
        + '<input type="time" value="' + s.time + '" class="sc-time input flex-1 py-2" data-i="' + i + '">'
        + '<label class="inline-flex items-center gap-1 text-xs"><input type="checkbox" class="sc-on" data-i="' + i + '"' + (s.on ? ' checked' : '') + '> ON</label>'
        + '<button class="sc-del text-xs px-2 py-1 rounded bg-red-50 dark:bg-red-900/30 text-red-600" data-i="' + i + '">🗑</button>'
        + '</div>'
        + '<div class="grid grid-cols-3 gap-2 text-xs">'
        + '<div><div class="flex justify-between mb-1"><span class="text-amber-500">Bianco</span><span class="sc-wv">' + (s.white || 0) + '%</span></div><input type="range" min="0" max="100" value="' + (s.white || 0) + '" class="sc-white w-full" data-i="' + i + '"></div>'
        + '<div><div class="flex justify-between mb-1"><span class="text-blue-400">Blu</span><span class="sc-bv">' + (s.blue || 0) + '%</span></div><input type="range" min="0" max="100" value="' + (s.blue || 0) + '" class="sc-blue w-full" data-i="' + i + '"></div>'
        + '<div><div class="flex justify-between mb-1"><span class="text-gray-500">Potenza</span><span class="sc-brv">' + (s.brightness || 100) + '%</span></div><input type="range" min="0" max="100" value="' + (s.brightness || 100) + '" class="sc-brightness w-full" data-i="' + i + '"></div>'
        + '</div></div>';
    }).join('');
  }
  function addSchedSlot() {
    var last = schedSlots[schedSlots.length - 1] || { white: 50, blue: 50, brightness: 100 };
    schedSlots.push({ time: '12:00', on: true, white: last.white || 50, blue: last.blue || 50, brightness: last.brightness || 100 });
    renderSched();
  }
  async function saveSched() {
    if (!schedDeviceId) return;
    try {
      var d = await fetch('/api/wled/' + schedDeviceId + '/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slots: schedSlots }) }).then(function (r) { return r.json(); });
      if (d.ok) { toast('Schedule salvato', 'success'); closeSched(); loadDevices(); } else toast(d.error || 'Errore', 'error');
    } catch (e) { toast('Errore', 'error'); }
  }

  // ---- Wiring (event delegation) ----
  function init() {
    $('btn-add').addEventListener('click', openAdd);
    $('add-close').addEventListener('click', closeAdd);
    $('add-test').addEventListener('click', testNew);
    $('add-save').addEventListener('click', saveNew);
    $('discover-btn').addEventListener('click', runDiscovery);
    $('sched-close').addEventListener('click', closeSched);
    $('sched-cancel').addEventListener('click', closeSched);
    $('sched-add').addEventListener('click', addSchedSlot);
    $('sched-save').addEventListener('click', saveSched);

    $('discover-results').addEventListener('click', function (e) { var b = e.target.closest('.disc-pick'); if (b) pickDiscovered(+b.getAttribute('data-i')); });

    $('wled-devices').addEventListener('input', function (e) {
      var t = e.target;
      if (t.classList.contains('wl-white') || t.classList.contains('wl-blue') || t.classList.contains('wl-brightness')) {
        t.parentElement.querySelector('.wl-val').textContent = t.value + '%';
        var id = t.getAttribute('data-id');
        if (applyTimers[id]) clearTimeout(applyTimers[id]);
        applyTimers[id] = setTimeout(function () { applyDevice(id); }, 250);
      }
    });
    $('wled-devices').addEventListener('change', function (e) {
      var t = e.target;
      if (t.classList.contains('wl-power')) togglePower(t.getAttribute('data-id'), t.checked);
    });
    $('wled-devices').addEventListener('click', function (e) {
      var ap = e.target.closest('.wl-apply'); if (ap) { applyDevice(ap.getAttribute('data-id')); toast('Applicato', 'success'); return; }
      var sc = e.target.closest('.wl-sched'); if (sc) { openSched(sc.getAttribute('data-id')); return; }
      var dl = e.target.closest('.wl-del'); if (dl) { deleteDevice(dl.getAttribute('data-id')); return; }
    });

    $('schedule-slots').addEventListener('input', function (e) {
      var t = e.target, i = +t.getAttribute('data-i');
      if (isNaN(i) || !schedSlots[i]) return;
      if (t.classList.contains('sc-white')) { schedSlots[i].white = +t.value; t.parentElement.querySelector('.sc-wv').textContent = t.value + '%'; }
      else if (t.classList.contains('sc-blue')) { schedSlots[i].blue = +t.value; t.parentElement.querySelector('.sc-bv').textContent = t.value + '%'; }
      else if (t.classList.contains('sc-brightness')) { schedSlots[i].brightness = +t.value; t.parentElement.querySelector('.sc-brv').textContent = t.value + '%'; }
      else if (t.classList.contains('sc-time')) { schedSlots[i].time = t.value; }
    });
    $('schedule-slots').addEventListener('change', function (e) {
      var t = e.target, i = +t.getAttribute('data-i');
      if (isNaN(i) || !schedSlots[i]) return;
      if (t.classList.contains('sc-on')) schedSlots[i].on = t.checked;
    });
    $('schedule-slots').addEventListener('click', function (e) {
      var d = e.target.closest('.sc-del'); if (!d) return;
      var i = +d.getAttribute('data-i');
      if (schedSlots.length <= 2) { toast('Minimo 2 slot', 'error'); return; }
      schedSlots.splice(i, 1); renderSched();
    });

    loadDevices();
    setInterval(loadDevices, 20000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
