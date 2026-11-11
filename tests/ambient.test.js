'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const script = fs.readFileSync(path.join(__dirname, '../public/js/ambient.js'), 'utf8');

function setup(home = true) {
  const properties = {};
  const fetch = jest.fn();
  const document = {
    hidden: false,
    documentElement: { style: { setProperty: (key, value) => { properties[key] = value; } }, classList: { toggle: jest.fn() } },
    getElementById: () => home ? {} : null,
    addEventListener: jest.fn()
  };
  const timers = [];
  const context = { document, window: { fetch }, AbortController, Date,
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout: jest.fn(), setInterval: jest.fn() };
  vm.runInNewContext(script, context);
  async function read(url, data, init, ok = true) {
    const response = { ok, clone: () => ({ json: async () => data }), json: async () => data };
    fetch.mockResolvedValueOnce(response);
    const result = await context.window.fetch(url, init);
    await Promise.resolve();
    return result;
  }
  return { properties, context, fetch, read, timers, document };
}

test('home snapshot colors the ambient light without an extra firmware poll or consuming the response', async () => {
  const s = setup();
  const data = { color: { Amber: 0, Blue: 100, White: 0, Power: 70 }, lampOff: false };
  const response = await s.read('/api/home', data);
  expect(await response.json()).toEqual(data);
  expect(s.properties['--water-color']).toBe('0 60 255');
  expect(s.properties['--water-strength']).toBe('0.7');
  expect(s.context.setInterval).not.toHaveBeenCalled();
  expect(s.fetch).toHaveBeenCalledTimes(1);
});

test('lamp off and zero power remove the ambient glow', async () => {
  const s = setup();
  await s.read('/api/home', { color: { Amber: 100, Blue: 0, White: 0, Power: 100 }, lampOff: true });
  expect(s.properties['--water-strength']).toBe('0');
  await s.read('/api/home', { color: { Amber: 100, Blue: 0, White: 0, Power: 0 }, lampOff: false });
  expect(s.properties['--water-strength']).toBe('0');
});

test('invalid or unavailable readings clear the last glow', async () => {
  const s = setup();
  await s.read('/api/color', { Amber: 0, Blue: 100, White: 0, Power: 100 });
  await s.read('/api/home', { color: null });
  expect(s.properties['--water-strength']).toBe('0');
  await s.read('/api/color', { Amber: null, Blue: 100, White: 0, Power: 100 });
  expect(s.properties['--water-strength']).toBe('0');
});

test('only confirmed power commands change the glow', async () => {
  const s = setup();
  await s.read('/api/color', { Amber: 100, Blue: 0, White: 0, Power: 100 });
  const options = { method: 'POST', body: JSON.stringify({ on: false }) };
  await s.read('/api/power', { ok: false }, options);
  expect(s.properties['--water-strength']).toBe('1');
  await s.read('/api/power', { ok: true }, options);
  expect(s.properties['--water-strength']).toBe('0');
});

test('HTTP and network errors clear stale color while preserving the original failure', async () => {
  const s = setup();
  const data = { color: { Amber: 100, Blue: 0, White: 0, Power: 100 } };
  await s.read('/api/home', data);
  await s.read('/api/home', {}, undefined, false);
  expect(s.properties['--water-strength']).toBe('0');
  await s.read('/api/home', data);
  s.fetch.mockRejectedValueOnce(new Error('offline'));
  await expect(s.context.window.fetch('/api/home')).rejects.toThrow('offline');
  expect(s.properties['--water-strength']).toBe('0');
});

test('other pages poll read-only and pause while hidden', async () => {
  const s = setup(false);
  s.document.hidden = true;
  await s.timers[0]();
  expect(s.fetch).not.toHaveBeenCalled();
  s.document.hidden = false;
  s.fetch.mockResolvedValue({ ok: true, json: async () => ({ color: { Amber: 0, Blue: 0, White: 100, Power: 100 }, lampOff: false }) });
  await s.timers[0]();
  // cache del server, non /api/color (che leggerebbe il firmware)
  expect(s.fetch).toHaveBeenCalledWith('/api/home', { signal: expect.any(AbortSignal) });
  expect(s.properties['--water-color']).toBe('255 255 255');
  await s.timers[0]();
  expect(s.fetch).toHaveBeenCalledTimes(1);
});
