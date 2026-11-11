'use strict';

const express = require('express');
const router = express.Router();
const log = require('../services/logger');
const configStore = require('../services/configStore');
const { registry, WledClient } = require('../services/wledClient');
const { discover } = require('../services/wledDiscovery');
const { nextSlot } = require('../services/wledScheduler');

const IP_REGEX = /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;

function reloadRegistry() {
  const config = configStore.load();
  const wled = config.wled || {};
  registry.setDevices(wled.devices || []);
}

// Inizializza registry al primo require
reloadRegistry();

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      log.error('wled-api', err.message);
      res.status(500).json({ ok: false, error: err.message });
    });
  };
}

// Lista dispositivi configurati con stato
router.get('/devices', asyncHandler(async (req, res) => {
  const statuses = await registry.listStatuses();
  res.json({ devices: statuses });
}));

// Aggiungi/aggiorna dispositivo
router.post('/devices', asyncHandler(async (req, res) => {
  const { id, name, ip, type } = req.body;
  if (!ip || !IP_REGEX.test(ip)) return res.json({ ok: false, error: 'IP non valido' });
  if (!name || !name.trim()) return res.json({ ok: false, error: 'Nome mancante' });

  const newId = id || ('wled-' + Date.now() + '-' + Math.random().toString(36).slice(2,6));
  const newDevice = {
    id: newId,
    name: name.trim().slice(0, 64),
    ip,
    type: type || 'cct'
  };

  await configStore.update(cfg => {
    if (!cfg.wled) cfg.wled = { devices: [] };
    if (!Array.isArray(cfg.wled.devices)) cfg.wled.devices = [];
    const devices = cfg.wled.devices;
    const idx = devices.findIndex(d => d.id === newId);
    if (idx >= 0) devices[idx] = newDevice;
    else          devices.push(newDevice);
  });

  reloadRegistry();
  res.json({ ok: true, device: newDevice });
}));

// Rimuovi dispositivo
router.post('/devices/delete', asyncHandler(async (req, res) => {
  const { id } = req.body;
  if (!id) return res.json({ ok: false, error: 'ID mancante' });

  const config = configStore.load();
  if (!config.wled || !Array.isArray(config.wled.devices)) {
    return res.json({ ok: false, error: 'Nessun dispositivo' });
  }
  const before = config.wled.devices.length;

  await configStore.update(cfg => {
    cfg.wled = cfg.wled || { devices: [] };
    cfg.wled.devices = (cfg.wled.devices || []).filter(d => d.id !== id);
  });

  const updatedConfig = configStore.load();
  if (updatedConfig.wled.devices.length === before) return res.json({ ok: false, error: 'Dispositivo non trovato' });
  reloadRegistry();
  res.json({ ok: true });
}));

// Discovery WLED: scansiona la rete e ritorna solo i dispositivi NON ancora aggiunti.
// Accetta optional `prefixes: ["192.168.1", "10.0.0"]` nel body per scan mirato.
router.post('/discover', asyncHandler(async (req, res) => {
  const config = configStore.load();
  const existingIps = new Set(
    ((config.wled && config.wled.devices) || []).map(d => d.ip)
  );
  const prefixes = Array.isArray(req.body && req.body.prefixes) && req.body.prefixes.length
    ? req.body.prefixes
    : null;
  try {
    const found = await discover(prefixes);
    const filtered = found.filter(d => !existingIps.has(d.ip));
    res.json({ ok: true, found: filtered, skippedExisting: found.length - filtered.length });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
}));

// Test connessione
router.post('/devices/test', asyncHandler(async (req, res) => {
  const { ip } = req.body;
  if (!ip || !IP_REGEX.test(ip)) return res.json({ ok: false, error: 'IP non valido' });
  const client = new WledClient(ip);
  const online = await client.ping();
  if (!online) return res.json({ ok: false, error: 'Dispositivo non raggiungibile' });
  try {
    const info = await client.getInfo(false);
    res.json({ ok: true, online: true, name: info.name, version: info.ver, ledCount: info.leds && info.leds.count });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
}));

// Stato singolo dispositivo
router.get('/:id/status', asyncHandler(async (req, res) => {
  const client = registry.get(req.params.id);
  if (!client) return res.status(404).json({ ok: false, error: 'Dispositivo non trovato' });
  const status = await client.getStatus();
  const device = registry.getDevice(req.params.id);
  res.json({ ...status, deviceName: device && device.name, type: device && device.type });
}));

// Power on/off
router.post('/:id/power', asyncHandler(async (req, res) => {
  const client = registry.get(req.params.id);
  if (!client) return res.status(404).json({ ok: false, error: 'Dispositivo non trovato' });
  await client.setOn(!!req.body.on);
  res.json({ ok: true });
}));

// Imposta colore bianco/blu (0-100) e brightness. { on?, white, blue, brightness? }
router.post('/:id/state', asyncHandler(async (req, res) => {
  const client = registry.get(req.params.id);
  if (!client) return res.status(404).json({ ok: false, error: 'Dispositivo non trovato' });
  await client.applyState({
    on: req.body.on,
    white: req.body.white,
    blue: req.body.blue,
    brightness: req.body.brightness
  });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Schedule WLED: lista slot per dispositivo (giornaliera, struttura simile a Xaqua)
// Persistente solo lato server, applicato via cron interno (sincronizzato col
// scheduler Xaqua per coerenza giornaliera).
// ---------------------------------------------------------------------------

router.get('/:id/schedule', asyncHandler(async (req, res) => {
  const config = configStore.load();
  const wled = config.wled || {};
  const schedules = wled.schedules || {};
  res.json({ slots: schedules[req.params.id] || [] });
}));

router.post('/:id/schedule', asyncHandler(async (req, res) => {
  const { slots } = req.body;
  if (!Array.isArray(slots)) return res.json({ ok: false, error: 'Slot non validi' });
  const clamp100 = (v) => Math.max(0, Math.min(100, parseInt(v) || 0));
  await configStore.update(cfg => {
    if (!cfg.wled) cfg.wled = { devices: [] };
    if (!cfg.wled.schedules) cfg.wled.schedules = {};
    cfg.wled.schedules[req.params.id] = slots.map(s => ({
      time: s.time,
      on: !!s.on,
      white: clamp100(s.white),
      blue: clamp100(s.blue),
      brightness: clamp100(s.brightness !== undefined ? s.brightness : 100)
    }));
  });
  res.json({ ok: true });
}));

// Prossimo slot programmato per il dispositivo (per la home)
router.get('/:id/next', asyncHandler(async (req, res) => {
  const config = configStore.load();
  const schedules = (config.wled && config.wled.schedules) || {};
  const slots = schedules[req.params.id] || [];
  const tzOff = (config.device && config.device.tzOffsetMinutes) || 0;
  res.json({ next: nextSlot(slots, new Date(), tzOff) });
}));

// Applica subito uno slot dello schedule (testing)
router.post('/:id/schedule/apply-slot', asyncHandler(async (req, res) => {
  const { slot } = req.body;
  if (!slot) return res.json({ ok: false, error: 'Slot mancante' });
  const client = registry.get(req.params.id);
  if (!client) return res.status(404).json({ ok: false, error: 'Dispositivo non trovato' });
  await client.applyState({ on: slot.on, white: slot.white, blue: slot.blue, brightness: slot.brightness });
  res.json({ ok: true });
}));

module.exports = { router };
