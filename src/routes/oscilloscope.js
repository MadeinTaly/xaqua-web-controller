'use strict';

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { expectedAt } = require('../services/oscilloscopeHelper');
const { lampClock } = require('../services/scheduleUtils');
const healthMonitor = require('../services/healthMonitor');
const log = require('../services/logger');

const configStore = require('../services/configStore');

function loadConfig() {
  try {
    return configStore.load();
  } catch (e) {
    log.error('oscilloscope', 'Errore caricamento config:', e.message);
    return { lastSchedule: [] };
  }
}

// GET /api/oscilloscope/sample
// Confronta l'ultimo colore letto da healthMonitor (giro ogni 60s) con l'atteso dal lastSchedule.
// Nessuna chiamata al firmware: prima erano 2 ogni 15s a pagina aperta.
// Response: {
//   lampTime: "2015/12/01 - HH:MM:SS",
//   current: {A, B, W, P},
//   expected: {A, B, W, P} | null,
//   deviation: numero,
//   ok: boolean
// }
router.get('/sample', async (req, res) => {
  try {
    const tolerance = Math.max(0, Math.min(100, parseInt(req.query.tol) || 8));
    const config = loadConfig();

    const latest = healthMonitor.getLatest();
    const current = latest.ok ? latest.color : null;
    const lampTime = latest.at ? lampClock(config, latest.at).str : null;

    if (!current) {
      return res.status(500).json({
        ok: false,
        error: 'Impossibile leggere il colore dalla lampada'
      });
    }

    if (!lampTime) {
      return res.status(500).json({
        ok: false,
        error: 'Impossibile leggere l\'ora della lampada'
      });
    }

    // Estrai i secondi dalla mezzanotte dall'ora della lampada
    const timeMatch = lampTime.match(/(\d{2}):(\d{2}):(\d{2})/);
    if (!timeMatch) {
      return res.status(500).json({
        ok: false,
        error: 'Formato ora lampada non valido'
      });
    }

    const h = parseInt(timeMatch[1], 10);
    const m = parseInt(timeMatch[2], 10);
    const s = parseInt(timeMatch[3], 10);
    const daySec = h * 3600 + m * 60 + s;

    // Calcola il valore atteso dal lastSchedule, scalato per powerScale: il client
    // scala From/To all'invio, quindi il firmware (e getColorSchema) lavora su valori
    // già scalati, mentre lastSchedule è pre-scala.
    const lastSchedule = config.lastSchedule || [];
    const expectedRaw = expectedAt(lastSchedule, daySec);
    const ps = (typeof config.powerScale === 'number' ? Math.max(0, Math.min(100, config.powerScale)) : 100) / 100;
    const expected = expectedRaw ? {
      Amber: Math.round((expectedRaw.Amber || 0) * ps),
      Blue:  Math.round((expectedRaw.Blue  || 0) * ps),
      White: Math.round((expectedRaw.White || 0) * ps),
      Power: Math.round((expectedRaw.Power || 0) * ps)
    } : null;

    // Calcola la deviazione
    let deviation = 0;
    if (expected) {
      const diffs = [
        Math.abs(current.Amber - expected.Amber),
        Math.abs(current.Blue - expected.Blue),
        Math.abs(current.White - expected.White),
        Math.abs(current.Power - expected.Power)
      ];
      deviation = Math.max(...diffs);
    }

    const ok = !expected || deviation <= tolerance;

    res.json({
      lampTime,
      current: {
        A: current.Amber,
        B: current.Blue,
        W: current.White,
        P: current.Power
      },
      expected: expected ? {
        A: expected.Amber,
        B: expected.Blue,
        W: expected.White,
        P: expected.Power
      } : null,
      deviation,
      ok
    });
  } catch (err) {
    log.error('oscilloscope', 'Errore /sample:', err.message);
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

module.exports = router;
