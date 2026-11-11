'use strict';

const log = require('./logger');
const configStore = require('./configStore');

const xaquaClient = require('./xaquaClient');
const { addNotification } = require('./notifications');

// Stesso two-phase (transazione, delay, retry) di routes/api/_shared: una sola implementazione.
const { applyReelToday } = require('../routes/api/_shared');
const experimental = require('./experimental');

// --- Invio automatico giornaliero (al massimo UNO al giorno) ---
// dailyKey cambiato = è avanzato un ciclo experimental (Power scalato, fotoperiodo ridotto) e/o
// è un nuovo giorno con asset dinamici (meteo/luna reali): ricompone reelState per oggi e lo
// reinvia. applyReelToday segna il marker solo a invio riuscito, altrimenti si ritenta al giro dopo.
async function runDailyTick(dayKey) {
  try {
    const source = dayKey.startsWith('tr:') ? 'treatment-tick' : dayKey.startsWith('acc:') ? 'acclimation-tick' : 'dynamic-daily';
    log.info('scheduler', source, { day: dayKey });
    if (!(await applyReelToday(source))) return;
    // Ciclo di trattamento terminato: disattiva e notifica
    const treatment = configStore.load().experimental.treatment;
    if (source === 'treatment-tick' && experimental.treatmentSummary(treatment, new Date()).phase === 'done') {
      await configStore.update(c => { c.experimental.treatment.active = false; });
      const typeLabel = treatment.type === 'cyano' ? 'cianobatteri' : 'dinoflagellati';
      addNotification('info', `Trattamento ${typeLabel} completato: luce tornata al 100%`);
      log.info('scheduler', 'treatment completed', { type: treatment.type });
    }
  } catch (e) {
    log.error('scheduler', 'daily tick failed', { day: dayKey, error: e.message });
  }
}


async function runSyncTimeTick() {
  try {
    const cfg = configStore.load();
    let tzOffsetMinutes = cfg.device && cfg.device.tzOffsetMinutes;
    // Col fuso IANA l'offset si ricalcola: al cambio ora legale/solare segue da solo.
    if (cfg.device && cfg.device.timezone) {
      const { tzOffsetMinutes: offsetOf } = require('./scheduleUtils');
      tzOffsetMinutes = offsetOf(cfg.device.timezone);
      if (tzOffsetMinutes !== cfg.device.tzOffsetMinutes) {
        await configStore.update(c => { c.device.tzOffsetMinutes = tzOffsetMinutes; });
        log.info('scheduler', 'sync-time: offset aggiornato dal fuso', { timezone: cfg.device.timezone, tzOffsetMinutes });
      }
    }

    if (tzOffsetMinutes === undefined) {
      log.debug('scheduler', 'sync-time tick skipped: tzOffsetMinutes not configured');
      return;
    }

    // Leggi ora lampada
    let lampTimeStr;
    try {
      lampTimeStr = await xaquaClient.getTime();
    } catch (err) {
      log.warn('scheduler', 'sync-time: getTime failed', { error: err.message });
      return;
    }

    // Parseggia formato "2015/12/02 - HH:MM:SS"
    const m = lampTimeStr.match(/(\d{2}):(\d{2}):(\d{2})/);
    if (!m) {
      log.warn('scheduler', 'sync-time: lampTime parsing failed', { lampTimeStr });
      return;
    }

    const lampH = parseInt(m[1], 10);
    const lampMin = parseInt(m[2], 10);
    const lampSec = parseInt(m[3], 10);
    const lampTotalSec = lampH * 3600 + lampMin * 60 + lampSec;

    // Ora attesa locale (container UTC + offset)
    const now = new Date();
    const utcTotalSec = now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();
    const localTotalSec = utcTotalSec + tzOffsetMinutes * 60;
    // Normalizza nel range [0, 86400)
    const expectedTotalSec = ((localTotalSec % 86400) + 86400) % 86400;

    // Calcola drift
    let drift = lampTotalSec - expectedTotalSec;
    // Gestisci wrap-around: se drift > 12h, sottrai 24h; se drift < -12h, aggiungi 24h
    if (drift > 43200) drift -= 86400;
    if (drift < -43200) drift += 86400;

    log.debug('scheduler', 'sync-time tick', {
      lampTime: lampTimeStr,
      lampSec: lampTotalSec,
      expectedSec: expectedTotalSec,
      driftSec: drift
    });

    // Se drift > 120s, sincronizza
    if (Math.abs(drift) > 120) {
      log.info('scheduler', 'sync-time: correcting drift', { driftSec: drift });
      // Replica la logica da POST /lampinfo/sync-time: usa l'offset in secondi
      await xaquaClient.syncTime(tzOffsetMinutes * 60);
    } else {
      log.debug('scheduler', 'sync-time: drift within tolerance', { driftSec: drift });
    }
  } catch (err) {
    log.error('scheduler', 'sync-time tick failed', { error: err.message });
  }
}

// Manutenzione: UN loop ogni 30' al posto di setInterval fissi da 6h/24h contati dal boot.
// La lampada è su una presa smart (alimentata solo qualche ora al giorno): un timer da 24h
// partito alle 17 cade SEMPRE a lampada spenta e il ciclo di acclimatazione/trattamento non
// avanza mai. Qui invece: se la lampada risponde al ping si fa ciò che è "dovuto":
//  1. dailyKey cambiato (ciclo experimental avanzato / nuovo giorno con meteo-luna reali) ->
//     ricomponi e applica (una volta al giorno);
//  2. sync-time una volta ogni 24h.
// La schedule NON si reinvia periodicamente (niente keepalive, decisione utente 2026-10-23):
// si invia solo su azione dell'utente, o una volta al giorno se c'è un ciclo experimental attivo
// o la giornata salvata ha asset dinamici.
const MAINT_INTERVAL_MS = 30 * 60 * 1000;
let maintTimer = null;
let lastSyncAt = 0;
async function runMaintenanceTick() {
  try {
    const cfg = configStore.load();
    const { isProtectionActive, getLatest } = require('./healthMonitor');
    if (cfg.lampOff || isProtectionActive()) return;
    const now = new Date();
    const dayKey = experimental.dailyKey(cfg, now);
    const dailyDue = dayKey && dayKey !== (cfg.experimental && cfg.experimental.lastTickDay);
    const syncDue = Date.now() - lastSyncAt >= 24 * 3600 * 1000;
    if (!dailyDue && !syncDue) return; // niente da fare: nessuna chiamata
    // Raggiungibilità dall'ultimo giro di healthMonitor (nessun ping proprio).
    const latest = getLatest();
    if (!latest.ok || Date.now() - latest.at > 5 * 60 * 1000) return;

    if (dailyDue) await runDailyTick(dayKey);

    if (syncDue) {
      lastSyncAt = Date.now();
      await runSyncTimeTick();
    }
  } catch (e) {
    log.error('scheduler', 'maintenance tick failed', { error: e.message });
  }
}

function startAcclimation() {
  if (maintTimer) clearInterval(maintTimer);
  // Primo giro dopo 30' (non al boot: un restart non deve riapplicare subito)
  maintTimer = setInterval(runMaintenanceTick, MAINT_INTERVAL_MS);
  log.info('scheduler', 'maintenance loop attivo', { everyMinutes: MAINT_INTERVAL_MS / 60000 });
}

module.exports = { startAcclimation, runMaintenanceTick };
