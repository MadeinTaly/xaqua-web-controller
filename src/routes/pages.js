'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const i18n = require('../i18n/it');
const configStore = require('../services/configStore');
const { PROFILES } = require('../services/presets');
const slotModels = require('../services/slotModels');

function render(res, view, extra = {}) {
  res.render(view, { i18n, ...extra });
}

// Cache-busting: mtime del JS della pagina come version.
function assetVersion(file) {
  try { return Math.floor(fs.statSync(path.join(__dirname, '../../public/js', file)).mtimeMs); } catch (e) { return Date.now(); }
}

router.get('/', (req, res) => render(res, 'home'));
router.get('/color', (req, res) => render(res, 'color'));
router.get('/schedule', (req, res) => {
  let depth = 'SemiDeep';
  try {
    const cfg = configStore.load();
    if (cfg.aquarium && PROFILES[cfg.aquarium.type]) depth = cfg.aquarium.type;
  } catch (e) {}
  render(res, 'schedule', {
    profiles: PROFILES,
    assetV: assetVersion('schedule-page.js'),
    sm: {
      depths:  slotModels.DEPTHS,
      fasce:   slotModels.FASCE,
      models:  slotModels.ASSETS,
      // Preset senza profondità propria → quella di Settings.
      presets: slotModels.PRESETS.map(p => ({ depth, ...p }))
    }
  });
});
for (const old of ['/transition', '/presets', '/nature', '/weather']) {
  router.get(old, (req, res) => res.redirect(301, '/schedule'));
}
router.get('/lampinfo', (req, res) => render(res, 'lampinfo'));
router.get('/wled', (req, res) => render(res, 'wled'));
router.get('/settings', (req, res) => render(res, 'settings'));
router.get('/logs', (req, res) => render(res, 'logs'));
router.get('/oscilloscope', (req, res) => render(res, 'oscilloscope', { assetV: assetVersion('oscilloscope.js') }));
router.get('/experimental', (req, res) => render(res, 'experimental', { assetV: assetVersion('experimental.js') }));

module.exports = router;
