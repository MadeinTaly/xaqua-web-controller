'use strict';

// Regola (utente, 2026-11-02): un solo lettore periodico della lampada (healthMonitor).
// Pallino di stato, home in auto-refresh e oscilloscopio leggono la sua cache: ZERO chiamate.
const express = require('express');
const xaquaClient = require('../src/services/xaquaClient');
const healthMonitor = require('../src/services/healthMonitor');

let server, base;
beforeAll(async () => {
  const app = express();
  app.use('/api', require('../src/routes/api/device'));
  app.use('/api/oscilloscope', require('../src/routes/oscilloscope'));
  await new Promise((r) => { server = app.listen(0, r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
afterAll(() => new Promise((r) => server.close(r)));

test('ping, home e oscilloscopio non chiamano il firmware', async () => {
  xaquaClient.getLampStatus = jest.fn(() => Promise.resolve({ Temperature: 35, FanSpeed: 3800 }));
  xaquaClient.getColorSchema = jest.fn(() => Promise.resolve({ Amber: 10, Blue: 90, White: 5, Power: 100 }));
  await healthMonitor.runHealthMonitorTick();

  const post = jest.spyOn(xaquaClient, 'post').mockImplementation(() => { throw new Error('chiamata al firmware!'); });
  const ping = jest.spyOn(xaquaClient, 'ping').mockImplementation(() => { throw new Error('ping al firmware!'); });

  const p = await (await fetch(base + '/api/ping')).json();
  expect(p.online).toBe(true);
  const h = await (await fetch(base + '/api/home')).json();
  expect(h.status.Temperature).toBe(35);
  expect(h.color.Blue).toBe(90);
  expect(h.time).toMatch(/^2015\/12\/01 - \d{2}:\d{2}:\d{2}$/);
  const o = await (await fetch(base + '/api/oscilloscope/sample')).json();
  expect(o.current && o.current.B).toBe(90);

  expect(post).not.toHaveBeenCalled();
  expect(ping).not.toHaveBeenCalled();
  post.mockRestore(); ping.mockRestore();
});
