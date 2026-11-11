'use strict';

const express = require('express');
const router = express.Router();
const { asyncHandler, castABWP, IP_REGEX } = require('./_shared');
const xaquaClient = require('../../services/xaquaClient');
const configStore = require('../../services/configStore');
const log = require('../../services/logger');
const { PROFILES } = require('../../services/presets');
const { DEFAULT_TIMEZONE, tzOffsetMinutes, webNow, lampClock } = require('../../services/scheduleUtils');
const healthMonitor = require('../../services/healthMonitor');
const { addNotification, getNotifications, clearNotifications } = require('../../services/notifications');

// HEALTH — per watchdog/monitor. Niente chiamate al firmware (cheap, pollabile).
router.get('/health', (req, res) => {
  let configOk = true, wledCount = 0, city = null;
  try {
    const c = configStore.load();
    wledCount = (c.wled && Array.isArray(c.wled.devices)) ? c.wled.devices.length : 0;
    city = c.weather && c.weather.city || null;
  } catch (e) { configOk = false; }
  res.json({
    ok: configOk,
    uptimeSec: Math.round(process.uptime()),
    wledDevices: wledCount,
    weatherCity: city
  });
});

// Nome lampada senza chiamare il firmware: ultima GetLampInfo in cache o nome salvato.
function lampName(cfg) {
  const info = xaquaClient.cachedLampInfo();
  return (info && info.Name) || (cfg.device && cfg.device.Name) || (cfg.lampinfo && cfg.lampinfo.Name) || null;
}

// PING — dall'ultimo giro di healthMonitor, nessuna chiamata al firmware (pollato da ogni pagina).
router.get('/ping', (req, res) => {
  const latest = healthMonitor.getLatest();
  const online = latest.ok && Date.now() - latest.at < 3 * 60 * 1000;
  res.json({ online, name: online ? lampName(configStore.load()) : null, at: latest.at || null });
});

// HOME — di default dall'ultimo giro di healthMonitor (nessuna chiamata). ?fresh=1 (bottone
// Aggiorna, azione utente) legge davvero dal firmware.
router.get('/home', asyncHandler(async (req, res) => {
  if (!req.query.fresh) {
    const cfg = configStore.load();
    const latest = healthMonitor.getLatest();
    const name = lampName(cfg);
    return res.json({
      info: name ? { Name: name } : null,
      status: latest.ok ? latest.status : null,
      color: latest.ok ? latest.color : null,
      time: latest.ok ? lampClock(cfg).str : null,
      at: latest.at || null,
      isNight: xaquaClient.isNightTime(),
      lampOff: !!cfg.lampOff
    });
  }
  // Un'unica transazione con letture sequenziali: il firmware regge una connessione
  // alla volta e nulla deve intercalarsi tra le letture dello stesso snapshot.
  const snapshot = await xaquaClient.transaction(async () => {
    let full = {}, time = null;
    try { full = await xaquaClient.getFullStatus(); } catch (e) { full = {}; }
    try { time = await xaquaClient.getTime(); } catch (e) { time = null; }
    return { full, time };
  });
  const full = snapshot.full || {};
  const time = snapshot.time;
  const power = { lampOff: !!configStore.load().lampOff };
  res.json({
    info: full.info || null,
    status: full.status || null,
    color: full.color || null,
    time,
    isNight: xaquaClient.isNightTime(),
    lampOff: power.lampOff || false
  });
}));

// STATUS
router.get('/status', asyncHandler(async (req, res) => {
  const data = await xaquaClient.getFullStatus();
  const isNight = xaquaClient.isNightTime();
  res.json({ ...data, isNight });
}));

// COLORE
router.get('/color', asyncHandler(async (req, res) => {
  const color = await xaquaClient.getColorSchema();
  res.json(color);
}));

router.post('/color', asyncHandler(async (req, res) => {
  const color = castABWP(req.body);
  log.info('api', 'setColor', color);
  await xaquaClient.setColorSchema(color);
  res.json({ ok: true });
}));

// INFO LAMPADA
router.get('/lampinfo', asyncHandler(async (req, res) => {
  // Letture sequenziali in transazione (una connessione alla volta sul firmware).
  const data = await xaquaClient.transaction(async () => {
    const safe = async (fn) => { try { return await fn(); } catch (e) { return null; } };
    return {
      info:   await safe(() => xaquaClient.getLampInfo()),
      status: await safe(() => xaquaClient.getLampStatus()),
      time:   await safe(() => xaquaClient.getTime())
    };
  });
  res.json(data);
}));

router.post('/lampinfo', asyncHandler(async (req, res) => {
  // Salva localmente
  await configStore.update(cfg => {
    if (!cfg.lampinfo) cfg.lampinfo = {};
    if (req.body.Name)         cfg.lampinfo.Name         = req.body.Name;
    if (req.body.AquariumName) cfg.lampinfo.AquariumName = req.body.AquariumName;
    if (!cfg.device) cfg.device = {};
    if (req.body.Name)         cfg.device.Name           = req.body.Name;
  });
  // Tenta di aggiornare il firmware (ignorando timeout)
  try {
    await xaquaClient.setLampInfo(req.body);
  } catch(e) {
    // timeout o errore firmware — salvato localmente, restituiamo ok
  }
  res.json({ ok: true });
}));

router.post('/lampinfo/sync-time', asyncHandler(async (req, res) => {
  const config = configStore.load();
  const { time } = req.body; // HH:MM opzionale per impostazione manuale

  if (time) {
    await xaquaClient.syncTime(undefined, time);
    res.json({ ok: true, manual: true, time });
    return;
  }

  const timezone = req.body.timezone || (config.device && config.device.timezone) || DEFAULT_TIMEZONE;
  let offsetMin;
  const { date, source } = await webNow();
  try { offsetMin = tzOffsetMinutes(timezone, date); }
  catch (e) { return res.status(400).json({ error: 'Fuso orario non valido: ' + timezone }); }

  await xaquaClient.syncTime(offsetMin * 60, undefined, date.getTime());
  await configStore.update(cfg => {
    if (!cfg.device) cfg.device = {};
    cfg.device.timezone = timezone;
    cfg.device.tzOffsetMinutes = offsetMin;
  });
  log.info('api', 'sync-time', { timezone, offsetMin, source });
  res.json({ ok: true, timezone, offsetMinutes: offsetMin, source });
}));

// HEALTH MONITOR - storico temperatura e ventola
router.get('/lampstatus/history', (req, res) => {
  const healthMonitor = require('../../services/healthMonitor');
  const data = healthMonitor.getHistory();
  res.json(data);
});

// IMPOSTAZIONI
router.get('/settings', (req, res) => {
  const config = configStore.load();
  const safe = JSON.parse(JSON.stringify(config));
  if (safe.device) {
    delete safe.device.username;
    delete safe.device.password;
  }
  // Maschera la apiKey: rivela presenza ma non il valore
  if (safe.weather && safe.weather.apiKey) {
    safe.weather.apiKeySet = true;
    delete safe.weather.apiKey;
  }
  res.json(safe);
});

router.post('/settings', asyncHandler(async (req, res) => {
  const { device, weather, aquarium } = req.body;
  if (device && device.ip) {
    if (!IP_REGEX.test(device.ip)) {
      return res.json({ ok: false, error: 'IP non valido' });
    }
  }
  if (aquarium && aquarium.type) {
    if (!PROFILES[aquarium.type]) {
      return res.json({ ok: false, error: 'Tipo acquario non valido' });
    }
  }

  const config = await configStore.update(cfg => {
    if (device) {
      if (device.ip) {
        cfg.device = cfg.device || {};
        cfg.device.ip = device.ip;
      }
    }
    if (weather) {
      cfg.weather = cfg.weather || {};
      if (weather.city) cfg.weather.city = weather.city;
      if (weather.apiKey) cfg.weather.apiKey = weather.apiKey;
    }
    if (aquarium && aquarium.type) {
      cfg.aquarium = cfg.aquarium || {};
      cfg.aquarium.type = aquarium.type;
    }
    if (req.body.powerScale !== undefined) {
      cfg.powerScale = Math.max(0, Math.min(100, parseInt(req.body.powerScale) || 100));
    }
  });

  if (req.body.powerScale !== undefined) {
    xaquaClient.setPowerScale(config.powerScale);
  }
  xaquaClient.setConfig(
    config.device.ip,
    process.env.DEVICE_USERNAME || 'Admin',
    process.env.DEVICE_PASSWORD || 'Admin'
  );
  res.json({ ok: true });
}));

router.post('/settings/test-connection', asyncHandler(async (req, res) => {
  let reachable = false;
  let authenticated = false;
  try {
    await xaquaClient.ping();
    reachable = true;
    await xaquaClient.login();
    authenticated = true;
    res.json({ ok: true, connected: true, reachable: true, authenticated: true });
  } catch (err) {
    res.json({ ok: false, connected: false, reachable, authenticated, error: err.message });
  }
}));

router.post('/settings/change-password', asyncHandler(async (req, res) => {
  const { oldPsw, newPsw } = req.body;
  if (!newPsw || typeof newPsw !== 'string' || newPsw.length < 4 || newPsw.length > 32) {
    return res.json({ ok: false, error: 'Password non valida (4-32 caratteri)' });
  }
  const config = configStore.load();
  await xaquaClient.setCredential(config.device.username, oldPsw, newPsw);
  // La password sul device deve restare sincronizzata col file di config per consentire
  // i login successivi. Il file è scritto con permission 600 dal container e non viene
  // esposto da GET /settings. In produzione, valutare l'uso di DEVICE_PASSWORD env var.
  await configStore.update(cfg => {
    if (!cfg.device) cfg.device = {};
    cfg.device.password = newPsw;
  });
  // Riconfigura il client subito per non lasciarlo con la pwd vecchia in memoria
  xaquaClient.setConfig(config.device.ip, config.device.username || 'Admin', newPsw);
  res.json({ ok: true });
}));

router.post('/settings/enable-login', asyncHandler(async (req, res) => {
  const { isEnabled } = req.body;
  await xaquaClient.enableLogin(isEnabled);
  res.json({ ok: true });
}));

// POWER ON/OFF
router.get('/power', (req, res) => {
  const config = configStore.load();
  res.json({
    lampOff: !!config.lampOff,
    lastColorBeforeOff: config.lastColorBeforeOff || null
  });
});

router.post('/power', asyncHandler(async (req, res) => {
  const { on } = req.body;
  log.info('api', 'power', { on, lampOff: !on });
  const config = configStore.load();

  if (!on) {
    // OFF: salva colore attuale, spegne, ferma scheduler
    let currentColor = null;
    try { currentColor = await xaquaClient.getColorSchema(); } catch(e) {}
    await configStore.update(cfg => {
      cfg.lastColorBeforeOff = currentColor;
      cfg.lampOff = true;
    });
    // Azzera sia il colore istantaneo che lo schedule nel firmware
    await xaquaClient.setColorSchema({ Amber: 0, Blue: 0, White: 0, Power: 0 });
    const zeroSlots = [
      { key: 'off', time: '00:00', Amber: 0, Blue: 0, White: 0, Power: 0 },
      { key: 'off2', time: '12:00', Amber: 0, Blue: 0, White: 0, Power: 0 }
    ];
    const zeroSchedule = require('../../services/scheduleUtils').slotsToSchedule(zeroSlots);
    // Two-phase con i delay obbligatori (helper condiviso, include retry)
    await require('./_shared').sendScheduleTwoPhase(zeroSchedule);
  } else {
    // ON: ripristina colore e riavvia scheduler
    const colorToRestore = config.lastColorBeforeOff || { Amber: 0, Blue: 100, White: 0, Power: 100 };
    await configStore.update(cfg => {
      cfg.lampOff = false;
    });
    await xaquaClient.setColorSchema(colorToRestore);
    // Lo spegnimento ha caricato nel firmware una zero-schedule: senza reinviare
    // lastSchedule la lampada torna a 0 al primo step e resta spenta (nessun invio automatico
    // la rimette in pari). È un'azione utente, quindi il reinvio qui è lecito.
    const list = config.lastSchedule || [];
    if (list.length) {
      await require('./_shared').applyAndRecord('power-on', { Period: 86400, Steps: list.length, ColorTransitionList: list });
    }
  }
  res.json({ ok: true, lampOff: !on });
}));


// Notification API
router.get('/notifications', (req, res) => {
  const { since } = req.query;
  res.json({ notifications: getNotifications(since) });
});

router.post('/notifications/clear', (req, res) => {
  clearNotifications();
  res.json({ ok: true });
});

// Log di sistema (ultimi 300, persistiti su xaqua.log) — diagnostica sotto Impostazioni.
router.get('/logs', (req, res) => {
  res.json({ logs: log.getLogs(req.query.level) });
});
// Storico completo (JSONL, una voce per riga): sopravvive a restart e deploy.
router.get('/logs/file', (req, res) => {
  res.download(log.logFile(), 'xaqua.log', (err) => { if (err && !res.headersSent) res.status(404).json({ error: 'nessun log su disco' }); });
});
router.post('/logs/clear', (req, res) => {
  log.clearLogs();
  res.json({ ok: true });
});

module.exports = router;
