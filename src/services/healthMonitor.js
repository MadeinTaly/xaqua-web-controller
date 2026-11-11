'use strict';

const log = require('./logger');
const configStore = require('./configStore');
const xaquaClient = require('./xaquaClient');
const { addNotification } = require('./notifications');

const ALERT_THRESHOLD = 55;      // warn: probabile ventola sporca/morente
const CRITICAL_THRESHOLD = 65;   // protezione: spegni la lampada
const RESTORE_THRESHOLD = 45;    // isteresi: riaccendi solo sotto questa
const MAX_CYCLES_24H = 3;        // al terzo ciclo in 24h → lockout (raffreddamento guasto)
const CONSECUTIVE_TICKS_FOR_ALERT = 2;
const MAX_SAMPLES = 432; // storico grafici: 3 giorni @ 1 campione ogni 10 min
const HISTORY_EVERY_MS = 10 * 60 * 1000;
// UNICO lettore periodico della lampada (decisione utente 2026-11-02: deduplicare, il firmware
// va in crisi con troppe request). Watchdog, stay-alive, /api/ping, /api/home, oscilloscopio e
// orologio della Schedule leggono getLatest(), MAI il firmware. 2 letture per giro.
const TICK_INTERVAL = 60 * 1000;
const FIRST_TICK_DELAY = 60 * 1000;

let healthMonitorTimer = null;
let samples = [];
// Ultima lettura del giro: { at, ok, status, color, error }. ok=false = lampada non risponde.
let latest = { at: 0, ok: false, status: null, color: null, error: 'nessuna lettura' };
let reach = { ok: null, since: Date.now() };

function getLatest() { return latest; }

// Stay-alive: esito di ogni giro solo ai cambi di stato (giù/su con durata) + un "ok" ogni 10'.
function noteReachability(ok, err) {
  if (reach.ok !== null && ok !== reach.ok) {
    const minutes = Math.round((Date.now() - reach.since) / 60000);
    if (ok) log.warn('healthMonitor', 'stay-alive: lampada TORNATA raggiungibile', { offlineMinutes: minutes });
    else log.warn('healthMonitor', 'stay-alive: lampada DIVENTATA irraggiungibile', { onlineMinutes: minutes, code: err && err.code, error: err && err.message });
  }
  if (ok !== reach.ok) reach = { ok, since: Date.now() };
}

// Stato protezione termica (in RAM; un restart del processo la resetta)
let thermal = { warnCount: 0, alertState: false, protection: { active: false, since: null, lockout: false }, cycleTimes: [] };

/**
 * Macchina a stati termica PURA (testabile): muta `st` e ritorna l'azione da eseguire.
 * Azioni: 'none' | 'warn' | 'warn-clear' | 'protect' | 'lockout' | 'restore'.
 * - >65°C → protezione (spegni). Al 3° ciclo in 24h → lockout: resta spenta.
 * - In protezione: <45°C (isteresi) → restore (rinvia lo schedule).
 * - >55°C per 2 valutazioni consecutive → warn (solo notifica).
 */
function evalThermalState(st, tempC, now) {
  now = now || Date.now();
  if (st.protection.lockout) return 'none'; // spenta finché non interviene l'uomo/restart

  if (st.protection.active) {
    if (tempC < RESTORE_THRESHOLD) {
      st.protection.active = false;
      st.protection.since = null;
      st.warnCount = 0; st.alertState = false;
      return 'restore';
    }
    return 'none';
  }

  if (tempC > CRITICAL_THRESHOLD) {
    // finestra 24h sui cicli passati
    st.cycleTimes = st.cycleTimes.filter(t => now - t < 24 * 60 * 60 * 1000);
    st.cycleTimes.push(now);
    st.protection.active = true;
    st.protection.since = now;
    if (st.cycleTimes.length >= MAX_CYCLES_24H) {
      st.protection.lockout = true;
      return 'lockout';
    }
    return 'protect';
  }

  if (tempC > ALERT_THRESHOLD) {
    st.warnCount++;
    if (!st.alertState && st.warnCount >= CONSECUTIVE_TICKS_FOR_ALERT) {
      st.alertState = true;
      return 'warn';
    }
    return 'none';
  }

  st.warnCount = 0;
  if (st.alertState) { st.alertState = false; return 'warn-clear'; }
  return 'none';
}

// Spegnimento protettivo: colore a zero + zero-schedule two-phase (come il ramo OFF
// di POST /power). config.lastSchedule NON viene toccato: serve al ripristino.
async function sendProtectOff() {
  const { sendScheduleTwoPhase } = require('../routes/api/_shared');
  const { slotsToSchedule } = require('./scheduleUtils');
  await xaquaClient.setColorSchema({ Amber: 0, Blue: 0, White: 0, Power: 0 });
  const zero = slotsToSchedule([
    { key: 'off',  time: '00:00', Amber: 0, Blue: 0, White: 0, Power: 0 },
    { key: 'off2', time: '12:00', Amber: 0, Blue: 0, White: 0, Power: 0 }
  ]);
  await sendScheduleTwoPhase(zero);
}

// Ripristino: rinvia l'ultimo schedule applicato (two-phase). Il firmware riprende
// da solo il punto giusto della giornata.
async function sendRestore() {
  const { sendScheduleTwoPhase } = require('../routes/api/_shared');
  const config = configStore.load();
  const list = config.lastSchedule || [];
  if (!list.length) { log.warn('healthMonitor', 'restore: lastSchedule vuoto, skip reinvio'); return; }
  await sendScheduleTwoPhase({ Period: 86400, Steps: list.length, ColorTransitionList: list });
}

function isProtectionActive() { return !!(thermal.protection.active || thermal.protection.lockout); }

function pushSample(state, sample) {
  if (!sample || typeof sample.tempC !== 'number' || typeof sample.fan !== 'number') {
    return;
  }
  const entry = {
    at: sample.at || Date.now(),
    tempC: sample.tempC,
    fan: sample.fan
  };
  // Colore live (opzionale): serve al grafico luci reale-vs-atteso in /lampinfo
  if (sample.color && typeof sample.color === 'object') {
    entry.color = {
      Amber: Math.round(sample.color.Amber || 0),
      Blue:  Math.round(sample.color.Blue  || 0),
      White: Math.round(sample.color.White || 0),
      Power: Math.round(sample.color.Power || 0)
    };
  }
  state.push(entry);
  while (state.length > MAX_SAMPLES) {
    state.shift();
  }
}

async function runHealthMonitorTick() {
  try {
    const at = Date.now();
    let status;
    try {
      status = await xaquaClient.getLampStatus();
    } catch (err) {
      // Lampada giù: niente seconda chiamata in questo giro.
      latest = { at, ok: false, status: null, color: null, error: err.message };
      noteReachability(false, err);
      return;
    }

    if (!status || status.Temperature === undefined || status.FanSpeed === undefined) {
      // 200 con body vuoto = firmware in affanno: conta come non sano, niente seconda chiamata.
      latest = { at, ok: false, status: null, color: null, error: 'risposta vuota' };
      noteReachability(false, { code: 'EMPTY_BODY', message: 'risposta vuota' });
      return;
    }

    const tempC = status.Temperature; // xaquaClient già divide per 100 in getLampStatus
    const fan = status.FanSpeed;

    // Colore istantaneo: best-effort, un errore non deve invalidare il campione termico
    let color = null;
    try {
      color = await xaquaClient.getColorSchema();
    } catch (err) {
      log.warn('healthMonitor', 'getColorSchema failed', { error: err.message });
    }

    latest = { at, ok: true, status, color, error: null };
    noteReachability(true);
    require('./watchdog').check(color, at);

    const last = samples[samples.length - 1];
    if (!last || at - last.at >= HISTORY_EVERY_MS) {
      pushSample(samples, { at, tempC, fan, color });
      log.info('healthMonitor', 'stay-alive ok', { tempC, fan, color });
    }

    // Macchina a stati termica: warn (55) / protezione (65, off automatico) /
    // restore (isteresi 45) / lockout (3 cicli in 24h = raffreddamento guasto).
    const action = evalThermalState(thermal, tempC, Date.now());
    switch (action) {
      case 'warn':
        log.error('healthMonitor', 'Temperatura lampada ALTA - allarme attivato', { tempC, threshold: ALERT_THRESHOLD });
        addNotification('warning', 'Temperatura lampada alta', { tempC: tempC.toFixed(2), threshold: ALERT_THRESHOLD, fan });
        break;
      case 'warn-clear':
        log.info('healthMonitor', 'Temperatura lampada rientrata - allarme disattivato', { tempC, threshold: ALERT_THRESHOLD });
        break;
      case 'protect':
        log.error('healthMonitor', 'PROTEZIONE TERMICA: spengo la lampada', { tempC, threshold: CRITICAL_THRESHOLD, cycle: thermal.cycleTimes.length });
        addNotification('warning', 'Protezione termica: lampada spenta', { tempC: tempC.toFixed(2), riaccensione: 'automatica sotto ' + RESTORE_THRESHOLD + '°C' });
        try { await sendProtectOff(); } catch (e) { log.error('healthMonitor', 'protect off fallito', { error: e.message }); }
        break;
      case 'lockout':
        log.error('healthMonitor', 'PROTEZIONE TERMICA: 3° ciclo in 24h — raffreddamento GUASTO, lampada lasciata spenta', { tempC });
        addNotification('warning', 'Ventola/raffreddamento GUASTO: lampada lasciata spenta', { tempC: tempC.toFixed(2), cicli24h: thermal.cycleTimes.length });
        try { await sendProtectOff(); } catch (e) { log.error('healthMonitor', 'protect off fallito', { error: e.message }); }
        break;
      case 'restore':
        log.info('healthMonitor', 'Protezione termica rientrata: ripristino schedule', { tempC });
        try {
          await sendRestore();
          addNotification('info', 'Protezione termica rientrata: schedule ripristinato', { tempC: tempC.toFixed(2) });
        } catch (e) {
          log.error('healthMonitor', 'restore fallito', { error: e.message });
        }
        break;
      default: break;
    }
  } catch (err) {
    log.error('healthMonitor', 'tick error', { error: err.message });
  }
}

function start() {
  if (healthMonitorTimer) {
    log.warn('healthMonitor', 'already running');
    return;
  }

  log.info('healthMonitor', 'starting (unico lettore lampada, giro ogni 60s)');

  // Catena di setTimeout (non setInterval): il giro dopo parte solo a giro finito,
  // così due giri non si sovrappongono mai sul firmware.
  const scheduleNext = (delay) => {
    healthMonitorTimer = setTimeout(async () => {
      await runHealthMonitorTick();
      scheduleNext(TICK_INTERVAL);
    }, delay);
  };
  scheduleNext(FIRST_TICK_DELAY);
}

function stop() {
  if (healthMonitorTimer) {
    clearTimeout(healthMonitorTimer);
    healthMonitorTimer = null;
    thermal = { warnCount: 0, alertState: false, protection: { active: false, since: null, lockout: false }, cycleTimes: [] };
  }
  log.info('healthMonitor', 'stopped');
}

/**
 * Arricchisce i campioni con il colore ATTESO dalla schedule attiva a quell'istante.
 * Stessa convenzione del watchdog: config.lastSchedule è PRE-scala, il firmware
 * (e quindi sample.color) è POST-scala → l'atteso va scalato per powerScale/100.
 * Lavora su copie: non muta l'array `samples` interno.
 */
function attachExpected(list) {
  let config;
  try { config = configStore.load(); } catch (e) { return list; }
  const sch = (config && config.lastSchedule) || [];
  if (!sch.length) return list;
  const { expectedAt } = require('./oscilloscopeHelper');
  const tz = (config.device && typeof config.device.tzOffsetMinutes === 'number') ? config.device.tzOffsetMinutes : 0;
  const s = (typeof config.powerScale === 'number' ? Math.max(0, Math.min(100, config.powerScale)) : 100) / 100;
  return list.map(smp => {
    const daySec = Math.floor((((smp.at + tz * 60000) % 86400000) + 86400000) % 86400000 / 1000);
    const e = expectedAt(sch, daySec);
    if (!e) return smp;
    return Object.assign({}, smp, {
      expected: {
        Amber: Math.round((e.Amber || 0) * s),
        Blue:  Math.round((e.Blue  || 0) * s),
        White: Math.round((e.White || 0) * s),
        Power: Math.round((e.Power || 0) * s)
      }
    });
  });
}

function getHistory() {
  if (samples.length === 0) {
    return {
      samples: [], alertThreshold: ALERT_THRESHOLD,
      protection: { active: thermal.protection.active, lockout: thermal.protection.lockout, since: thermal.protection.since, cycles24h: thermal.cycleTimes.length }
    };
  }

  // Calcola min, max, media del periodo
  const temps = samples.map(s => s.tempC);
  const fans = samples.map(s => s.fan);

  const minTemp = Math.min(...temps);
  const maxTemp = Math.max(...temps);
  const avgTemp = temps.reduce((a, b) => a + b, 0) / temps.length;

  const minFan = Math.min(...fans);
  const maxFan = Math.max(...fans);
  const avgFan = fans.reduce((a, b) => a + b, 0) / fans.length;

  return {
    samples: attachExpected(samples.map(s => Object.assign({}, s))), // copie: nessuna mutazione esterna
    alertThreshold: ALERT_THRESHOLD,
    protection: { active: thermal.protection.active, lockout: thermal.protection.lockout, since: thermal.protection.since, cycles24h: thermal.cycleTimes.length },
    stats: {
      temperature: {
        min: minTemp,
        max: maxTemp,
        avg: avgTemp
      },
      fan: {
        min: minFan,
        max: maxFan,
        avg: avgFan
      },
      sampleCount: samples.length,
      spanMinutes: samples.length > 0 ? Math.round((Date.now() - samples[0].at) / 60000) : 0
    }
  };
}

module.exports = {
  start,
  stop,
  getHistory,
  getLatest,
  isProtectionActive,
  runHealthMonitorTick, // per test
  pushSample,        // per test
  evalThermalState   // per test (macchina a stati pura)
};
