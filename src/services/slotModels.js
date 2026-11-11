'use strict';

// Schedule a slot: una giornata = lista di slot { ora, asset }. L'ASSET e' un colore FISSO
// (le tabelle dell'app originale, presets.js): assegnato a qualunque ora da' sempre lo
// stesso punto. Tra uno slot e il successivo il firmware rampa; da notte/spento verso il
// giorno si tiene il buio e si salta (vedi pointsToSchedule), come nell'app.
// Serializzato nella solita ColorTransitionList two-phase: firmware ed endpoint invariati.

const { PROFILES } = require('./presets');
const { bandForTime } = require('./scheduleUtils');

// --- Profondità (leva globale: sceglie la tabella colori dell'app) ---
const DEPTHS = [
  { key: 'Deep',     label: 'Superficiale', hint: '0-10m' },
  { key: 'SemiDeep', label: 'Intermedio',   hint: '10-20m' },
  { key: 'VeryDeep', label: 'Profondo',     hint: '20m+' }
];

// --- Fasce di default: le 7 dei preset dell'app originale (ScheduleViewModel) ---
const FASCE = [
  { key: 'alba',       label: 'Alba',       defTime: '09:00' },
  { key: 'mattina',    label: 'Mattina',    defTime: '10:00' },
  { key: 'picco',      label: 'Picco',      defTime: '11:00' },
  { key: 'pomeriggio', label: 'Pomeriggio', defTime: '18:00' },
  { key: 'tramonto',   label: 'Tramonto',   defTime: '19:00' },
  { key: 'sera',       label: 'Sera',       defTime: '20:00' },
  { key: 'notte',      label: 'Notte',      defTime: '00:00' }
];

// --- Asset: id -> cella FISSA della tabella { band, condition } (righe/colonne del CSV dell'app) ---
// hold: notte/spento non rampa verso il giorno (buio tenuto fino allo slot successivo).
const DAY_ASSETS = [
  ['alba', 'sunrise', 'Alba', '🌅'], ['mattina', 'morning', 'Mattina', '🌤️'], ['picco', 'day', 'Picco', '☀️'],
  ['pomeriggio', 'afternoon', 'Pomeriggio', '🌞'], ['tramonto', 'sunset', 'Tramonto', '🌇'], ['sera', 'evening', 'Sera', '🌆']
];
const WEATHER = [['', 'clear', '', ''], ['-nuvoloso', 'cloudy', ' nuvoloso', '⛅'], ['-piovoso', 'rainy', ' piovoso', '🌧️']];
const ASSETS = [];
DAY_ASSETS.forEach(([id, band, label, emoji]) => WEATHER.forEach(([sfx, condition, lsfx, esfx]) =>
  ASSETS.push({ id: id + sfx, label: label + lsfx, emoji: emoji + esfx, band, condition })));
// Asset DINAMICI: stessa riga della tabella, colonna decisa al momento dell'invio (meteo
// corrente / fase lunare di oggi). `condition` = fallback e anteprima. Una giornata che li
// contiene viene ricomposta e reinviata UNA volta al giorno (scheduler.runMaintenanceTick).
DAY_ASSETS.forEach(([id, band, label, emoji]) =>
  ASSETS.push({ id: id + '-meteo', label: label + ' meteo reale', emoji: emoji + '📡', band, condition: 'clear', dynamic: 'weather' }));
ASSETS.push(
  { id: 'luna', label: 'Luna reale', emoji: '🌙', band: 'night', condition: 'moonless', hold: true, dynamic: 'moon' },
  { id: 'novilunio',  label: 'Novilunio',  emoji: '🌑', band: 'night', condition: 'moonless', hold: true },
  { id: 'crescente',  label: 'Crescente',  emoji: '🌒', band: 'night', condition: 'crescent', hold: true },
  { id: 'mezzaluna',  label: 'Mezzaluna',  emoji: '🌓', band: 'night', condition: 'half',     hold: true },
  { id: 'plenilunio', label: 'Plenilunio', emoji: '🌕', band: 'night', condition: 'full',     hold: true },
  // riga LateNight del CSV: luce lunare tenue (Power 4)
  { id: 'fonda-crescente',  label: 'Notte fonda crescente',  emoji: '🌒✨', band: 'latenight', condition: 'crescent', hold: true },
  { id: 'fonda-mezzaluna',  label: 'Notte fonda mezzaluna',  emoji: '🌓✨', band: 'latenight', condition: 'half',     hold: true },
  { id: 'fonda-plenilunio', label: 'Notte fonda plenilunio', emoji: '🌕✨', band: 'latenight', condition: 'full',     hold: true },
  { id: 'spento',     label: 'Spento',     emoji: '⚫', off: true, hold: true }
);

// --- Preset: i 3 dell'app originale (ScheduleViewModel ID1..ID3), stessi orari e colori ---
// "Profonda" nell'app ha Power 60 di giorno e 25 la sera = colonna "cloudy" di VeryDeep.
function defTimes() {
  const t = {}; FASCE.forEach(f => { t[f.key] = f.defTime; }); return t;
}
function presetSel(sfx) {
  const s = {}; FASCE.forEach(f => { s[f.key] = f.key === 'notte' ? 'spento' : f.key + sfx; }); return s;
}
const PRESETS = [
  { id: 'superficiale', name: 'Barriera superficiale', emoji: '🌊', depth: 'Deep',     sel: presetSel(''),          times: defTimes() },
  { id: 'intermedia',   name: 'Barriera intermedia',   emoji: '🪸', depth: 'SemiDeep', sel: presetSel(''),          times: defTimes() },
  { id: 'profonda',     name: 'Barriera profonda',     emoji: '🐚', depth: 'VeryDeep', sel: presetSel('-nuvoloso'), times: defTimes() },
  // Preset storici di xaqua-web, riespressi in asset fissi (6 fasce, niente "sera").
  // Senza depth = profondità di Settings.
  { id: 'soleggiata', name: 'Giornata soleggiata', emoji: '☀️',
    sel: { alba: 'alba', mattina: 'mattina', picco: 'picco', pomeriggio: 'pomeriggio', tramonto: 'tramonto', notte: 'novilunio' },
    times: { alba: '07:30', mattina: '09:00', picco: '12:30', pomeriggio: '16:30', tramonto: '19:00', notte: '22:00' } },
  { id: 'nuvolosa', name: 'Giornata nuvolosa', emoji: '⛅',
    sel: { alba: 'alba-nuvoloso', mattina: 'mattina-nuvoloso', picco: 'picco-nuvoloso', pomeriggio: 'pomeriggio-nuvoloso', tramonto: 'tramonto-nuvoloso', notte: 'novilunio' },
    times: { alba: '08:00', mattina: '09:30', picco: '12:00', pomeriggio: '16:00', tramonto: '18:30', notte: '21:30' } },
  { id: 'plenilunio', name: 'Notte di plenilunio', emoji: '🌕',
    sel: { alba: 'alba', mattina: 'mattina', picco: 'picco', pomeriggio: 'pomeriggio-nuvoloso', tramonto: 'tramonto', notte: 'plenilunio' },
    times: { alba: '07:30', mattina: '09:00', picco: '12:30', pomeriggio: '16:30', tramonto: '19:30', notte: '22:30' } },
  // Profilo SoftReef (presets.js): ~8h sopra metà potenza, buio piatto dalle 20:00 all'alba.
  { id: 'molli', name: 'Coralli molli (bio)', emoji: '🐠', depth: 'SoftReef',
    sel: { alba: 'alba', mattina: 'mattina', picco: 'picco', pomeriggio: 'pomeriggio', tramonto: 'tramonto', notte: 'spento' },
    times: { alba: '07:30', mattina: '09:00', picco: '11:30', pomeriggio: '16:00', tramonto: '19:00', notte: '20:00' } }
];

// Giornata tropicale casuale (ciclo convettivo): il dado gira QUI, alla generazione; il
// risultato è una normale lista di asset fissi. La notte prende la fase lunare di oggi.
// Reef: 55% acquazzone pomeridiano. Atoll: 40% rovescio all'alba. Jitter ±20', snap 5'.
const MOON_ASSET = { moonless: 'novilunio', crescent: 'crescente', half: 'mezzaluna', full: 'plenilunio' };
function generateTropicalDay(variant = 'reef', now = new Date()) {
  const { calculateMoonPhase, moonPhaseToWeatherColumn } = require('./moonHelper');
  const snap = (h, m, fwdOnly) => {
    const off = fwdOnly ? Math.floor(Math.random() * 20) : Math.floor((Math.random() - 0.5) * 40);
    const t = Math.round((h * 60 + m + off) / 5) * 5;
    return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  };
  const atoll = variant === 'atoll';
  const rainy = Math.random() < (atoll ? 0.40 : 0.55);
  const sel = { alba: 'alba', mattina: 'mattina', picco: 'picco', pomeriggio: 'pomeriggio', tramonto: 'tramonto',
    notte: MOON_ASSET[moonPhaseToWeatherColumn(calculateMoonPhase(now))] || 'novilunio' };
  if (rainy && atoll) Object.assign(sel, { alba: 'alba-piovoso', mattina: 'mattina-nuvoloso' });
  if (rainy && !atoll) Object.assign(sel, { picco: 'picco-nuvoloso', pomeriggio: 'pomeriggio-piovoso' });
  const times = { alba: snap(7, 30), mattina: snap(9, 0), picco: snap(12, 30), pomeriggio: snap(16, 30), tramonto: snap(19, 0), notte: snap(22, 0, true) };
  return {
    selection: Object.keys(sel).map(k => ({ fascia: k, modelId: sel[k], time: times[k] })),
    label: `${rainy ? 'Piovosa' : 'Soleggiata'} ${atoll ? '(Atollo)' : '(Barriera)'}`
  };
}

const ZERO = { Amber: 0, Blue: 0, White: 0, Power: 0 };

function assetById(id) { return ASSETS.find(a => a.id === id) || null; }
function clamp100(v) { return Math.max(0, Math.min(100, Math.round(v))); }

// Selezioni salvate col vecchio modello (sereno/nuvoloso/off/auto/effetti, colore dedotto
// dall'ORA): convertite nell'asset che davano a quell'ora, cosi' nulla cambia colore.
const LEGACY_COND = { nuvoloso: '-nuvoloso', piovoso: '-piovoso', acquazzone: '-piovoso' };
const LEGACY_NIGHT = { mezzaluna: 'mezzaluna', plenilunio: 'plenilunio', stellata: 'mezzaluna' };
const BAND_ASSET = { sunrise: 'alba', morning: 'mattina', day: 'picco', afternoon: 'pomeriggio', sunset: 'tramonto', evening: 'sera' };
function normalizeModelId(modelId, time) {
  if (assetById(modelId)) return modelId;
  if (modelId === 'off') return 'spento';
  const band = bandForTime(time);
  if (band === 'night') return LEGACY_NIGHT[modelId] || 'novilunio';
  if (band === 'latenight') return LEGACY_NIGHT[modelId] ? 'fonda-' + LEGACY_NIGHT[modelId] : 'spento';
  return (BAND_ASSET[band] || 'picco') + (LEGACY_COND[modelId] || '');
}
function normalizeSelection(selection) {
  return (Array.isArray(selection) ? selection : []).filter(s => s && typeof s === 'object')
    .map(s => ({ ...s, modelId: normalizeModelId(s.modelId, s.time) }));
}

function timeToSec(hhmm) { const [h, m] = String(hhmm).split(':').map(Number); return (h * 3600) + (m * 60); }
function secToTime(sec) {
  sec = ((Math.round(sec) % 86400) + 86400) % 86400;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const p = (n) => String(n).padStart(2, '0');
  return `2015/12/01 - ${p(h)}:${p(m)}:${p(s)}`;
}

/** Colore di un asset nella tabella della profondità. NON dipende dall'ora. */
function resolveColor(depth, asset, live = {}) {
  if (!asset || asset.off) return { ...ZERO };
  const profile = PROFILES[depth] || PROFILES.SemiDeep;
  const condition = (asset.dynamic && live[asset.dynamic]) || asset.condition;
  const c = profile.schedule[asset.band] && profile.schedule[asset.band][condition];
  return c ? { Amber: c.A, Blue: c.B, White: c.W, Power: c.P } : { ...ZERO };
}

/**
 * Compone gli slot in una ColorTransitionList two-phase.
 * @param {Array} selection [{ fascia, modelId (id asset), time:'HH:MM' }]
 * @param {object} live { weather, moon } per gli asset dinamici (vedi liveConditions)
 */
function composeSchedule(selection, depth = 'SemiDeep', live = {}) {
  if (!Array.isArray(selection) || !selection.length) return { Period: 86400, Steps: 0, ColorTransitionList: [] };
  const points = normalizeSelection(selection).map(s => {
    const asset = assetById(s.modelId);
    return { sec: timeToSec(s.time || '12:00'), color: resolveColor(depth, asset, live), hold: !!asset.hold };
  });
  return pointsToSchedule(points);
}

function pointsToSchedule(points) {
  const sorted = [...points].sort((a, b) => a.sec - b.sec);
  const list = [];
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i], nxt = sorted[(i + 1) % sorted.length];
    let delta = nxt.sec - cur.sec; if (delta <= 0) delta += 86400;
    // Notte -> giorno: tieni il colore notturno e salta all'alba (come l'app originale),
    // invece di rampare il blu per tutta la notte.
    const to = cur.hold && !nxt.hold ? cur.color : nxt.color;
    list.push({
      From: { Amber: clamp100(cur.color.Amber), Blue: clamp100(cur.color.Blue), White: clamp100(cur.color.White), Power: clamp100(cur.color.Power) },
      To:   { Amber: clamp100(to.Amber), Blue: clamp100(to.Blue), White: clamp100(to.White), Power: clamp100(to.Power) },
      DeltaSeconds: delta,
      Time: secToTime(cur.sec)
    });
  }
  return { Period: 86400, Steps: list.length, ColorTransitionList: list };
}

// Tipi dinamici presenti nella selection (es. ['weather', 'moon']); [] = giornata statica.
function dynamicKinds(selection) {
  const kinds = normalizeSelection(selection).map(s => (assetById(s.modelId) || {}).dynamic).filter(Boolean);
  return [...new Set(kinds)];
}

// Condizioni reali per gli asset dinamici della selection. Meteo solo se serve e se città +
// apiKey sono configurate; su errore resta il fallback dell'asset (sereno), con un warn in /logs.
async function liveConditions(selection, cfg, now = new Date()) {
  const kinds = dynamicKinds(selection);
  const live = {};
  if (kinds.includes('moon')) {
    const { calculateMoonPhase, moonPhaseToWeatherColumn } = require('./moonHelper');
    live.moon = moonPhaseToWeatherColumn(calculateMoonPhase(now));
  }
  const w = cfg && cfg.weather;
  if (kinds.includes('weather') && w && w.city && w.apiKey) {
    const { fetchCurrentWeather, weatherCodeToCondition } = require('./weatherService');
    try {
      live.weather = weatherCodeToCondition((await fetchCurrentWeather(w.city, w.apiKey)).weather[0].id);
    } catch (e) {
      require('./logger').warn('slotModels', 'meteo reale non disponibile, uso sereno', { error: e.message });
    }
  }
  return live;
}

function defaultSelection() {
  const p = PRESETS.find(x => x.id === 'intermedia');
  return FASCE.map(f => ({ fascia: f.key, modelId: p.sel[f.key], time: p.times[f.key] || f.defTime }));
}

module.exports = {
  DEPTHS, FASCE, ASSETS, PRESETS,
  resolveColor, composeSchedule, defaultSelection, normalizeSelection, generateTropicalDay,
  assetById, dynamicKinds, liveConditions
};
