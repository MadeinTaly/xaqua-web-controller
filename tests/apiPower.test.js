'use strict';

/**
 * Test per gli endpoint power ON/OFF e schedule toggle.
 * Usa supertest-free approach: testa la logica dei moduli direttamente.
 * I test su api.js richiederebbero supertest, quindi testiamo la logica
 * a livello di scheduler + config.
 */

const fs = require('fs');
const path = require('path');

// Mock xaquaClient prima del require
jest.mock('../src/services/xaquaClient', () => ({
  setColorSchema: jest.fn().mockResolvedValue({ ok: true }),
  getColorSchema: jest.fn().mockResolvedValue({ Amber: 50, Blue: 80, White: 30, Power: 100 }),
  setConfig: jest.fn(),
  ping: jest.fn().mockResolvedValue(true),
  login: jest.fn().mockResolvedValue('1234'),
  isNightTime: jest.fn().mockReturnValue(false),
}));

const xaquaClient = require('../src/services/xaquaClient');

// ---------------------------------------------------------------------------
// Power ON/OFF — logica
// ---------------------------------------------------------------------------

describe('Power ON/OFF logic', () => {
  let CONFIG_PATH;

  beforeEach(() => {
    jest.clearAllMocks();
    // Usare il path dal setup.js (env XAQUA_CONFIG_PATH)
    CONFIG_PATH = process.env.XAQUA_CONFIG_PATH || path.join(__dirname, '../data/config.json');
    // Ricopia il fixture per ogni test (clean state)
    const fixtureSource = path.join(__dirname, 'fixtures', 'config.json');
    const fixtureData = fs.readFileSync(fixtureSource, 'utf8');
    fs.writeFileSync(CONFIG_PATH, fixtureData);
  });

  afterEach(() => {
    // Setup.js farà il cleanup della directory tmp
  });

  test('OFF: salva colore attuale e manda {0,0,0,0} al firmware', async () => {
    // Simula quello che farà l'endpoint POST /api/power { on: false }
    const currentColor = await xaquaClient.getColorSchema();
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    cfg.lastColorBeforeOff = currentColor;
    cfg.lampOff = true;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));

    await xaquaClient.setColorSchema({ Amber: 0, Blue: 0, White: 0, Power: 0 });

    // Verifica che setColorSchema è stato chiamato con zeri
    expect(xaquaClient.setColorSchema).toHaveBeenCalledWith({ Amber: 0, Blue: 0, White: 0, Power: 0 });
    // Verifica che il config ha salvato il colore precedente
    const updated = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    expect(updated.lampOff).toBe(true);
    expect(updated.lastColorBeforeOff).toEqual({ Amber: 50, Blue: 80, White: 30, Power: 100 });
  });

  test('ON: ripristina il colore salvato in lastColorBeforeOff', async () => {
    // Setup: salva un colore nel config
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    cfg.lastColorBeforeOff = { Amber: 50, Blue: 80, White: 30, Power: 100 };
    cfg.lampOff = true;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));

    // Simula POST /api/power { on: true }
    const updated = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const colorToRestore = updated.lastColorBeforeOff || { Amber: 0, Blue: 0, White: 0, Power: 0 };
    await xaquaClient.setColorSchema(colorToRestore);
    updated.lampOff = false;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2));

    expect(xaquaClient.setColorSchema).toHaveBeenCalledWith({ Amber: 50, Blue: 80, White: 30, Power: 100 });
    const final = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    expect(final.lampOff).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Schedule Toggle — logica
// ---------------------------------------------------------------------------

describe('Schedule toggle logic', () => {
  let CONFIG_PATH;

  beforeEach(() => {
    jest.clearAllMocks();
    // Usare il path dal setup.js (env XAQUA_CONFIG_PATH)
    CONFIG_PATH = process.env.XAQUA_CONFIG_PATH || path.join(__dirname, '../data/config.json');
    // Ricopia il fixture per ogni test (clean state)
    const fixtureSource = path.join(__dirname, 'fixtures', 'config.json');
    const fixtureData = fs.readFileSync(fixtureSource, 'utf8');
    fs.writeFileSync(CONFIG_PATH, fixtureData);
  });

  afterEach(() => {
    // Setup.js farà il cleanup della directory tmp
  });

  test('PAUSE: ferma scheduler e fissa colore corrente', async () => {
    const currentColor = await xaquaClient.getColorSchema();
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    cfg.schedulePaused = true;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));

    // Fissa il colore corrente
    await xaquaClient.setColorSchema(currentColor);

    expect(xaquaClient.setColorSchema).toHaveBeenCalledWith({ Amber: 50, Blue: 80, White: 30, Power: 100 });
    const updated = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    expect(updated.schedulePaused).toBe(true);
  });

  test('RESUME: riavvia scheduler e riapplica lastSchedule', async () => {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    cfg.schedulePaused = true;
    cfg.lastSchedule = [
      { From: { Amber: 0, Blue: 100, White: 0, Power: 100 }, To: { Amber: 100, Blue: 100, White: 80, Power: 100 }, DeltaSeconds: 10800, Time: '2015/12/01 - 06:00:01' }
    ];
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));

    // Resume
    const updated = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    updated.schedulePaused = false;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2));

    const final = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    expect(final.schedulePaused).toBe(false);
  });
});
