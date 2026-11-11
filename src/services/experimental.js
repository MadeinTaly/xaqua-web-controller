'use strict';

// Sezione "Experimental": cicli pluri-settimanali che, una volta attivati, modificano
// ciò che viene inviato alla lampada. Hook nel compose (scala Power) — zero tocco al
// protocollo firmware. Primo ciclo: acclimatazione coralli (ramp intensità su settimane).

function clampInt(v, a, b) {
  v = parseInt(v, 10);
  if (isNaN(v)) v = a;
  return Math.max(a, Math.min(b, v));
}

// Giorni totali del trattamento (settimane * 7), minimo 1.
function totalDays(acc) {
  return Math.max(1, (acc && acc.weeks ? acc.weeks : 4) * 7);
}

// Formatta una Date come 'YYYY-MM-DD' in ora LOCALE (no UTC shift di toISOString).
function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// Giorno corrente del trattamento (1..totalDays), da startDate. Confronto a mezzanotte
// LOCALE su entrambe le date per evitare off-by-one da fuso/frazioni di giorno.
function currentDay(acc, now) {
  now = now || new Date();
  if (!acc || !acc.startDate) return 1;
  const parts = String(acc.startDate).split('-').map(Number);
  const start = new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1, 0, 0, 0, 0);
  const n2 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const day = Math.round((n2.getTime() - start.getTime()) / 86400000) + 1;
  return Math.max(1, Math.min(totalDays(acc), day));
}

// Fattore di intensità [startPct/100 .. 1] lineare sul giorno corrente.
function factor(acc, now) {
  const sp = (acc && acc.startPct != null ? acc.startPct : 30) / 100;
  const td = totalDays(acc);
  const day = currentDay(acc, now);
  const t = td > 1 ? (day - 1) / (td - 1) : 1;
  return Math.max(0, Math.min(1, sp + (1 - sp) * t));
}

// startDate tale che currentDay(now) == day (per "riprendere" il trattamento a un giorno).
function startDateForDay(day, now) {
  now = now || new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  d.setDate(d.getDate() - (clampInt(day, 1, 9999) - 1));
  return ymd(d);
}

// Scala il Power di ogni step della ColorTransitionList per il fattore (in-place).
function scalePower(list, f) {
  (list || []).forEach((ct) => {
    ['From', 'To'].forEach((k) => {
      if (ct[k] && typeof ct[k].Power === 'number') {
        ct[k].Power = Math.max(0, Math.min(100, Math.round(ct[k].Power * f)));
      }
    });
  });
  return list;
}

// Stato derivato per la UI.
function summary(acc, now) {
  now = now || new Date();
  if (!acc) acc = {};
  return {
    active: !!acc.active,
    weeks: acc.weeks || 4,
    startPct: acc.startPct != null ? acc.startPct : 30,
    startDate: acc.startDate || null,
    totalDays: totalDays(acc),
    currentDay: currentDay(acc, now),
    factorPct: Math.round(factor(acc, now) * 100)
  };
}

// --- Cicli di trattamento (alghe) ---
const TREATMENTS = {
  cyano: { blackoutDays: 3, recoveryDays: 4, recoveryStartPct: 0, photoperiodCutHours: 2 },
  dino: { blackoutDays: 3, recoveryDays: 7, recoveryStartPct: 50, photoperiodCutHours: 4 }
};

// Fattore di intensità per trattamento alghe [0 .. 1].
// Giorni 1..blackoutDays → 0 (buio completo)
// Giorni successivi → rampa lineare da recoveryStartPct% a 100% lungo recoveryDays
// Oltre la fine → 1 (ciclo concluso)
function treatmentFactor(treatment, now) {
  now = now || new Date();
  if (!treatment || !treatment.active || !treatment.type || !treatment.startDate) return 1;
  const proto = TREATMENTS[treatment.type];
  if (!proto) return 1;
  const day = currentDay(treatment, now);
  const totalTreatmentDays = proto.blackoutDays + proto.recoveryDays;
  if (day <= proto.blackoutDays) return 0;
  if (day > totalTreatmentDays) return 1;
  const recoveryDay = day - proto.blackoutDays;
  const recoveryPct = proto.recoveryStartPct / 100;
  const t = proto.recoveryDays > 1 ? (recoveryDay - 1) / (proto.recoveryDays - 1) : 1;
  return Math.max(0, Math.min(1, recoveryPct + (1 - recoveryPct) * t));
}

// Stato derivato per la UI: fase + giorno + durata totale + intensità.
function treatmentSummary(treatment, now) {
  now = now || new Date();
  if (!treatment || !treatment.type) return null;
  const proto = TREATMENTS[treatment.type];
  if (!proto) return null;
  const day = currentDay(treatment, now);
  const totalDays = proto.blackoutDays + proto.recoveryDays;
  let phase = 'done';
  if (day <= proto.blackoutDays) {
    phase = 'blackout';
  } else if (day <= totalDays) {
    phase = 'recovery';
  }
  return {
    active: !!treatment.active,
    type: treatment.type,
    startDate: treatment.startDate || null,
    currentDay: day,
    totalDays: totalDays,
    phase: phase,
    factorPct: Math.round(treatmentFactor(treatment, now) * 100)
  };
}

// Calcola il taglio fotoperiodo lineare durante la recovery.
// Ritorna [0, totalCutHours], dove 0 = blackout/end recovery, totalCutHours = inizio recovery.
function photoperiodCutAtDay(treatment, now) {
  now = now || new Date();
  if (!treatment || !treatment.type || !treatment.startDate) return 0;
  const proto = TREATMENTS[treatment.type];
  if (!proto) return 0;
  const day = currentDay(treatment, now);
  if (day <= proto.blackoutDays) return proto.photoperiodCutHours;
  if (day > proto.blackoutDays + proto.recoveryDays) return 0;
  const recoveryDay = day - proto.blackoutDays;
  // Con recoveryDays === 1 la frazione sarebbe 0/0 (NaN): il giorno unico di recovery
  // ha taglio pieno (t = 0), il giorno dopo la guardia sopra ritorna già 0.
  const t = proto.recoveryDays > 1 ? (recoveryDay - 1) / (proto.recoveryDays - 1) : 0;
  return Math.max(0, proto.photoperiodCutHours * (1 - t));
}

// Aggiusta gli orari della selection comprimendo il fotoperiodo durante recovery.
// Ritorna una COPIA della selection con orari modificati (originale non mutata).
// La compressione è lineare: metà taglio davanti (alba ritardata), metà dietro (notte anticipata).
function adjustPhotoperiod(selection, treatment, now) {
  const { bandForTime } = require('./scheduleUtils');
  const { assetById } = require('./slotModels');
  // Banda dello slot: quella dell'asset (fissa), o dall'ora per spento/asset ignoti.
  const bandOf = (s) => { const a = assetById(s.modelId); return (a && a.band) || bandForTime(s.time); };
  if (!Array.isArray(selection) || !selection.length || !treatment || !treatment.type) {
    return Array.isArray(selection) ? selection.slice() : selection;
  }
  const cutHours = photoperiodCutAtDay(treatment, now);
  if (cutHours === 0) return JSON.parse(JSON.stringify(selection));

  // Copia della selection
  const adjusted = JSON.parse(JSON.stringify(selection));

  // Identifica alba (prima fascia diurna) e inizio notte (prima fascia notturna)
  let albaIdx = -1, notteIdx = -1;
  for (let i = 0; i < adjusted.length; i++) {
    const band = bandOf(adjusted[i]);
    if (albaIdx < 0 && band === 'sunrise') albaIdx = i;
    if (notteIdx < 0 && (band === 'night' || band === 'latenight')) notteIdx = i;
  }

  // Metà taglio spostato davanti (alba +)
  const cutFront = cutHours / 2;
  // Metà taglio spostato dietro (notte -)
  const cutBack = cutHours - cutFront;

  // Ritarda alba (aggiunge minuti)
  if (albaIdx >= 0) {
    adjusted[albaIdx].time = addMinutesToTime(adjusted[albaIdx].time, Math.round(cutFront * 60));
  }

  // Anticipa notte (sottrae minuti)
  if (notteIdx >= 0) {
    adjusted[notteIdx].time = addMinutesToTime(adjusted[notteIdx].time, -Math.round(cutBack * 60));
  }

  // Riscala fasce intermedie proporzionalmente
  if (albaIdx >= 0 && notteIdx >= 0) {
    const daylightStart = timeToMinutes(adjusted[albaIdx].time);
    const daylightEnd = timeToMinutes(adjusted[notteIdx].time);
    if (daylightEnd > daylightStart) {
      const originalDayStart = timeToMinutes(selection[albaIdx].time);
      const originalDayEnd = timeToMinutes(selection[notteIdx].time);
      const originalDuration = originalDayEnd > originalDayStart
        ? originalDayEnd - originalDayStart
        : 1440 - (originalDayStart - originalDayEnd);
      const newDuration = daylightEnd - daylightStart;

      // Finestra diurna originale degenere (alba e notte allo stesso orario, es.
      // photoperiodCutHours grandi): divisione per zero → salta la riscalatura,
      // le fasce intermedie mantengono l'orario (dedup/sort sotto le sistemano).
      if (originalDuration > 0) {
        // Riscala le fasce diurne tra alba e notte
        for (let i = albaIdx + 1; i < notteIdx; i++) {
          const band = bandOf(selection[i]);
          if (band !== 'night' && band !== 'latenight') {
            const origMinFromStart = timeToMinutes(selection[i].time) - originalDayStart;
            const newMinFromStart = Math.round((origMinFromStart / originalDuration) * newDuration);
            adjusted[i].time = minutesToTime(daylightStart + newMinFromStart);
          }
        }
      }
    }
  }

  // Riordina per orario e rimuovi duplicati
  const timeSet = new Set();
  const sorted = adjusted
    .filter(s => {
      if (timeSet.has(s.time)) return false;
      timeSet.add(s.time);
      return true;
    })
    .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));

  return sorted;
}

// Giornata da inviare oggi: compone la selection applicando i cicli attivi di
// config.experimental. Il trattamento SOVRASCRIVE l'acclimatazione (non si moltiplicano);
// il fotoperiodo si accorcia solo in recovery (in blackout il Power è già 0).
function composeForToday(selection, depth, ex, now, live) {
  const { composeSchedule } = require('./slotModels');
  now = now || new Date();
  const tr = ex && ex.treatment;
  const acc = ex && ex.acclimation;
  const trActive = !!(tr && tr.active);
  const trState = trActive && treatmentSummary(tr, now);
  const sch = composeSchedule(trState && trState.phase === 'recovery' ? adjustPhotoperiod(selection, tr, now) : selection, depth, live);
  if (trActive) scalePower(sch.ColorTransitionList, treatmentFactor(tr, now));
  else if (acc && acc.active) scalePower(sch.ColorTransitionList, factor(acc, now));
  return sch;
}

// Chiave del "giorno" per l'invio automatico giornaliero: cambia quando avanza un ciclo
// experimental attivo o, se la giornata salvata ha asset dinamici (meteo/luna reali), a ogni
// nuovo giorno di calendario (fuso del device). null = niente da reinviare in automatico.
function dailyKey(cfg, now) {
  now = now || new Date();
  const ex = cfg.experimental || {};
  const parts = [];
  if (ex.treatment && ex.treatment.active && ex.treatment.type) {
    parts.push('tr:' + ex.treatment.type + ':' + treatmentSummary(ex.treatment, now).currentDay);
  } else if (ex.acclimation && ex.acclimation.active) {
    parts.push('acc:' + summary(ex.acclimation, now).currentDay);
  }
  const { dynamicKinds } = require('./slotModels');
  if (cfg.reelState && dynamicKinds(cfg.reelState.selection).length) {
    const tz = (cfg.device && cfg.device.timezone) || 'Europe/Rome';
    parts.push('dyn:' + new Intl.DateTimeFormat('sv-SE', { timeZone: tz }).format(now));
  }
  return parts.length ? parts.join('|') : null;
}

function timeToMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(mins) {
  mins = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}`;
}

function addMinutesToTime(hhmm, deltaMinutes) {
  const mins = timeToMinutes(hhmm) + deltaMinutes;
  return minutesToTime(mins);
}

module.exports = { clampInt, totalDays, currentDay, factor, startDateForDay, scalePower, summary, TREATMENTS, treatmentFactor, treatmentSummary, adjustPhotoperiod, photoperiodCutAtDay, composeForToday, dailyKey };
