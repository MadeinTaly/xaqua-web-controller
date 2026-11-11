'use strict';

// Il loop di manutenzione deve agire solo a lampada raggiungibile (presa smart) e non
// deve MAI reinviare la schedule da solo, salvo il cambio giorno di un ciclo experimental.
jest.mock('../src/routes/api/_shared', () => ({
  sendScheduleTwoPhase: jest.fn(() => Promise.resolve()),
  applyAndRecord: jest.fn(() => Promise.resolve()),
  // come il vero: invio ok -> marker del giorno (markDailySent reale)
  applyReelToday: jest.fn(async () => { await jest.requireActual('../src/routes/api/_shared').markDailySent(); return { steps: 7 }; })
}));
const shared = require('../src/routes/api/_shared');
const configStore = require('../src/services/configStore');
const xaquaClient = require('../src/services/xaquaClient');
const scheduler = require('../src/services/scheduler');
const healthMonitor = require('../src/services/healthMonitor');

// La raggiungibilità arriva dall'unico lettore periodico (healthMonitor), non da un ping.
async function lamp(ok) {
  xaquaClient.getLampStatus = jest.fn(() => ok
    ? Promise.resolve({ Temperature: 35, FanSpeed: 3800 })
    : Promise.reject(Object.assign(new Error('x'), { code: 'EHOSTUNREACH' })));
  xaquaClient.getColorSchema = jest.fn(() => Promise.resolve({ Amber: 0, Blue: 0, White: 0, Power: 0 }));
  await healthMonitor.runHealthMonitorTick();
}

const LIST = [{ From: {}, To: {}, DeltaSeconds: 86400, Time: '2015/12/01 - 00:00:00' }];

beforeEach(async () => {
  shared.applyAndRecord.mockClear();
  xaquaClient.ping = jest.fn(() => Promise.reject(new Error('lo scheduler non deve pingare')));
  xaquaClient.getTime = jest.fn(() => Promise.reject(new Error('skip')));
  await configStore.update((c) => {
    c.lampOff = false;
    c.lastSchedule = LIST;
    c.experimental = {};
  });
  await lamp(true);
});

test('nessun reinvio automatico della schedule (niente keepalive)', async () => {
  await scheduler.runMaintenanceTick();
  expect(shared.applyAndRecord).not.toHaveBeenCalled();
  expect(shared.sendScheduleTwoPhase).not.toHaveBeenCalled();
});

test('lampada non raggiungibile: nessun invio', async () => {
  const experimental = require('../src/services/experimental');
  shared.applyReelToday.mockClear();
  await configStore.update((c) => {
    c.experimental = { acclimation: { active: true, weeks: 4, startPct: 30, startDate: experimental.startDateForDay(3, new Date()) } };
  });
  await lamp(false);
  await scheduler.runMaintenanceTick();
  expect(shared.applyReelToday).not.toHaveBeenCalled();
});

test('giorno di acclimatazione nuovo: ricompone, invia e segna il marker', async () => {
  const experimental = require('../src/services/experimental');
  shared.applyReelToday.mockClear();
  await configStore.update((c) => {
    c.experimental = { acclimation: { active: true, weeks: 4, startPct: 30, startDate: experimental.startDateForDay(2, new Date()) } };
  });
  await scheduler.runMaintenanceTick();
  expect(shared.applyReelToday).toHaveBeenCalledWith('acclimation-tick');
  expect(configStore.load().experimental.lastTickDay).toBe('acc:2');
  shared.applyReelToday.mockClear();
  await scheduler.runMaintenanceTick();
  expect(shared.applyReelToday).not.toHaveBeenCalled();
});

test('stay-alive (healthMonitor): cambi di stato su file; lampada giù = 1 sola chiamata', async () => {
  const fs = require('fs');
  const log = require('../src/services/logger');
  log.clearLogs();
  await lamp(false);
  expect(xaquaClient.getLampStatus).toHaveBeenCalledTimes(1);
  expect(xaquaClient.getColorSchema).not.toHaveBeenCalled();
  expect(healthMonitor.getLatest().ok).toBe(false);
  await lamp(true);
  expect(xaquaClient.getColorSchema).toHaveBeenCalledTimes(1);
  expect(healthMonitor.getLatest().ok).toBe(true);
  const msgs = log.getLogs().filter(e => e.tag === 'healthMonitor').map(e => e.msg);
  expect(msgs).toEqual(expect.arrayContaining([
    'stay-alive: lampada DIVENTATA irraggiungibile', 'stay-alive: lampada TORNATA raggiungibile'
  ]));
  expect(fs.readFileSync(log.logFile(), 'utf8')).toContain('EHOSTUNREACH');
});

test('giornata con asset dinamici: UN invio automatico al giorno', async () => {
  shared.applyReelToday.mockClear();
  await configStore.update((c) => {
    c.experimental = {};
    c.reelState = { depth: 'SemiDeep', selection: [{ modelId: 'alba-meteo', time: '09:00' }, { modelId: 'luna', time: '20:00' }] };
  });
  await scheduler.runMaintenanceTick();
  expect(shared.applyReelToday).toHaveBeenCalledWith('dynamic-daily');
  shared.applyReelToday.mockClear();
  await scheduler.runMaintenanceTick();
  expect(shared.applyReelToday).not.toHaveBeenCalled();
});

test('giornata statica: nessun invio automatico', async () => {
  shared.applyReelToday.mockClear();
  await configStore.update((c) => {
    c.experimental = {};
    c.reelState = { depth: 'SemiDeep', selection: [{ modelId: 'alba', time: '09:00' }, { modelId: 'spento', time: '20:00' }] };
  });
  await scheduler.runMaintenanceTick();
  expect(shared.applyReelToday).not.toHaveBeenCalled();
});
