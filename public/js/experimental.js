'use strict';
// Sezione Experimental: cicli pluri-settimanali. Per ora "Acclimatazione coralli":
// ramp intensità su settimane. Si attiva e lavora da solo (tick giornaliero server).
// Il pallino sotto il nome imposta/riprende il giorno di trattamento.

(function () {
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(str) { var d = el('div'); d.textContent = str; return d.innerHTML; }

  var st = null;     // summary acclimatazione
  var tt = null;     // summary trattamento
  var dayEdit = false;
  var treatmentDayEdit = false;

  function load() {
    fetch('/api/experimental').then(function (r) { return r.json(); }).then(function (d) { st = d.acclimation; tt = d.treatment; render(); }).catch(function () {});
  }
  function save(body) {
    return fetch('/api/experimental/acclimation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); }).then(function (d) { if (d.summary) st = d.summary; return d; });
  }
  function saveTreatment(body) {
    return fetch('/api/experimental/treatment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); }).then(function (d) { if (d.summary) tt = d.summary; return d; });
  }

  function render() {
    var box = $('exp-cycles'); box.innerHTML = '';
    if (!st) return;

    // Card acclimatazione
    renderAcclimation(box);

    // Card trattamento alghe
    if (tt) renderTreatment(box);
  }

  function renderAcclimation(box) {
    var card = el('div', 'card mb-4');

    // header: nome + toggle attivo
    var head = el('div', 'flex items-start justify-between gap-3');
    var titleWrap = el('div', '');
    titleWrap.appendChild(el('div', 'font-semibold flex items-center gap-2', '<span class="text-lg">🪸</span> Acclimatazione coralli'));

    // pallino giorno (sotto il nome, vicino ad Applica): click -> imposta/riprende il giorno
    var dot = el('button', 'mt-1 inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full border ' +
      (st.active ? 'border-emerald-400 text-emerald-600 dark:text-emerald-300' : 'border-gray-300 dark:border-ocean-600 text-gray-500'));
    var dotColor = st.active ? 'bg-emerald-500' : 'bg-gray-400';
    dot.innerHTML = '<span class="w-2.5 h-2.5 rounded-full ' + dotColor + '"></span> Giorno ' + st.currentDay + ' / ' + st.totalDays + ' · ' + st.factorPct + '%';
    dot.onclick = function () { dayEdit = !dayEdit; render(); };
    titleWrap.appendChild(dot);

    // editor giorno inline
    if (dayEdit) {
      var ed = el('div', 'mt-2 flex items-center gap-2');
      var inp = el('input', 'input w-24 py-1 text-sm'); inp.type = 'number'; inp.min = '1'; inp.max = String(st.totalDays); inp.value = String(st.currentDay);
      var ok = el('button', 'btn-secondary py-1 px-3 text-sm', 'Imposta');
      ok.onclick = function () { var d = Math.max(1, Math.min(st.totalDays, parseInt(inp.value, 10) || 1)); save({ day: d }).then(function () { dayEdit = false; render(); }); };
      ed.appendChild(el('span', 'text-xs text-gray-500', 'Riprendi al giorno')); ed.appendChild(inp); ed.appendChild(ok);
      titleWrap.appendChild(ed);
    }
    head.appendChild(titleWrap);

    var toggle = el('label', 'relative inline-flex items-center cursor-pointer shrink-0');
    var chk = el('input', 'sr-only peer'); chk.type = 'checkbox'; chk.checked = st.active;
    chk.onchange = function () { save({ active: chk.checked }).then(render); };
    toggle.appendChild(chk);
    toggle.appendChild(el('div', "w-11 h-6 bg-gray-200 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"));
    head.appendChild(toggle);
    card.appendChild(head);

    card.appendChild(el('div', 'text-xs text-gray-500 mt-2 mb-3', 'Nuovo impianto: l\'intensità (Power) parte ridotta e sale fino al 100% nell\'arco del trattamento, per non stressare i coralli. Si applica sopra la giornata composta in Schedule.'));

    // barra ramp
    var bar = el('div', 'h-2 rounded-full bg-gray-100 dark:bg-ocean-900 overflow-hidden mb-3');
    var fill = el('div', 'h-full bg-gradient-to-r from-amber-400 to-emerald-500'); fill.style.width = st.factorPct + '%';
    bar.appendChild(fill); card.appendChild(bar);

    // controlli: durata + intensità iniziale
    var grid = el('div', 'grid grid-cols-2 gap-3 mb-3');
    var wWrap = el('div', '');
    wWrap.appendChild(el('label', 'label', 'Durata (settimane)'));
    var wsel = el('select', 'input py-2');
    [2, 3, 4, 6, 8, 10, 12].forEach(function (w) { wsel.innerHTML += '<option value="' + w + '"' + (w === st.weeks ? ' selected' : '') + '>' + w + '</option>'; });
    wsel.onchange = function () { save({ weeks: parseInt(wsel.value, 10) }).then(render); };
    wWrap.appendChild(wsel); grid.appendChild(wWrap);

    var pWrap = el('div', '');
    pWrap.appendChild(el('label', 'label', 'Intensità iniziale: <span id="exp-pct">' + st.startPct + '%</span>'));
    var rng = el('input', 'w-full accent-emerald-600'); rng.type = 'range'; rng.min = '5'; rng.max = '100'; rng.step = '5'; rng.value = String(st.startPct);
    rng.oninput = function () { var s = $('exp-pct'); if (s) s.textContent = rng.value + '%'; };
    rng.onchange = function () { save({ startPct: parseInt(rng.value, 10) }).then(render); };
    pWrap.appendChild(rng); grid.appendChild(pWrap);
    card.appendChild(grid);

    // applica ora
    var applyBtn = el('button', 'btn-primary w-full', 'Applica ora alla lampada');
    var status = el('div', 'text-xs text-gray-400 mt-2 text-center', '');
    applyBtn.onclick = function () {
      applyBtn.disabled = true; status.textContent = 'Invio...';
      save({ active: true, apply: true }).then(function (d) {
        applyBtn.disabled = false;
        if (d.applied) status.textContent = '✓ Applicato al ' + st.factorPct + '% (' + d.applied.steps + ' step) — giorno ' + st.currentDay + '/' + st.totalDays;
        else status.textContent = '✕ ' + (d.error || 'errore');
        render();
      }).catch(function (e) { applyBtn.disabled = false; status.textContent = '✕ ' + e.message; });
    };
    card.appendChild(applyBtn); card.appendChild(status);

    box.appendChild(card);
  }

  function renderTreatment(box) {
    var card = el('div', 'card mb-4');

    // header: nome + tipo select
    var head = el('div', 'flex items-start justify-between gap-3');
    var titleWrap = el('div', '');
    titleWrap.appendChild(el('div', 'font-semibold flex items-center gap-2', '<span class="text-lg">🦠</span> Trattamento alghe'));

    // select tipo (disabilitato se ciclo attivo)
    var typeSelect = el('select', 'input py-2 text-sm mt-1');
    typeSelect.innerHTML = '<option value="cyano">🦠 Cianobatteri (3gg blackout + 4gg recovery)</option>' +
      '<option value="dino">🟤 Dinoflagellati (3gg blackout + 7gg recovery)</option>';
    typeSelect.value = tt.type || 'cyano';
    typeSelect.disabled = tt.active;
    typeSelect.onchange = function () { saveTreatment({ type: typeSelect.value }).then(render); };
    titleWrap.appendChild(typeSelect);

    // pallino giorno (sotto il nome, vicino ad Applica): click -> imposta/riprende il giorno
    var dot = el('button', 'mt-1 inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full border ' +
      (tt.active ? 'border-violet-400 text-violet-600 dark:text-violet-300' : 'border-gray-300 dark:border-ocean-600 text-gray-500'));
    var dotColor = tt.active ? 'bg-violet-500' : 'bg-gray-400';
    dot.innerHTML = '<span class="w-2.5 h-2.5 rounded-full ' + dotColor + '"></span> Giorno ' + tt.currentDay + ' / ' + tt.totalDays;
    dot.onclick = function () { treatmentDayEdit = !treatmentDayEdit; render(); };
    titleWrap.appendChild(dot);

    // editor giorno inline
    if (treatmentDayEdit) {
      var ed = el('div', 'mt-2 flex items-center gap-2');
      var inp = el('input', 'input w-24 py-1 text-sm'); inp.type = 'number'; inp.min = '1'; inp.max = String(tt.totalDays); inp.value = String(tt.currentDay);
      var ok = el('button', 'btn-secondary py-1 px-3 text-sm', 'Imposta');
      ok.onclick = function () { var d = Math.max(1, Math.min(tt.totalDays, parseInt(inp.value, 10) || 1)); saveTreatment({ day: d }).then(function () { treatmentDayEdit = false; render(); }); };
      ed.appendChild(el('span', 'text-xs text-gray-500', 'Riprendi al giorno')); ed.appendChild(inp); ed.appendChild(ok);
      titleWrap.appendChild(ed);
    }
    head.appendChild(titleWrap);

    var toggle = el('label', 'relative inline-flex items-center cursor-pointer shrink-0');
    var chk = el('input', 'sr-only peer'); chk.type = 'checkbox'; chk.checked = tt.active;
    chk.onchange = function () { saveTreatment({ active: chk.checked }).then(render); };
    toggle.appendChild(chk);
    toggle.appendChild(el('div', "w-11 h-6 bg-gray-200 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-600"));
    head.appendChild(toggle);
    card.appendChild(head);

    // banner stato (fase + giorno + %)
    var phaseName = tt.phase === 'blackout' ? 'Blackout' : tt.phase === 'recovery' ? 'Recovery' : 'Completato';
    var phaseEmoji = tt.phase === 'blackout' ? '🌑' : tt.phase === 'recovery' ? '🌱' : '✓';
    var stateBanner = el('div', 'mt-3 mb-3 p-3 rounded-lg ' +
      (tt.phase === 'done' ? 'bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800' :
       tt.phase === 'recovery' ? 'bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800' :
       'bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700'));
    var stateText = tt.active
      ? phaseEmoji + ' ' + phaseName + ' — giorno ' + tt.currentDay + '/' + tt.totalDays + ' — luce ' + tt.factorPct + '%'
      : '⏸ Non attivo — attiva il ciclo per iniziare (' + tt.totalDays + ' giorni: blackout + recovery)';
    stateBanner.innerHTML = '<div class="text-sm font-medium">' + esc(stateText) + '</div>';
    card.appendChild(stateBanner);

    // avviso se acclimatazione attiva
    if (st.active && tt.active) {
      card.appendChild(el('div', 'text-xs text-amber-600 dark:text-amber-400 mb-3 p-2 bg-amber-100 dark:bg-amber-900/30 rounded',
        '⚠️ Il trattamento ha precedenza sull\'acclimatazione quando entrambi sono attivi.'));
    }

    // pallini fase giorno
    var phaseDots = el('div', 'flex gap-1 mb-4 flex-wrap');
    for (var i = 1; i <= tt.totalDays; i++) {
      var dot = el('button', 'w-3 h-3 rounded-full transition cursor-pointer');
      var color = '';
      if (tt.phase === 'done' && i <= tt.totalDays) {
        color = 'bg-emerald-400';
      } else if (i <= 3) {  // blackout (cianobatteri e dinoflagellati: 3gg)
        color = 'bg-slate-600 dark:bg-slate-400';
      } else if (i <= tt.totalDays) {  // recovery (gradient)
        var recoveryDay = i - 3;
        var recoveryTotal = tt.totalDays - 3;
        var pct = Math.round((recoveryDay / recoveryTotal) * 100);
        color = 'bg-gradient-to-r from-amber-400 to-emerald-400';
        dot.style.opacity = String(0.3 + (pct / 100) * 0.7);
      }
      dot.className = dot.className + ' ' + color;
      if (i === tt.currentDay) {
        dot.className = dot.className + ' ring-2 ring-offset-1 ring-violet-500 dark:ring-offset-slate-800';
      }
      (function (day) {
        dot.onclick = function () { saveTreatment({ day: day }).then(render); };
      })(i);
      phaseDots.appendChild(dot);
    }
    card.appendChild(phaseDots);

    // applica ora
    var applyBtn = el('button', 'btn-primary w-full', 'Applica ora alla lampada');
    var status = el('div', 'text-xs text-gray-400 mt-2 text-center', '');
    applyBtn.onclick = function () {
      applyBtn.disabled = true; status.textContent = 'Invio...';
      saveTreatment({ active: true, apply: true }).then(function (d) {
        applyBtn.disabled = false;
        if (d.applied) status.textContent = '✓ Applicato al ' + tt.factorPct + '% (' + d.applied.steps + ' step) — ' + tt.phase + ' giorno ' + tt.currentDay + '/' + tt.totalDays;
        else status.textContent = '✕ ' + (d.error || 'errore');
        render();
      }).catch(function (e) { applyBtn.disabled = false; status.textContent = '✕ ' + e.message; });
    };
    card.appendChild(applyBtn); card.appendChild(status);

    box.appendChild(card);
  }

  load();
})();
