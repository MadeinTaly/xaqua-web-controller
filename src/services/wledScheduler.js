'use strict';

const log = require('./logger');
const configStore = require('./configStore');
const { registry } = require('./wledClient');
const { treatmentFactor, treatmentSummary } = require('./experimental');

let tickTimer = null;
let lastAppliedSlotByDevice = {};

function timeToMin(t) {
  if (!t) return -1;
  const m = t.match(/^(\d{2}):(\d{2})$/);
  return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : -1;
}

/**
 * Trova lo slot attivo per ora locale corrente (tz: utilizza il timezone del
 * container — assunto UTC come per il resto del sistema, con `nature.tzOffsetMinutes`
 * applicato se presente in config).
 */
function findActiveSlot(slots, now, tzOffsetMinutes = 0) {
  if (!slots || !slots.length) return null;
  const local = new Date(now.getTime() + tzOffsetMinutes * 60000);
  const currentMin = local.getUTCHours() * 60 + local.getUTCMinutes();
  const sorted = [...slots].sort((a, b) => timeToMin(a.time) - timeToMin(b.time));
  // L'ultimo slot con time <= currentMin; fallback all'ultimo (wrap mezzanotte)
  let active = sorted[sorted.length - 1];
  for (const s of sorted) {
    if (timeToMin(s.time) <= currentMin) active = s;
  }
  return active;
}

/**
 * Prossimo slot programmato dopo l'ora corrente (wrap a domani). Per la home.
 */
function nextSlot(slots, now = new Date(), tzOffsetMinutes = 0) {
  if (!slots || !slots.length) return null;
  const local = new Date(now.getTime() + tzOffsetMinutes * 60000);
  const currentMin = local.getUTCHours() * 60 + local.getUTCMinutes();
  const sorted = [...slots].sort((a, b) => timeToMin(a.time) - timeToMin(b.time));
  const future = sorted.find(s => timeToMin(s.time) > currentMin);
  return future || sorted[0]; // se nessuno oggi, il primo di domani
}

async function applyTick() {
  const config = configStore.load();
  if (!config || !config.wled || !config.wled.schedules) return;
  const tzOff = (config.device && config.device.tzOffsetMinutes) || 0;
  const now = new Date();
  const schedules = config.wled.schedules;

  for (const deviceId of Object.keys(schedules)) {
    const slots = schedules[deviceId];
    if (!slots || !slots.length) continue;
    const active = findActiveSlot(slots, now, tzOff);
    if (!active) continue;
    const key = `${deviceId}:${active.time}`;
    if (lastAppliedSlotByDevice[deviceId] === key) continue; // già applicato

    const client = registry.get(deviceId);
    if (!client) {
      log.warn('wled-scheduler', `device ${deviceId} not in registry, skip`);
      continue;
    }
    try {
      // Leggi config fresco per il treatment
      const freshConfig = configStore.load();
      let on = active.on;
      let white = active.white || 0;
      let blue = active.blue || 0;
      let brightness = active.brightness !== undefined ? active.brightness : 100;

      // Treatment sui WLED (solo se attivo: disattivato = comportamento normale)
      if (freshConfig && freshConfig.experimental && freshConfig.experimental.treatment && freshConfig.experimental.treatment.active) {
        const treatment = freshConfig.experimental.treatment;
        const summary = treatmentSummary(treatment, now);

        if (summary && summary.phase === 'blackout') {
          // Fase blackout: forza spento
          on = false;
          white = 0;
          blue = 0;
          brightness = 0;
        } else if (summary && summary.phase === 'recovery') {
          // Fase recovery: scala white/blue/brightness per il factor
          const factor = treatmentFactor(treatment, now);
          white = Math.round((white || 0) * factor);
          blue = Math.round((blue || 0) * factor);
          brightness = Math.round((brightness || 100) * factor);
          white = Math.max(0, Math.min(100, white));
          blue = Math.max(0, Math.min(100, blue));
          brightness = Math.max(0, Math.min(100, brightness));
        }
      }

      await client.applyState({ on, white, blue, brightness });
      lastAppliedSlotByDevice[deviceId] = key;
      log.info('wled-scheduler', `slot applied`, { deviceId, time: active.time });
    } catch (err) {
      log.warn('wled-scheduler', `apply failed`, { deviceId, error: err.message });
    }
  }
}

function start() {
  stop();
  // Tick ogni 60s — sufficiente per slot a granularità minuto
  tickTimer = setInterval(() => {
    applyTick().catch(err => log.error('wled-scheduler', 'tick failed', { error: err.message }));
  }, 60 * 1000);
  // Esecuzione immediata al boot
  applyTick().catch(err => log.error('wled-scheduler', 'initial tick failed', { error: err.message }));
}

function stop() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  lastAppliedSlotByDevice = {};
}

module.exports = { start, stop, findActiveSlot, nextSlot };
