'use strict';

/**
 * Jest setup file: crea una directory temp per-worker e configura XAQUA_CONFIG_PATH
 * prima che qualunque modulo src venga richiesto.
 *
 * Questo isola completamente i test dal file reale data/config.json e consente
 * l'esecuzione parallela senza flakiness o race condition.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Crea una directory temporanea per questo worker (process.pid è diverso per ogni worker jest)
const tmpDir = path.join(os.tmpdir(), `xaqua-test-${process.pid}`);
const tmpConfigPath = path.join(tmpDir, 'config.json');

// Assicurati che la directory esista
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

// Copia il fixture nel path temporaneo
const fixtureSource = path.join(__dirname, 'fixtures', 'config.json');
try {
  const fixtureData = fs.readFileSync(fixtureSource, 'utf8');
  fs.writeFileSync(tmpConfigPath, fixtureData);
} catch (e) {
  console.error('Failed to copy fixture config:', e.message);
  throw e;
}

// Setta l'env PRIMA che qualunque modulo src legga config
process.env.XAQUA_CONFIG_PATH = tmpConfigPath;
// Guardia: se un test importa app.js, watchdog e timer non devono partire
process.env.NODE_ENV = 'test';

// Cleanup on process exit (non durante jest, ma dopo)
process.on('exit', () => {
  try {
    if (fs.existsSync(tmpConfigPath)) {
      fs.unlinkSync(tmpConfigPath);
    }
    if (fs.existsSync(tmpDir)) {
      fs.rmdirSync(tmpDir);
    }
  } catch (e) {
    // Silenzioso: il file potrebbe essere già stato cancellato da un altro test
  }
});
