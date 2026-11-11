'use strict';
// Viewer log di sistema: legge GET /api/logs, righe colorate per livello, filtro,
// svuota, auto-refresh. Gli errori meteo/luna e degli apply compaiono qui.

(function () {
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

  var FILTERS = [
    { key: '', label: 'Tutti' },
    { key: 'info', label: 'Info+' },
    { key: 'warn', label: 'Warn+' },
    { key: 'error', label: 'Solo errori' }
  ];
  var active = '';
  var timer = null;

  // stile per livello: [classe riga, classe badge, testo badge]
  var STYLE = {
    debug: ['', 'bg-gray-200 text-gray-600 dark:bg-ocean-700 dark:text-gray-300', 'DBG'],
    info:  ['', 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300', 'INFO'],
    warn:  ['bg-amber-50 dark:bg-amber-900/10', 'bg-amber-200 text-amber-800 dark:bg-amber-800/50 dark:text-amber-200', 'WARN'],
    error: ['bg-red-50 dark:bg-red-900/10', 'bg-red-200 text-red-800 dark:bg-red-800/50 dark:text-red-200', 'ERR']
  };

  function hhmmss(ts) { try { return new Date(ts).toTimeString().slice(0, 8); } catch (e) { return ''; } }

  function render(logs) {
    var list = $('log-list'); list.innerHTML = '';
    if (!logs.length) { $('log-empty').classList.remove('hidden'); return; }
    $('log-empty').classList.add('hidden');
    // più recenti in cima
    logs.slice().reverse().forEach(function (e) {
      var st = STYLE[e.level] || STYLE.info;
      var row = el('div', 'px-3 py-2 flex gap-2 items-start ' + st[0]);
      row.appendChild(el('span', 'text-gray-400 shrink-0', hhmmss(e.ts)));
      row.appendChild(el('span', 'shrink-0 px-1.5 rounded text-[10px] font-bold self-center ' + st[1], st[2]));
      row.appendChild(el('span', 'shrink-0 text-purple-500 dark:text-purple-300', esc(e.tag)));
      var body = el('div', 'flex-1 min-w-0');
      body.appendChild(el('div', 'text-gray-700 dark:text-gray-200 break-words', esc(e.msg)));
      if (e.data) body.appendChild(el('div', 'text-gray-400 break-all', esc(e.data)));
      row.appendChild(body);
      list.appendChild(row);
    });
  }

  function load() {
    var q = active ? ('?level=' + active) : '';
    fetch('/api/logs' + q).then(function (r) { return r.json(); }).then(function (d) { render(d.logs || []); }).catch(function () {});
  }

  function renderFilters() {
    var box = $('log-filters'); box.innerHTML = '';
    FILTERS.forEach(function (f) {
      var b = el('button', 'px-3 py-1 rounded-lg border ' +
        (f.key === active ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 font-semibold'
                          : 'border-gray-200 dark:border-ocean-600 text-gray-500 hover:bg-gray-50 dark:hover:bg-ocean-700'), f.label);
      b.onclick = function () { active = f.key; renderFilters(); load(); };
      box.appendChild(b);
    });
  }

  function boot() {
    renderFilters(); load();
    $('log-clear').onclick = function () {
      fetch('/api/logs/clear', { method: 'POST' }).then(function () { load(); });
    };
    $('log-auto').onchange = function () {
      if (this.checked) { timer = setInterval(load, 4000); } else { clearInterval(timer); timer = null; }
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
