'use strict';

const xaquaClient = require('../../services/xaquaClient');
const configStore = require('../../services/configStore');
const log = require('../../services/logger');

const IP_REGEX = /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      res.status(500).json({ error: err.message });
    });
  };
}

function castABWP(obj) {
  function safeInt(v, min, max) {
    const n = parseInt(v);
    if (isNaN(n)) return 0;
    return Math.max(min, Math.min(max, n));
  }
  return {
    Amber: safeInt(obj.Amber, 0, 100),
    Blue:  safeInt(obj.Blue, 0, 100),
    White: safeInt(obj.White, 0, 100),
    Power: safeInt(obj.Power, 0, 100)
  };
}

// F1: Helper two-phase protocollo firmware (INVIOLABILE).
// FASE 1: SetColorSchedule con {Steps, Period}; FASE 2: SetColorScheduleTransition per step.
// Delay: 500ms dopo FASE 1, poi 1000ms dopo ogni step (3 tentativi per step, come l'app).
// T1: Retry del two-phase — se lancia, aspetta 3s e ritenta UNA volta l'intero two-phase.
// Attende che il device torni raggiungibile (ping TCP), al massimo `maxMs`.
// Ritorna true se ha risposto, false se è scaduto il tempo.
async function waitForDevice(maxMs) {
  const pause = (ms) => new Promise(r => setTimeout(r, ms));
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      await xaquaClient.ping();
      return true;
    } catch (e) {
      await pause(2000);
    }
  }
  log.warn('api', 'waitForDevice: device ancora irraggiungibile', { maxMs });
  return false;
}

async function sendScheduleTwoPhase(schedule) {
  const pause = (ms) => new Promise(r => setTimeout(r, ms));
  const n = schedule.ColorTransitionList.length;

  async function executeTwoPhase() {
    // FASE 1: metadati
    await xaquaClient.setColorSchedule({ Steps: n, Period: schedule.Period || 86400 });
    await pause(500);

    // FASE 2: ogni transizione. Come l'app originale (LampCS.SetColorSchedule): fino a 3
    // tentativi per step e 1000ms dopo OGNI tentativo, riuscito o no.
    for (let i = 0; i < n; i++) {
      for (let attempt = 1; ; attempt++) {
        try {
          await xaquaClient.setColorScheduleTransition(i, schedule.ColorTransitionList[i]);
          await pause(1000);
          break;
        } catch (e) {
          await pause(1000);
          if (attempt >= 3) throw e;
          log.warn('api', 'sendScheduleTwoPhase: step fallito, ritento', { step: i, attempt, error: e.message });
        }
      }
    }
  }

  // L'INTERA sequenza gira dentro una transazione sulla coda del client: senza,
  // la coda serializza i singoli POST ma lascia la connessione libera tra uno step
  // e l'altro, e un poll qualunque (oscilloscopio, healthMonitor, watchdog, home)
  // si infila tra due SetColorScheduleTransition mandando in reboot il firmware.
  return xaquaClient.transaction(async () => {
    try {
      await executeTwoPhase();
    } catch (err) {
      log.warn('api', 'sendScheduleTwoPhase: primo tentativo fallito, attendo il device prima di ritentare', { error: err.message });
      // Se il firmware si è riavviato serve tempo prima che riaccetti connessioni:
      // ritentare subito lo martella mentre sta bootando. Attendi che risponda al ping
      // (max ~20s) invece di una pausa fissa.
      await pause(3000);
      await waitForDevice(20000);
      try {
        await executeTwoPhase();
      } catch (err2) {
        log.error('api', 'sendScheduleTwoPhase: fallito anche al retry', { error: err2.message });
        throw err2;
      }
    }
  });
}

// T2: Wrapper apply-and-record. Esegue il two-phase e salva lastApply + lastSchedule (atomico).
async function applyAndRecord(source, schedule, additionalMutator) {
  const steps = schedule.ColorTransitionList.length;
  try {
    await sendScheduleTwoPhase(schedule);
    await configStore.update(cfg => {
      cfg.lastSchedule = schedule.ColorTransitionList;
      cfg.lastApply = { at: new Date().toISOString(), source, steps, ok: true };
      if (additionalMutator) additionalMutator(cfg);
    });
  } catch (err) {
    await configStore.update(cfg => {
      cfg.lastApply = { at: new Date().toISOString(), source, steps, ok: false, error: err.message.slice(0, 200) };
      if (additionalMutator) additionalMutator(cfg);
    });
    throw err;
  }
}

// Ricompone la giornata salvata (reelState) per oggi (asset dinamici risolti col meteo/luna di
// adesso, cicli experimental attivi) e la
// invia registrandola come lastSchedule: watchdog e protezione termica devono vedere la
// giornata SCALATA, non quella piena. Ritorna null se non c'è ancora una giornata composta.
async function applyReelToday(source) {
  const { composeForToday } = require('../../services/experimental');
  const { liveConditions } = require('../../services/slotModels');
  const cfg = configStore.load();
  const reel = cfg.reelState;
  if (!reel || !Array.isArray(reel.selection) || !reel.selection.length) return null;
  const depth = reel.depth || (cfg.aquarium && cfg.aquarium.type) || 'SemiDeep';
  const sch = composeForToday(reel.selection, depth, cfg.experimental, new Date(), await liveConditions(reel.selection, cfg));
  await applyAndRecord(source, sch);
  await markDailySent();
  return { steps: sch.ColorTransitionList.length };
}

// Segna la giornata di oggi come inviata (solo a invio riuscito): lo scheduler reinvia in
// automatico solo quando experimental.dailyKey cambia rispetto a questo marker.
async function markDailySent(now = new Date()) {
  const { dailyKey } = require('../../services/experimental');
  await configStore.update((c) => { c.experimental = c.experimental || {}; c.experimental.lastTickDay = dailyKey(c, now); });
}

module.exports = { asyncHandler, castABWP, IP_REGEX, sendScheduleTwoPhase, applyAndRecord, applyReelToday, markDailySent };
