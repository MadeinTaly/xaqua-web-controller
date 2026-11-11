'use strict';

/**
 * Converte un orario HH:MM nella banda canonica.
 * Banda = fascia di durata variabile che raggruppa orari simili.
 */
function bandForTime(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  const mins = h * 60 + m;

  // Intervalli bandie: [start_mins, end_mins) → banda
  // Allineati ai preset dell'app originale: alba 09:00 = sunrise, 10:00 = morning, 11:00 = day.
  if (mins >= 5 * 60 && mins < 10 * 60) return 'sunrise';
  if (mins >= 10 * 60 && mins < 11 * 60) return 'morning';
  if (mins >= 11 * 60 && mins < 16 * 60) return 'day';
  if (mins >= 16 * 60 && mins < 19 * 60) return 'afternoon';
  if (mins >= 19 * 60 && mins < 20 * 60) return 'sunset';
  if (mins >= 20 * 60 && mins < 22 * 60) return 'evening';
  if (mins >= 22 * 60 || mins < 2 * 60) return 'night';
  if (mins >= 2 * 60 && mins < 5 * 60) return 'latenight';
  return null;
}

/**
 * Converte slot [{key, time, Amber, Blue, White, Power}] → firmware ColorSchedule
 * Gli slot vengono ordinati cronologicamente. L'ultimo slot ciclicamente punta al primo.
 */
function slotsToSchedule(slots) {
  if (!slots || !slots.length) return { Period: 86400, Steps: 0, ColorTransitionList: [] };
  const sorted = [...slots].sort((a, b) => {
    const [ah, am] = a.time.split(':').map(Number);
    const [bh, bm] = b.time.split(':').map(Number);
    return (ah * 60 + am) - (bh * 60 + bm);
  });
  const list = [];
  for (let i = 0; i < sorted.length; i++) {
    const s    = sorted[i];
    const next = sorted[(i + 1) % sorted.length];
    const [sh, sm] = s.time.split(':').map(Number);
    const [nh, nm] = next.time.split(':').map(Number);
    let deltaSec = ((nh * 60 + nm) - (sh * 60 + sm)) * 60;
    if (deltaSec <= 0) deltaSec += 86400;
    list.push({
      From: { Amber: s.Amber, Blue: s.Blue, White: s.White, Power: s.Power },
      To:   { Amber: next.Amber, Blue: next.Blue, White: next.White, Power: next.Power },
      DeltaSeconds: deltaSec,
      Time: '2015/12/01 - ' + s.time + ':01'
    });
  }
  return { Period: 86400, Steps: list.length, ColorTransitionList: list };
}

const DEFAULT_TIMEZONE = 'Europe/Rome';

/** Offset in minuti da UTC del fuso IANA a quell'istante (ora legale inclusa). Lancia RangeError se il fuso non esiste. */
function tzOffsetMinutes(timeZone, date = new Date()) {
  const p = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(date).forEach(x => { p[x.type] = x.value; });
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** Ora "dal web": header Date di una risposta HTTPS. Fallback all'orologio del server (NTP). */
async function webNow() {
  try {
    const r = await require('axios').head('https://www.google.com', { timeout: 4000 });
    const d = new Date(r.headers.date);
    if (!isNaN(d)) return { date: d, source: 'web' };
  } catch (e) { /* offline: orologio server */ }
  return { date: new Date(), source: 'server' };
}

// Ora della lampada SENZA chiederla al firmware: ora server + fuso del device. Vale perché
// la lampada viene risincronizzata ogni giorno (scheduler, sync-time con tolleranza 120s).
function lampClock(cfg, now = Date.now()) {
  const dev = (cfg && cfg.device) || {};
  let off = typeof dev.tzOffsetMinutes === 'number' ? dev.tzOffsetMinutes : 0;
  if (dev.timezone) { try { off = tzOffsetMinutes(dev.timezone, new Date(now)); } catch (e) { /* fuso non valido: offset salvato */ } }
  const daySec = Math.floor(((((now + off * 60000) % 86400000) + 86400000) % 86400000) / 1000);
  const p = (n) => String(n).padStart(2, '0');
  return { daySec, str: '2015/12/01 - ' + p(Math.floor(daySec / 3600)) + ':' + p(Math.floor(daySec / 60) % 60) + ':' + p(daySec % 60) };
}

module.exports = { slotsToSchedule, bandForTime, DEFAULT_TIMEZONE, tzOffsetMinutes, webNow, lampClock };
