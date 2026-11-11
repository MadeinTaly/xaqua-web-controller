'use strict';

const log = require('./logger');
const configStore = require('./configStore');
const { expectedAt } = require('./oscilloscopeHelper');
const { lampClock } = require('./scheduleUtils');
const { addNotification } = require('./notifications');

let deviationCounterAboveThreshold = 0;

/**
 * Watchdog schedule: il colore live corrisponde all'atteso dalla schedule?
 * NESSUNA chiamata propria al firmware (decisione utente 2026-11-02: meno chiamate possibili,
 * le request in eccesso mandano in crisi il firmware): riceve il colore già letto dal giro
 * di healthMonitor e usa l'ora calcolata dal server (lampClock) invece di GetTime.
 * Se deviation > 12 per DUE campioni consecutivi: solo log + notifica, nessun reinvio
 * (la schedule si invia solo su azione dell'utente, decisione 2026-10-23).
 *
 * NOTA powerScale: config.lastSchedule è PRE-scala, il firmware (e getColorSchema) lavora
 * su valori GIÀ scalati → l'atteso va scalato per config.powerScale/100.
 */
function scaleExpected(c, powerScale) {
  const s = (typeof powerScale === 'number' ? Math.max(0, Math.min(100, powerScale)) : 100) / 100;
  return {
    Amber: Math.round((c.Amber || 0) * s),
    Blue:  Math.round((c.Blue  || 0) * s),
    White: Math.round((c.White || 0) * s),
    Power: Math.round((c.Power || 0) * s)
  };
}

function check(currentColor, now = Date.now()) {
  try {
    const config = configStore.load();
    const { isProtectionActive } = require('./healthMonitor');
    // Skip: nessuna schedule, lampada spenta apposta, protezione termica (falso "fuori schedule").
    if (!currentColor || !config.lastSchedule || !config.lastSchedule.length || config.lampOff || isProtectionActive()) return;

    const expectedRaw = expectedAt(config.lastSchedule, lampClock(config, now).daySec);
    if (!expectedRaw) return;
    const expectedColor = scaleExpected(expectedRaw, config.powerScale);

    // Deviation = max scarto assoluto sui 4 canali
    const deviation = Math.max(
      Math.abs(currentColor.Amber - expectedColor.Amber),
      Math.abs(currentColor.Blue - expectedColor.Blue),
      Math.abs(currentColor.White - expectedColor.White),
      Math.abs(currentColor.Power - expectedColor.Power)
    );

    if (deviation > 12) {
      deviationCounterAboveThreshold++;
      log.warn('watchdog', 'deviation above threshold', { deviation, counter: deviationCounterAboveThreshold, currentColor, expectedColor });
      if (deviationCounterAboveThreshold === 2) {
        log.error('watchdog', 'Lampada fuori schedule (deviation persists)', { deviation, currentColor, expectedColor });
        addNotification('warning', 'Lampada fuori schedule: riapplica la giornata da Schedule', {
          deviation: Math.round(deviation),
          currentColor,
          expectedColor
        });
      }
    } else if (deviationCounterAboveThreshold > 0) {
      log.info('watchdog', 'Lampada rientrata in schedule', { deviation, previousCounter: deviationCounterAboveThreshold });
      deviationCounterAboveThreshold = 0;
    }
  } catch (err) {
    log.error('watchdog', 'check error', { error: err.message });
  }
}

module.exports = { check };
