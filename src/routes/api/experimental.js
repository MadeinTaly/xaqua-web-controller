'use strict';

const express = require('express');
const router = express.Router();
const { asyncHandler, applyReelToday } = require('./_shared');
const configStore = require('../../services/configStore');
const log = require('../../services/logger');
const experimental = require('../../services/experimental');

const NO_REEL = 'Nessuna giornata composta da scalare (apri Schedule e applica una volta)';

// --- EXPERIMENTAL: acclimatazione coralli (ramp intensità su settimane) ---
router.get('/experimental', (req, res) => {
  const config = configStore.load();
  const acc = (config.experimental && config.experimental.acclimation) || {};
  // Default a cyano/inattivo: la card UI deve esserci anche prima del primo ciclo
  const treatment = Object.assign({ type: 'cyano', active: false }, (config.experimental && config.experimental.treatment) || {});
  const treatmentSummary = experimental.treatmentSummary(treatment, new Date());
  res.json({
    acclimation: experimental.summary(acc, new Date()),
    treatment: treatmentSummary,
    // T2: Se treatment è done, includilo nel summary così la UI lo mostra
    treatmentCompleted: !!(treatment.active && treatmentSummary && treatmentSummary.phase === 'done')
  });
});

// Salva lo stato del ciclo e, se apply=true, ricompone reelState scalato e lo invia (two-phase).
router.post('/experimental/acclimation', asyncHandler(async (req, res) => {
  const { active, weeks, startPct, day, apply } = req.body;
  await configStore.update(cfg => {
    cfg.experimental = cfg.experimental || {};
    const acc = cfg.experimental.acclimation || {};
    if (weeks !== undefined) acc.weeks = experimental.clampInt(weeks, 1, 26);
    if (startPct !== undefined) acc.startPct = experimental.clampInt(startPct, 5, 100);
    if (day !== undefined) acc.startDate = experimental.startDateForDay(day, new Date());
    else if (!acc.startDate) acc.startDate = experimental.startDateForDay(1, new Date());
    if (active !== undefined) acc.active = !!active;
    cfg.experimental.acclimation = acc;
  });

  const applied = apply ? await applyReelToday('acclimation') : null;
  const config = configStore.load();
  const acc = (config.experimental && config.experimental.acclimation) || {};
  const summary = experimental.summary(acc, new Date());
  if (apply && !applied) return res.json({ ok: false, error: NO_REEL, summary });
  if (applied) log.info('api', 'acclimation apply', { steps: applied.steps, factorPct: summary.factorPct });
  res.json({ ok: true, summary, applied });
}));

// Trattamento alghe (dinoflagellati e cianobatteri)
router.post('/experimental/treatment', asyncHandler(async (req, res) => {
  const { active, type, day, apply } = req.body;

  // Valida il tipo di trattamento
  if (type !== undefined && !['cyano', 'dino'].includes(type)) {
    return res.json({ ok: false, error: 'Tipo di trattamento non valido (cyano|dino)' });
  }

  await configStore.update(cfg => {
    cfg.experimental = cfg.experimental || {};
    let treatment = cfg.experimental.treatment || {};
    if (type !== undefined) treatment.type = type;
    if (day !== undefined) {
      treatment.startDate = experimental.startDateForDay(day, new Date());
    } else if (!treatment.startDate) {
      treatment.startDate = experimental.startDateForDay(1, new Date());
    }
    if (active !== undefined) treatment.active = !!active;
    cfg.experimental.treatment = treatment;
  });

  const applied = apply ? await applyReelToday('treatment') : null;
  const config = configStore.load();
  const treatment = config.experimental && config.experimental.treatment;
  const summary = experimental.treatmentSummary(treatment, new Date());
  if (apply && !applied) return res.json({ ok: false, error: NO_REEL, summary });
  if (applied) log.info('api', 'treatment apply', { type: treatment.type, steps: applied.steps, phase: summary.phase, factorPct: summary.factorPct });
  res.json({ ok: true, summary, applied });
}));

module.exports = router;
