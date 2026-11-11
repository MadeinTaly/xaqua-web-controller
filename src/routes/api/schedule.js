'use strict';

const express = require('express');
const router = express.Router();
const { asyncHandler, applyAndRecord, markDailySent } = require('./_shared');
const configStore = require('../../services/configStore');
const log = require('../../services/logger');
const { PROFILES } = require('../../services/presets');
const slotModels = require('../../services/slotModels');
const experimental = require('../../services/experimental');

// --- SLOT MACHINE (reel) ---
// Stato salvato della slot-machine: selezione reel + profondità.
router.get('/schedule/reels', asyncHandler(async (req, res) => {
  const config = configStore.load();
  const state = config.reelState && Array.isArray(config.reelState.selection) && config.reelState.selection.length
    ? config.reelState
    : { selection: slotModels.defaultSelection(), depth: (config.aquarium && config.aquarium.type) || 'SemiDeep' };
  // T2: Includi metadati lastApply nella risposta
  res.json({ ...state, selection: slotModels.normalizeSelection(state.selection), lastApply: config.lastApply || null });
}));

// Compone la selezione reel -> ColorTransitionList e la invia col two-phase ESISTENTE.
router.post('/schedule/compose', asyncHandler(async (req, res) => {
  // Selezioni del vecchio modello (colore dedotto dall'ora) -> asset fissi.
  const selection = slotModels.normalizeSelection(req.body.selection);

  if (!selection.length) {
    return res.json({ ok: false, error: 'Selezione vuota' });
  }

  const config = configStore.load();
  // Profondita' riassorbita dall'impostazione acquario (no selettore in schedule).
  // Profondita' sconosciuta (es. 'SoftReef' rimosso, salvato in reelState) → quella di Settings.
  const fallbackDepth = (config.aquarium && PROFILES[config.aquarium.type]) ? config.aquarium.type : 'SemiDeep';
  const depth = PROFILES[req.body.depth] ? req.body.depth : fallbackDepth;

  const live = await slotModels.liveConditions(selection, config);
  const schedule = experimental.composeForToday(selection, depth, config.experimental, new Date(), live);
  if (!schedule.ColorTransitionList.length) {
    return res.json({ ok: false, error: 'Composizione vuota' });
  }

  log.info('api', 'composeSchedule', { steps: schedule.Steps, depth, live });

  // T2: applyAndRecord (two-phase + metadati atomico) + persisti reelState
  await applyAndRecord('compose', schedule, (cfg) => {
    cfg.reelState = { selection, depth };
  });
  // Già inviata oggi (anche con meteo/luna reali): il reinvio automatico riparte da domani.
  await markDailySent();
  res.json({ ok: true, steps: schedule.Steps, selection });
}));

// Giornata tropicale casuale SENZA applicarla (anteprima: poi l'utente preme Applica).
router.get('/schedule/tropical/:variant', (req, res) => {
  const gen = slotModels.generateTropicalDay(req.params.variant === 'atoll' ? 'atoll' : 'reef');
  res.json({ ok: true, selection: gen.selection, label: gen.label });
});

// --- Preset giornata custom (creati dal wizard). Solo storage; il compose resta lo stesso. ---
router.get('/schedule/daypresets', asyncHandler(async (req, res) => {
  const config = configStore.load();
  res.json({ presets: (config.customDayPresets || []).map(p => ({ ...p, fasce: slotModels.normalizeSelection(p.fasce) })) });
}));

router.post('/schedule/daypresets', asyncHandler(async (req, res) => {
  const { name, fasce } = req.body;
  if (!name || typeof name !== 'string') return res.json({ ok: false, error: 'Nome mancante' });
  if (!Array.isArray(fasce) || fasce.length < 2) return res.json({ ok: false, error: 'Minimo 2 fasce' });
  const reTime = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const clean = [];
  for (const f of fasce) {
    if (!f || !reTime.test(f.time) || !f.modelId) return res.json({ ok: false, error: 'Fascia non valida' });
    const [norm] = slotModels.normalizeSelection([{ modelId: String(f.modelId), time: f.time }]);
    clean.push({ label: String(f.label || '').slice(0, 24), time: f.time, modelId: norm.modelId });
  }
  const times = clean.map(f => f.time);
  if (new Set(times).size !== times.length) return res.json({ ok: false, error: 'Orari duplicati' });
  const id = 'dp-' + Date.now().toString(36);
  await configStore.update(cfg => {
    cfg.customDayPresets = cfg.customDayPresets || [];
    cfg.customDayPresets.push({ id, name: name.slice(0, 40), fasce: clean });
  });
  res.json({ ok: true, id });
}));

router.delete('/schedule/daypresets/:id', asyncHandler(async (req, res) => {
  await configStore.update(cfg => {
    cfg.customDayPresets = (cfg.customDayPresets || []).filter(p => p.id !== req.params.id);
  });
  res.json({ ok: true });
}));

// PRESET
router.get('/presets', (req, res) => {
  const profiles = Object.entries(PROFILES).map(([key, p]) => ({
    key,
    name: p.name,
    uiName: p.uiName
  }));
  res.json(profiles);
});

module.exports = router;
